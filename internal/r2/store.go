package r2

import (
	"bamboo/internal/engine"
	"bamboo/internal/workspace"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

type profile struct {
	Info    workspace.Info             `json:"info"`
	Config  Config                     `json:"config"`
	Queries map[string]workspace.Query `json:"queries"`
}
type Store struct {
	mu            sync.Mutex
	filename      string
	vault         Vault
	profiles      map[string]profile
	cursors       map[string][]string
	loadErr       error
	clientFactory func(Config, Credentials) *Client
}

func New(dir string, vault Vault) *Store {
	s := &Store{filename: filepath.Join(dir, "r2-workspaces.json"), vault: vault, profiles: map[string]profile{}, cursors: map[string][]string{}, clientFactory: newClient}
	f, err := os.Open(s.filename)
	if os.IsNotExist(err) {
		return s
	}
	if err != nil {
		s.loadErr = errors.New("R2 workspace settings could not be read")
		return s
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.Size() > 8<<20 {
		s.loadErr = errors.New("R2 workspace settings exceed the size limit")
		return s
	}
	var profiles map[string]profile
	if json.NewDecoder(io.LimitReader(f, 8<<20+1)).Decode(&profiles) != nil || profiles == nil || len(profiles) > 32 {
		s.loadErr = errors.New("R2 workspace settings are invalid")
		return s
	}
	for root, p := range profiles {
		_, _, err = normalize(ConnectInput{Name: p.Config.Name, Endpoint: p.Config.Endpoint, Bucket: p.Config.Bucket, Prefix: p.Config.Prefix, AccessKey: "validate", SecretKey: "validate"})
		if err != nil || !strings.HasPrefix(root, "r2://") || p.Info.Root != root || p.Queries == nil || len(p.Queries) > 256 || len(p.Info.Name) > 200 || (p.Info.Active != "" && p.Info.Active != "." && !validRelative(p.Info.Active)) {
			s.loadErr = errors.New("R2 workspace settings are invalid")
			return s
		}
		for rel, q := range p.Queries {
			if (rel != "." && !validRelative(rel)) || len(q.Draft) > 32768 || len(q.Applied) > 32768 {
				s.loadErr = errors.New("R2 saved query is invalid")
				return s
			}
		}
	}
	s.profiles = profiles
	return s
}
func (s *Store) persist(profiles map[string]profile) error {
	b, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return err
	}
	if len(b) > 8<<20 {
		return errors.New("R2 settings exceed 8 MiB")
	}
	if err = os.MkdirAll(filepath.Dir(s.filename), 0700); err != nil {
		return errors.New("could not save R2 workspace settings")
	}
	f, err := os.CreateTemp(filepath.Dir(s.filename), ".r2-state-*")
	if err != nil {
		return errors.New("could not save R2 workspace settings")
	}
	name := f.Name()
	defer os.Remove(name)
	_, err = f.Write(b)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, s.filename)
	}
	if err != nil {
		return errors.New("could not save R2 workspace settings")
	}
	s.profiles = profiles
	return nil
}
func (s *Store) copy() map[string]profile {
	m := make(map[string]profile, len(s.profiles))
	for k, v := range s.profiles {
		v.Queries = cloneQueries(v.Queries)
		m[k] = v
	}
	return m
}
func cloneQueries(m map[string]workspace.Query) map[string]workspace.Query {
	r := map[string]workspace.Query{}
	for k, v := range m {
		r[k] = v
	}
	return r
}
func (s *Store) Connect(ctx context.Context, in ConnectInput) (*workspace.Info, error) {
	c, cred, err := normalize(in)
	if err != nil {
		return nil, err
	}
	client := s.clientFactory(c, cred)
	defer client.http.CloseIdleConnections()
	if _, err = client.list(ctx, ".", ""); err != nil {
		return nil, err
	}
	hash := sha256.Sum256([]byte(c.Endpoint + "\n" + c.Bucket + "\n" + c.Prefix))
	root := fmt.Sprintf("r2://%s/%x", c.Bucket, hash[:12])
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.profiles) >= 32 {
		if _, ok := s.profiles[root]; !ok {
			return nil, errors.New("up to 32 R2 workspaces can be open")
		}
	}
	oldCred, oldErr := s.vault.Get(root)
	if err = s.vault.Set(root, cred); err != nil {
		return nil, err
	}
	all := s.copy()
	p, exists := all[root]
	if !exists {
		p = profile{Info: workspace.Info{Root: root, Active: "."}, Queries: map[string]workspace.Query{}}
	}
	p.Config = c
	p.Info.Location = "r2://" + c.Bucket
	if c.Prefix != "" {
		p.Info.Location += "/" + c.Prefix
	}
	p.Info.Name = c.Name
	all[root] = p
	if err = s.persist(all); err != nil {
		if oldErr == nil {
			_ = s.vault.Set(root, oldCred)
		} else {
			_ = s.vault.Delete(root)
		}
		return nil, err
	}
	return &p.Info, nil
}
func (s *Store) Restore() ([]workspace.Info, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	infos := []workspace.Info{}
	for _, p := range s.profiles {
		infos = append(infos, p.Info)
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].Root < infos[j].Root })
	return infos, s.loadErr
}
func (s *Store) client(root string) (*Client, error) {
	s.mu.Lock()
	p, ok := s.profiles[root]
	s.mu.Unlock()
	if !ok {
		return nil, errors.New("R2 workspace is closed")
	}
	cred, err := s.vault.Get(root)
	if err != nil {
		return nil, err
	}
	return s.clientFactory(p.Config, cred), nil
}
func (s *Store) List(ctx context.Context, root, rel string, offset int) (*workspace.Page, error) {
	if offset < 0 || offset > 5000 {
		return nil, errors.New("R2 directory page limit exceeded")
	}
	client, err := s.client(root)
	if err != nil {
		return nil, err
	}
	defer client.http.CloseIdleConnections()
	key := root + "\n" + rel
	s.mu.Lock()
	tokens := s.cursors[key]
	if offset == 0 {
		tokens = []string{""}
		s.cursors[key] = tokens
	}
	if offset >= len(tokens) {
		s.mu.Unlock()
		return nil, errors.New("R2 directory cursor expired; refresh the folder")
	}
	token := tokens[offset]
	s.mu.Unlock()
	listing, err := client.list(ctx, rel, token)
	if err != nil {
		return nil, err
	}
	out := &workspace.Page{Entries: []workspace.Entry{}, More: listing.More, Next: offset + 1}
	base := client.config.Prefix
	if base != "" {
		base += "/"
	}
	wanted := base
	if rel != "." {
		wanted += rel + "/"
	}
	add := func(raw string, dir bool) {
		k, e := url.PathUnescape(raw)
		if e != nil || !strings.HasPrefix(k, wanted) {
			return
		}
		k = strings.TrimSuffix(k, "/")
		relative := strings.TrimPrefix(k, base)
		if !validRelative(relative) {
			return
		}
		parent := path.Dir(relative)
		if parent != rel {
			return
		}
		if dir || strings.EqualFold(path.Ext(relative), ".parquet") {
			out.Entries = append(out.Entries, workspace.Entry{Name: path.Base(relative), Path: relative, Directory: dir})
		}
	}
	for _, p := range listing.Prefixes {
		add(p.Prefix, true)
	}
	for _, o := range listing.Contents {
		add(o.Key, false)
	}
	s.mu.Lock()
	if listing.More {
		s.cursors[key] = append(tokens[:offset+1], listing.Next)
	}
	s.mu.Unlock()
	return out, nil
}
func (s *Store) Saved(root, relative string) (workspace.Query, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.profiles[root]
	if !ok {
		return workspace.Query{}, errors.New("R2 workspace is closed")
	}
	if relative != "." && !validRelative(relative) {
		return workspace.Query{}, errors.New("invalid R2 object path")
	}
	if q, ok := p.Queries[relative]; ok {
		return q, nil
	}
	if relative == "." {
		return workspace.Query{}, nil
	}
	return workspace.Query{Draft: workspace.DefaultSQL, Applied: workspace.DefaultSQL}, nil
}
func (s *Store) edit(root string, fn func(*profile) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	all := s.copy()
	p, ok := all[root]
	if !ok {
		return errors.New("R2 workspace is closed")
	}
	if err := fn(&p); err != nil {
		return err
	}
	all[root] = p
	return s.persist(all)
}
func (s *Store) Save(root, relative string, q workspace.Query) error {
	if relative != "." && !validRelative(relative) {
		return errors.New("invalid R2 object path")
	}
	if len(q.Draft) > 32768 || len(q.Applied) > 32768 {
		return errors.New("query exceeds 32 KiB")
	}
	return s.edit(root, func(p *profile) error {
		if _, ok := p.Queries[relative]; !ok && len(p.Queries) >= 256 {
			return errors.New("up to 256 saved queries per R2 workspace")
		}
		p.Queries[relative] = q
		return nil
	})
}
func (s *Store) Select(root, relative string) error {
	if relative != "." && !validRelative(relative) {
		return errors.New("invalid R2 object path")
	}
	return s.edit(root, func(p *profile) error { p.Info.Active = relative; return nil })
}
func (s *Store) Rename(root, name string) (*workspace.Info, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 200 {
		return nil, errors.New("workspace name must contain 1–200 characters")
	}
	var info workspace.Info
	err := s.edit(root, func(p *profile) error { p.Info.Name = name; p.Config.Name = name; info = p.Info; return nil })
	return &info, err
}
func (s *Store) CloseFile(root, relative string) error {
	return s.edit(root, func(p *profile) error {
		if p.Info.Active == relative {
			p.Info.Active = "."
		}
		return nil
	})
}
func (s *Store) Close(root string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	all := s.copy()
	if _, ok := all[root]; !ok {
		return errors.New("R2 workspace is closed")
	}
	delete(all, root)
	oldCredential, credentialErr := s.vault.Get(root)
	if err := s.vault.Delete(root); err != nil {
		return err
	}
	if err := s.persist(all); err != nil {
		if credentialErr == nil {
			_ = s.vault.Set(root, oldCredential)
		}
		return err
	}
	for key := range s.cursors {
		if strings.HasPrefix(key, root+"\n") {
			delete(s.cursors, key)
		}
	}
	return nil
}
func (s *Store) Resolver(root string) engine.RemoteResolver {
	return func(ctx context.Context, refs []string) (*engine.RemoteScope, error) {
		c, err := s.client(root)
		if err != nil {
			return nil, err
		}
		scope, err := c.scope(ctx, refs)
		if err != nil {
			c.http.CloseIdleConnections()
			return nil, err
		}
		sizes := make([]int64, len(scope.Objects))
		for i, o := range scope.Objects {
			sizes[i] = o.Size
		}
		return &engine.RemoteScope{Paths: scope.URLs, Sizes: sizes, Close: scope.Close, Error: scope.Error}, nil
	}
}

// NewWithTransport is dependency injection for protocol tests. The desktop
// always uses New and its fixed HTTPS transport; this is not an IPC method.
func NewWithTransport(dir string, vault Vault, transport http.RoundTripper) *Store {
	s := New(dir, vault)
	s.clientFactory = func(c Config, cred Credentials) *Client {
		client := newClient(c, cred)
		client.http.Transport = transport
		return client
	}
	return s
}
