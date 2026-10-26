// Package workspace manages bounded local folder browsing and private app state.
package workspace

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
)

const DefaultSQL = "SELECT * FROM data"
const stateLimit = 8 << 20

type Query struct {
	Draft   string `json:"draft"`
	Applied string `json:"applied"`
}
type Info struct {
	Root     string `json:"root"`
	Name     string `json:"name"`
	Active   string `json:"active"`
	Location string `json:"location,omitempty"`
}
type Entry struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Directory bool   `json:"directory"`
}
type Page struct {
	Entries []Entry `json:"entries"`
	Next    int     `json:"next"`
	More    bool    `json:"more"`
}
type profile struct {
	Info
	Queries map[string]Query `json:"queries"`
}
type state struct {
	Version  int                 `json:"version"`
	Open     []string            `json:"open,omitempty"`
	Last     string              `json:"last"`
	Profiles map[string]*profile `json:"profiles"`
}
type Store struct {
	mu      sync.Mutex
	path    string
	data    state
	current string
	opened  map[string]bool
	loadErr error
}

func New(dir string) *Store {
	s := &Store{path: filepath.Join(dir, "workspaces.json"), opened: map[string]bool{}, data: state{Version: 1, Profiles: map[string]*profile{}}}
	f, err := os.Open(s.path)
	if os.IsNotExist(err) {
		return s
	}
	if err != nil {
		s.loadErr = err
		return s
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, stateLimit+1))
	var d state
	if err != nil || len(b) > stateLimit || json.Unmarshal(b, &d) != nil || d.Version != 1 || d.Profiles == nil || len(d.Profiles) > 32 || len(d.Open) > 32 {
		s.loadErr = errors.New("saved workspace settings are unreadable; open a folder to start again")
		return s
	}
	for root, p := range d.Profiles {
		if p == nil || p.Root != root || !filepath.IsAbs(root) || len(p.Name) > 200 || len(p.Queries) > 256 {
			s.loadErr = errors.New("invalid workspace settings")
			return s
		}
		for rel, q := range p.Queries {
			if !relative(rel) || !validQuery(q) {
				s.loadErr = errors.New("invalid saved query")
				return s
			}
		}
		if p.Active != "" && !relative(p.Active) {
			s.loadErr = errors.New("invalid last file")
			return s
		}
	}
	for _, root := range d.Open {
		if d.Profiles[root] == nil {
			s.loadErr = errors.New("invalid open workspace")
			return s
		}
	}
	s.data = d
	return s
}
func relative(p string) bool {
	return p != "" && !filepath.IsAbs(p) && filepath.Clean(p) == p && p != ".." && !strings.HasPrefix(p, ".."+string(os.PathSeparator))
}
func validQuery(q Query) bool { return len(q.Draft) <= 32768 && len(q.Applied) <= 32768 }
func (s *Store) write(d state) error {
	b, err := json.Marshal(d)
	if err != nil {
		return err
	}
	if len(b) > stateLimit {
		return errors.New("workspace settings are full; shorten saved queries")
	}
	if err = os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(s.path), ".workspace-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), s.path)
}
func (s *Store) commit(d state) error {
	if err := s.write(d); err != nil {
		return err
	}
	s.data = d
	return nil
}
func (s *Store) copy() state {
	d := state{Version: 1, Last: s.data.Last, Open: slices.Clone(s.data.Open), Profiles: map[string]*profile{}}
	for k, p := range s.data.Profiles {
		c := *p
		c.Queries = map[string]Query{}
		for f, q := range p.Queries {
			c.Queries[f] = q
		}
		d.Profiles[k] = &c
	}
	return d
}
func (s *Store) Use(path string) (*Info, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(root)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !st.IsDir() {
		return nil, errors.New("choose a folder")
	}
	// Check read access before adding this workspace to the open set.
	if _, err = f.ReadDir(1); err != nil && err != io.EOF {
		return nil, err
	}
	d := s.copy()
	if d.Profiles[root] == nil {
		if len(d.Profiles) >= 32 {
			return nil, errors.New("maximum of 32 remembered workspaces reached")
		}
		d.Profiles[root] = &profile{Info: Info{Root: root, Name: filepath.Base(root)}, Queries: map[string]Query{}}
	}
	d.Last = root
	if !slices.Contains(d.Open, root) {
		d.Open = append(d.Open, root)
	}
	if err = s.commit(d); err != nil {
		return nil, err
	}
	s.current = root
	s.opened[root] = true
	s.loadErr = nil
	v := d.Profiles[root].Info
	return &v, nil
}
func (s *Store) Restore() (*Info, error) {
	s.mu.Lock()
	err := s.loadErr
	last := s.data.Last
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	if last == "" {
		return nil, nil
	}
	return s.Use(last)
}
func (s *Store) Leave() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.copy()
	d.Last = ""
	d.Open = nil
	if err := s.commit(d); err != nil {
		return err
	}
	s.current = ""
	s.opened = map[string]bool{}
	return nil
}
func (s *Store) currentProfile(root string) (*profile, error) {
	if root == "" || !s.opened[root] || s.data.Profiles[root] == nil {
		return nil, errors.New("workspace changed; reopen the folder")
	}
	return s.data.Profiles[root], nil
}
func (s *Store) Rename(root, name string) (*Info, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.currentProfile(root); err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 200 || strings.ContainsAny(name, "\r\n\x00") {
		return nil, errors.New("workspace name must be 1–200 bytes on one line")
	}
	d := s.copy()
	d.Profiles[root].Name = name
	if err := s.commit(d); err != nil {
		return nil, err
	}
	v := d.Profiles[root].Info
	return &v, nil
}

