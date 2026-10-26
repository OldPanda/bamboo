package workspace

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T) (*Store, string, string) {
	t.Helper()
	root, _ := filepath.EvalSymlinks(t.TempDir())
	config := t.TempDir()
	s := New(config)
	if _, e := s.Use(root); e != nil {
		t.Fatal(e)
	}
	return s, root, config
}
func TestPersistence(t *testing.T) {
	s, root, config := fixture(t)
	os.WriteFile(filepath.Join(root, "a.parquet"), []byte("fixture"), 0600)
	q, e := s.Saved(root, "a.parquet")
	if e != nil || q.Draft != DefaultSQL {
		t.Fatal(q, e)
	}
	if e = s.Save(root, "a.parquet", Query{"SELECT draft", "SELECT 1"}); e != nil {
		t.Fatal(e)
	}
	if e = s.Select(root, "a.parquet"); e != nil {
		t.Fatal(e)
	}
	info, e := s.Rename(root, "  Research  ")
	if e != nil || info.Name != "Research" {
		t.Fatal(info, e)
	}
	next := New(config)
	info, e = next.Restore()
	if e != nil || info.Root != root || info.Active != "a.parquet" || info.Name != "Research" {
		t.Fatal(info, e)
	}
	q, e = next.Saved(root, "a.parquet")
	if e != nil || q.Draft != "SELECT draft" || q.Applied != "SELECT 1" {
		t.Fatal(q, e)
	}
	info.Name = "changed copy"
	info, _ = next.Restore()
	if info.Name != "Research" {
		t.Fatal("mutable snapshot")
	}
	if e = next.Leave(); e != nil {
		t.Fatal(e)
	}
	if info, e = New(config).Restore(); e != nil || info != nil {
		t.Fatal(info, e)
	}
	if info, e = next.Use(root); e != nil || info.Name != "Research" {
		t.Fatal(info, e)
	}
	st, _ := os.Stat(filepath.Join(config, "workspaces.json"))
	if st.Mode().Perm() != 0600 {
		t.Fatal(st.Mode())
	}
	files, _ := os.ReadDir(root)
	if len(files) != 1 {
		t.Fatal("settings written into source folder")
	}
}
func TestPathsAndListing(t *testing.T) {
	s, root, _ := fixture(t)
	nested := filepath.Join(root, "nested")
	os.Mkdir(nested, 0700)
	for _, n := range []string{"a.PARQUET", "ignore.csv", ".hidden.parquet"} {
		os.WriteFile(filepath.Join(root, n), nil, 0600)
	}
	outside := t.TempDir()
	os.WriteFile(filepath.Join(outside, "secret.parquet"), nil, 0600)
	os.Symlink(outside, filepath.Join(root, "escape"))
	os.Symlink(nested, filepath.Join(root, "loop"))
	page, e := s.List(root, ".", 0)
	if e != nil || len(page.Entries) != 2 || page.More {
		t.Fatal(page, e)
	}
	for _, entry := range page.Entries {
		if entry.Name == "nested" && !entry.Directory {
			t.Fatal(entry)
		}
		if _, e = s.Resolve(root, entry.Path); e != nil {
			t.Fatal(e)
		}
	}
	for _, p := range []string{"", "../secret.parquet", outside, "nested/../a.PARQUET", "escape/secret.parquet", "missing"} {
		if _, e = s.Resolve(root, p); e == nil {
			t.Fatal("accepted", p)
		}
	}
	if _, e = s.Resolve("wrong", "."); e == nil {
		t.Fatal("wrong workspace")
	}
	if _, e = s.List(root, "a.PARQUET", 0); e == nil {
		t.Fatal("listed file")
	}
	for _, offset := range []int{-1, 1000001, 999} {
		if _, e = s.List(root, ".", offset); e == nil {
			t.Fatal("offset", offset)
		}
	}
	if _, e = s.List(root, "../", 0); e == nil {
		t.Fatal("traversal")
	}
	if p, e := s.List(root, "nested", 0); e != nil || len(p.Entries) != 0 {
		t.Fatal(p, e)
	}
	for i := 0; i < 401; i++ {
		os.WriteFile(filepath.Join(nested, fmt.Sprintf("%03d.parquet", i)), nil, 0600)
	}
	seen := map[string]bool{}
	offset := 0
	for {
		p, e := s.List(root, "nested", offset)
		if e != nil {
			t.Fatal(e)
		}
		if len(p.Entries) > 200 {
			t.Fatal("unbounded")
		}
		for _, v := range p.Entries {
			if seen[v.Path] {
				t.Fatal("duplicate")
			}
			seen[v.Path] = true
		}
		if !p.More {
			break
		}
		offset = p.Next
	}
	if len(seen) != 401 {
		t.Fatal(len(seen))
	}
	os.Chmod(nested, 0000)
	defer os.Chmod(nested, 0700)
	if _, e = s.List(root, "nested", 0); e == nil {
		t.Fatal("unreadable directory")
	}
}
func TestValidationAndFailureKeepsState(t *testing.T) {
	s, root, _ := fixture(t)
	for _, name := range []string{"", "\n", strings.Repeat("x", 201), "a\x00b", "a\nb"} {
		if _, e := s.Rename(root, name); e == nil {
			t.Fatal(name)
		}
	}
	if _, e := s.Rename("wrong", "Name"); e == nil {
		t.Fatal("wrong root")
	}
	if _, e := s.Saved(root, "../no"); e == nil {
		t.Fatal("bad path")
	}
	if _, e := s.Saved("wrong", "a"); e == nil {
		t.Fatal("wrong root")
	}
	for _, f := range []func() error{func() error { return s.Save("wrong", "a", Query{}) }, func() error { return s.Save(root, "../no", Query{}) }, func() error { return s.Save(root, "a", Query{Draft: strings.Repeat("x", 32769)}) }, func() error { return s.Select("wrong", "a") }, func() error { return s.Select(root, "../no") }} {
		if f() == nil {
			t.Fatal("accepted invalid mutation")
		}
	}
	if _, e := s.Use(filepath.Join(root, "missing")); e == nil {
		t.Fatal("missing root")
	}
	os.WriteFile(filepath.Join(root, "file"), nil, 0600)
	if _, e := s.Use(filepath.Join(root, "file")); e == nil {
		t.Fatal("file as root")
	}
	unreadable := t.TempDir()
	os.Chmod(unreadable, 0000)
	defer os.Chmod(unreadable, 0700)
	if _, e := s.Use(unreadable); e == nil {
		t.Fatal("unreadable root")
	}
	// A config parent replaced by a file must fail without committing mutations.
	bad := filepath.Join(t.TempDir(), "block")
	os.WriteFile(bad, nil, 0600)
	s.path = filepath.Join(bad, "state")
	for _, f := range []func() error{func() error { _, e := s.Use(root); return e }, func() error { return s.Leave() }, func() error { _, e := s.Rename(root, "Lost"); return e }, func() error { return s.Select(root, "lost") }, func() error { return s.Save(root, "a", Query{}) }} {
		if f() == nil {
			t.Fatal("write failure ignored")
		}
	}
	if s.data.Profiles[root].Active != "" || s.data.Profiles[root].Name == "Lost" {
		t.Fatal("failed mutation committed")
	}
}
func TestSettingsRecoveryAndLimits(t *testing.T) {
	for _, raw := range []string{"bad", `{"version":2,"profiles":{}}`, `{"version":1}`, `{"version":1,"profiles":{"/x":null}}`, `{"version":1,"profiles":{"/x":{"root":"/wrong"}}}`, `{"version":1,"profiles":{"/x":{"root":"/x","active":"../escape"}}}`, `{"version":1,"profiles":{"/x":{"root":"/x","queries":{"../x":{}}}}}`, strings.Repeat("x", stateLimit+1)} {
		config := t.TempDir()
		os.WriteFile(filepath.Join(config, "workspaces.json"), []byte(raw), 0600)
		s := New(config)
		if _, e := s.Restore(); e == nil {
			t.Fatal("invalid state accepted")
		}
		if _, e := s.Use(t.TempDir()); e != nil {
			t.Fatal("explicit reopen did not recover", e)
		}
	}
	config := t.TempDir()
	os.Mkdir(filepath.Join(config, "workspaces.json"), 0700)
	if _, e := New(config).Restore(); e == nil {
		t.Fatal("directory as state")
	}
	config = t.TempDir()
	os.WriteFile(filepath.Join(config, "workspaces.json"), nil, 0000)
	if _, e := New(config).Restore(); e == nil {
		t.Fatal("unreadable settings")
	}
	s, root, config := fixture(t)
	os.Remove(root)
	if _, e := New(config).Restore(); e == nil {
		t.Fatal("missing root")
	}
	s, root, _ = fixture(t)
	for i := 0; i < 256; i++ {
		s.data.Profiles[root].Queries[fmt.Sprint(i)] = Query{}
	}
	if e := s.Save(root, "new", Query{}); e == nil {
		t.Fatal("query limit")
	}
	if e := s.Save(root, "0", Query{Draft: "ok"}); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 31; i++ {
		key := fmt.Sprintf("/fake/%d", i)
		s.data.Profiles[key] = &profile{Info: Info{Root: key}, Queries: map[string]Query{}}
	}
	if _, e := s.Use(t.TempDir()); e == nil {
		t.Fatal("workspace limit")
	}
	d := s.copy()
	d.Profiles[root].Queries = map[string]Query{}
	for i := 0; i < 200; i++ {
		d.Profiles[root].Queries[fmt.Sprint(i)] = Query{strings.Repeat("x", 32768), strings.Repeat("x", 32768)}
	}
	if e := s.write(d); e == nil {
		t.Fatal("state byte limit")
	}
	// Validate profile and per-file limits when loading, not only during writes.
	d = s.copy()
	d.Profiles[root].Queries["overflow"] = Query{}
	b, _ := json.Marshal(d)
	os.WriteFile(s.path, b, 0600)
	if _, e := New(filepath.Dir(s.path)).Restore(); e == nil {
		t.Fatal("loaded too many queries")
	}
}
