package querylibrary

import (
	"bamboo/internal/testutil"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHistoryFavoritesAndRestart(t *testing.T) {
	dir := t.TempDir()
	s := New(dir)
	scope := QueryScope{Kind: "file", Path: "/fixtures/竹.parquet"}
	sql := "SELECT '<img onerror=x>', 9223372036854775807, NULL, '' FROM data"
	if err := s.Save(scope, sql, false); err != nil {
		t.Fatal(err)
	}
	first := s.data.Entries[0].ID
	if err := s.Save(scope, sql, true); err != nil {
		t.Fatal(err)
	}
	if err := s.Save(scope, sql, false); err != nil {
		t.Fatal(err)
	}
	if len(s.data.Entries) != 1 || s.data.Entries[0].ID != first {
		t.Fatal(s.data)
	}
	other := QueryScope{Kind: "workspace", Path: "s3://connection/"}
	if err := s.Save(other, sql, false); err != nil {
		t.Fatal(err)
	}
	loaded, err := New(dir).Entries()
	if err != nil || len(loaded) != 2 || loaded[1].SQL != sql || !loaded[1].Favorite {
		t.Fatal(loaded, err)
	}
	loaded[0].SQL = "mutated"
	if s.data.Entries[0].SQL != sql {
		t.Fatal("alias")
	}
	if err = s.Change("", "clear"); err != nil {
		t.Fatal(err)
	}
	if len(s.data.Entries) != 1 || s.data.Entries[0].History || !s.data.Entries[0].Favorite {
		t.Fatal(s.data)
	}
	if err = s.Change(first, "favorite"); err != nil {
		t.Fatal(err)
	}
	if len(s.data.Entries) != 0 {
		t.Fatal(s.data)
	}
	if err = s.Save(scope, sql, true); err != nil {
		t.Fatal(err)
	}
	if err = s.Change(s.data.Entries[0].ID, "delete"); err != nil {
		t.Fatal(err)
	}
	_, err = os.Stat(filepath.Join(dir, "query-library.json"))
	if err != nil {
		t.Fatal(err)
	}
	testutil.Private(t, filepath.Join(dir, "query-library.json"), 0600)
}

func TestBoundsAndEviction(t *testing.T) {
	s := New(t.TempDir())
	scope := QueryScope{Kind: "file", Path: "/test.parquet"}
	for i := range 105 {
		if err := s.Save(scope, fmt.Sprintf("SELECT %d", i), false); err != nil {
			t.Fatal(err)
		}
	}
	if len(s.data.Entries) != 100 || s.data.Entries[99].SQL != "SELECT 5" {
		t.Fatal("eviction")
	}
	for _, sql := range []string{"", "  ", strings.Repeat("x", 32769), "SELECT \x00", string([]byte{255})} {
		if s.Save(scope, sql, false) == nil {
			t.Fatal("accepted invalid SQL")
		}
	}
	for _, scope := range []QueryScope{{}, {Kind: "other", Path: "x"}, {Kind: "file", Path: ""}, {Kind: "file", Path: "a\x00b"}} {
		if s.Save(scope, "SELECT 1", true) == nil {
			t.Fatal(scope)
		}
	}
	for i := range 100 {
		if err := s.Save(scope, fmt.Sprintf("SELECT %d", i), true); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Save(scope, "SELECT 0", true); err != nil {
		t.Fatal("existing favorite at limit", err)
	}
	if s.Save(scope, "SELECT 999", true) == nil {
		t.Fatal("favorite overflow")
	}
	nonFavorite := ""
	for _, e := range s.data.Entries {
		if !e.Favorite {
			nonFavorite = e.ID
			break
		}
	}
	if s.Change(nonFavorite, "favorite") == nil {
		t.Fatal("toggle overflow accepted")
	}
	if s.Change("missing", "delete") == nil {
		t.Fatal("unknown id")
	}
	if s.Change(s.data.Entries[0].ID, "invalid") == nil {
		t.Fatal("unknown action")
	}
	// Demote an existing favorite and then promote a history query.
	id := s.data.Entries[0].ID
	if err := s.Change(id, "favorite"); err != nil {
		t.Fatal(err)
	}
}

func TestUnreadablePreserved(t *testing.T) {
	for _, body := range []string{"broken", `{"version":2,"entries":[]}`, `{"version":1}`, strings.Repeat("x", maxBytes+1)} {
		dir := t.TempDir()
		path := filepath.Join(dir, "query-library.json")
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		s := New(dir)
		if _, err := s.Entries(); err == nil {
			t.Fatal("bad state accepted")
		}
		if s.Save(QueryScope{Kind: "file", Path: "/f"}, "SELECT 1", false) == nil || s.Change("", "clear") == nil {
			t.Fatal("bad state overwritten")
		}
		got, _ := os.ReadFile(path)
		if string(got) != body {
			t.Fatal("bytes changed")
		}
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "query-library.json")
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := New(dir).Entries(); err == nil {
		t.Fatal("directory accepted")
	}
	if _, err := New("").Entries(); err == nil {
		t.Fatal("missing config accepted")
	}
}

func TestInvalidEntries(t *testing.T) {
	s := New(t.TempDir())
	if err := s.Save(QueryScope{Kind: "file", Path: "/f"}, "SELECT 1", false); err != nil {
		t.Fatal(err)
	}
	original := s.data.Entries[0]
	for _, mutate := range []func(*QueryEntry){
		func(e *QueryEntry) { e.ID = "bad" }, func(e *QueryEntry) { e.Updated = "bad" }, func(e *QueryEntry) { e.Scope.Kind = "bad" }, func(e *QueryEntry) { e.SQL = "" }, func(e *QueryEntry) { e.History = false },
	} {
		e := original
		mutate(&e)
		d := state{Version: 1, Entries: []QueryEntry{e}}
		b, _ := json.Marshal(d)
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "query-library.json"), b, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := New(dir).Entries(); err == nil {
			t.Fatal("invalid entry accepted")
		}
	}
}

func TestWriteFailureKeepsSnapshot(t *testing.T) {
	dir := t.TempDir()
	s := New(dir)
	scope := QueryScope{Kind: "file", Path: "/f"}
	if err := s.Save(scope, "SELECT 1", false); err != nil {
		t.Fatal(err)
	}
	// Real rename failure, including Windows: the destination is a nonempty directory.
	if err := os.Remove(s.path); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(s.path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.path, "keep"), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	if s.Save(scope, "SELECT 2", false) == nil {
		t.Fatal("write accepted")
	}
	if len(s.data.Entries) != 1 || s.data.Entries[0].SQL != "SELECT 1" {
		t.Fatal("failed write changed snapshot")
	}
	files, _ := filepath.Glob(filepath.Join(dir, ".query-library-*"))
	if len(files) != 0 {
		t.Fatal("temp files leaked")
	}
}

func TestPrivateLibraryFailuresAndCapacity(t *testing.T) {
	scope := QueryScope{Kind: "file", Path: "/f"}
	t.Run("read denied", func(t *testing.T) {
		dir := t.TempDir()
		s := New(dir)
		if err := s.Save(scope, "SELECT 1", false); err != nil {
			t.Fatal(err)
		}
		testutil.DenyRead(t, dir)
		if _, err := New(dir).Entries(); err == nil {
			t.Fatal("read denial ignored")
		}
	})
	t.Run("write denied", func(t *testing.T) {
		dir := t.TempDir()
		s := New(dir)
		testutil.DenyWrite(t, dir)
		if s.Save(scope, "SELECT 1", false) == nil {
			t.Fatal("write denial ignored")
		}
		if len(s.data.Entries) != 0 {
			t.Fatal("failed save changed snapshot")
		}
	})
	t.Run("parent replaced by file", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "config")
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
		s := New(dir)
		if err := os.Remove(dir); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(dir, []byte("keep"), 0600); err != nil {
			t.Fatal(err)
		}
		if s.Save(scope, "SELECT 1", false) == nil {
			t.Fatal("file parent ignored")
		}
	})
	t.Run("encoded capacity", func(t *testing.T) {
		s := New(t.TempDir())
		scope.Path = strings.Repeat("<", 32768)
		full := false
		for i := range 50 {
			err := s.Save(scope, fmt.Sprintf("SELECT %d", i), true)
			if err != nil {
				full = strings.Contains(err.Error(), "full")
				break
			}
		}
		if !full {
			t.Fatal("encoded size limit ignored")
		}
		reloaded := New(filepath.Dir(s.path))
		if _, err := reloaded.Entries(); err != nil {
			t.Fatal("failed save corrupted previous file", err)
		}
	})
	t.Run("invalid membership counts", func(t *testing.T) {
		scope := QueryScope{Kind: "file", Path: "/f"}
		s := New(t.TempDir())
		if err := s.Save(scope, "SELECT 1", true); err != nil {
			t.Fatal(err)
		}
		for _, favorites := range []bool{false, true} {
			entries := []QueryEntry{}
			for i := range 101 {
				e := s.data.Entries[0]
				e.ID = fmt.Sprintf("%032x", i)
				e.History = !favorites
				e.Favorite = favorites
				entries = append(entries, e)
			}
			b, _ := json.Marshal(state{Version: 1, Entries: entries})
			if err := os.WriteFile(s.path, b, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := New(filepath.Dir(s.path)).Entries(); err == nil {
				t.Fatal("invalid count accepted")
			}
		}
	})
}