// Resolve accepts only paths inside the explicitly selected root. Symlink escapes
// are rejected. Directory listings omit symlinks entirely to avoid loops.
func (s *Store) Resolve(root, rel string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.currentProfile(root); err != nil {
		return "", err
	}
	if !relative(rel) {
		return "", errors.New("invalid workspace-relative path")
	}
	full, err := filepath.EvalSymlinks(filepath.Join(root, rel))
	if err != nil {
		return "", err
	}
	r, err := filepath.Rel(root, full)
	if err != nil || !relative(r) {
		return "", errors.New("path is outside the workspace")
	}
	return full, nil
}
func (s *Store) List(root, rel string, offset int) (*Page, error) {
	if offset < 0 || offset > 1000000 {
		return nil, errors.New("directory page limit exceeded")
	}
	full, err := s.Resolve(root, rel)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(full)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	// Read at most 200 raw directory entries per page; no recursive scan or sort.
	for skip := offset; skip > 0; {
		n := min(skip, 200)
		es, e := f.ReadDir(n)
		if e != nil {
			return nil, e
		}
		skip -= len(es)
	}
	entries, err := f.ReadDir(200)
	if err != nil && err != io.EOF {
		return nil, err
	}
	p := &Page{Entries: []Entry{}, Next: offset + len(entries), More: len(entries) == 200}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") || e.Type()&os.ModeSymlink != 0 {
			continue
		}
		if e.IsDir() || e.Type().IsRegular() && strings.EqualFold(filepath.Ext(e.Name()), ".parquet") {
			p.Entries = append(p.Entries, Entry{Name: e.Name(), Path: filepath.Join(rel, e.Name()), Directory: e.IsDir()})
		}
	}
	return p, nil
}
func (s *Store) Saved(root, rel string) (Query, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.currentProfile(root)
	if err != nil {
		return Query{}, err
	}
	if !relative(rel) {
		return Query{}, errors.New("invalid file path")
	}
	q, ok := p.Queries[rel]
	if !ok {
		if rel == "." {
			return Query{}, nil
		}
		return Query{Draft: DefaultSQL, Applied: DefaultSQL}, nil
	}
	return q, nil
}
func (s *Store) Save(root, rel string, q Query) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.currentProfile(root)
	if err != nil {
		return err
	}
	if !relative(rel) || !validQuery(q) {
		return errors.New("invalid path or query exceeds 32 KiB")
	}
	if _, ok := p.Queries[rel]; !ok && len(p.Queries) >= 256 {
		return errors.New("maximum of 256 saved file queries reached")
	}
	d := s.copy()
	d.Profiles[root].Queries[rel] = q
	return s.commit(d)
}
func (s *Store) Select(root, rel string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.currentProfile(root); err != nil {
		return err
	}
	if !relative(rel) {
		return errors.New("invalid file path")
	}
	d := s.copy()
	d.Profiles[root].Active = rel
	d.Last = root
	return s.commit(d)
}

// RestoreAll migrates the previous single-workspace setting and restores each
// accessible root independently, with the last active root ordered last.
type Restored struct {
	Workspaces []Info `json:"workspaces"`
	Warning    string `json:"warning"`
}

func (s *Store) RestoreAll() (*Restored, error) {
	s.mu.Lock()
	err := s.loadErr
	roots := slices.Clone(s.data.Open)
	last := s.data.Last
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	if last != "" {
		roots = slices.DeleteFunc(roots, func(r string) bool { return r == last })
		roots = append(roots, last)
	}
	r := &Restored{Workspaces: []Info{}}
	for _, root := range roots {
		info, e := s.Use(root)
		if e != nil {
			r.Warning += "Could not reopen " + root + ": " + e.Error() + "\n"
			continue
		}
		r.Workspaces = append(r.Workspaces, *info)
	}
	return r, nil
}
func (s *Store) Close(root string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.currentProfile(root); err != nil {
		return err
	}
	d := s.copy()
	d.Open = slices.DeleteFunc(d.Open, func(r string) bool { return r == root })
	if d.Last == root {
		d.Last = ""
		if len(d.Open) > 0 {
			d.Last = d.Open[len(d.Open)-1]
		}
	}
	if err := s.commit(d); err != nil {
		return err
	}
	delete(s.opened, root)
	s.current = d.Last
	return nil
}
func (s *Store) CloseFile(root, rel string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.currentProfile(root)
	if err != nil {
		return err
	}
	if p.Active != rel {
		return nil
	}
	d := s.copy()
	d.Profiles[root].Active = ""
	return s.commit(d)
}