func TestNamedQueriesAndLegacyCompatibility(t *testing.T) {
	dir := t.TempDir()
	s := New(dir)
	scope := QueryScope{Kind: "file", Path: "/fixtures/竹.parquet"}
	const sql = "SELECT '<img>', 9223372036854775807 FROM data"
	if err := s.Save(scope, sql, true); err != nil {
		t.Fatal(err)
	}
	entries, err := New(dir).Entries()
	if err != nil || entries[0].Name != "" {
		t.Fatal("legacy favorite must load without a title", entries, err)
	}
	id := entries[0].ID
	if err = s.SaveNamed(scope, sql, "  每日 <img> 总计  "); err != nil {
		t.Fatal(err)
	}
	if err = s.Save(scope, sql, false); err != nil {
		t.Fatal(err)
	}
	if len(s.data.Entries) != 1 || s.data.Entries[0].Name != "每日 <img> 总计" || s.data.Entries[0].ID != id {
		t.Fatal("running SQL lost its saved name")
	}
	if err = s.Rename(id, "Renamed <script>"); err != nil {
		t.Fatal(err)
	}
	entries, err = New(dir).Entries()
	if err != nil || entries[0].Name != "Renamed <script>" || entries[0].SQL != sql || entries[0].Scope != scope {
		t.Fatal(entries, err)
	}
	if s.Rename("missing", "name") == nil {
		t.Fatal("renamed missing query")
	}
	for _, name := range []string{"", "  ", strings.Repeat("x", 201), "a\nb", "a\rb", "a\x00b", string([]byte{255})} {
		if s.SaveNamed(scope, sql, name) == nil || s.Rename(id, name) == nil {
			t.Fatal("invalid query name accepted", name)
		}
	}
	if err = s.Change(id, "favorite"); err != nil {
		t.Fatal(err)
	}
	if s.Rename(id, "Not saved") == nil {
		t.Fatal("renamed history-only entry")
	}
	// Unknown/corrupt title fields must not cause the file to be overwritten.
	body := `{"version":1,"entries":[{"id":"` + id + `","scope":{"kind":"file","path":"/f"},"sql":"SELECT 1","updated":"2026-11-02T12:00:00Z","favorite":true,"name":"` + strings.Repeat("x", 201) + `"}]}`
	if err = os.WriteFile(filepath.Join(dir, "query-library.json"), []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	bad := New(dir)
	if _, err = bad.Entries(); err == nil {
		t.Fatal("invalid stored name accepted")
	}
	if bad.SaveNamed(scope, sql, "Replacement") == nil {
		t.Fatal("overwrote unreadable settings")
	}
}
