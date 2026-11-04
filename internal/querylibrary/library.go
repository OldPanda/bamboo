// Package querylibrary keeps bounded query history and favorites in private local settings.
package querylibrary

import (
	"bamboo/internal/privatefs"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

const maxBytes = 8 << 20
const maxSQL = 32768
const maxHistory = 100
const maxFavorites = 100

// QueryScope binds SQL to one file or workspace identity; it never grants access.
type QueryScope struct {
	Kind string `json:"kind"`
	Path string `json:"path"`
}

// QueryEntry stores exact SQL text, its source, and independent history/favorite membership.
type QueryEntry struct {
	Name     string     `json:"name,omitempty"`
	ID       string     `json:"id"`
	Scope    QueryScope `json:"scope"`
	SQL      string     `json:"sql"`
	Updated  string     `json:"updated"`
	History  bool       `json:"history"`
	Favorite bool       `json:"favorite"`
}
type state struct {
	Version int          `json:"version"`
	Entries []QueryEntry `json:"entries"`
}

// Store owns a settings snapshot. Its caller serializes access; failed writes never change it.
type Store struct {
	path    string
	data    state
	loadErr error
}

func validScope(s QueryScope) bool {
	return (s.Kind == "file" || s.Kind == "workspace") && s.Path != "" && len(s.Path) <= 32768 && !strings.ContainsRune(s.Path, 0) && utf8.ValidString(s.Path)
}
func validSQL(sql string) bool {
	return strings.TrimSpace(sql) != "" && len(sql) <= maxSQL && utf8.ValidString(sql) && !strings.ContainsRune(sql, 0)
}

// New loads bounded settings and preserves unreadable or unknown formats against writes.
func New(dir string) *Store {
	s := &Store{path: filepath.Join(dir, "query-library.json"), data: state{Version: 1, Entries: []QueryEntry{}}}
	if dir == "" {
		s.loadErr = errors.New("query library could not be saved")
		return s
	}
	f, err := os.Open(s.path)
	if os.IsNotExist(err) {
		return s
	}
	if err != nil {
		s.loadErr = errors.New("query library could not be read; existing settings preserved")
		return s
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, maxBytes+1))
	var d state
	if err != nil || len(b) > maxBytes || json.Unmarshal(b, &d) != nil || d.Version != 1 || d.Entries == nil || len(d.Entries) > maxHistory+maxFavorites {
		s.loadErr = errors.New("query library could not be read; existing settings preserved")
		return s
	}
	seen := map[string]bool{}
	history, favorites := 0, 0
	for _, e := range d.Entries {
		_, dateErr := time.Parse(time.RFC3339Nano, e.Updated)
		id, idErr := hex.DecodeString(e.ID)
		if !validName(e.Name) || !validScope(e.Scope) || !validSQL(e.SQL) || len(id) != 16 || idErr != nil || dateErr != nil || seen[e.ID] || (!e.History && !e.Favorite) {
			s.loadErr = errors.New("query library could not be read; existing settings preserved")
			return s
		}
		seen[e.ID] = true
		if e.History {
			history++
		}
		if e.Favorite {
			favorites++
		}
	}
	if history > maxHistory || favorites > maxFavorites {
		s.loadErr = errors.New("query library could not be read; existing settings preserved")
		return s
	}
	s.data = d
	return s
}

// Entries returns a detached snapshot, including favorites after history is cleared.
func (s *Store) Entries() ([]QueryEntry, error) { return slices.Clone(s.data.Entries), s.loadErr }
func (s *Store) commit(entries []QueryEntry) error {
	if s.loadErr != nil {
		return s.loadErr
	}
	b, err := json.Marshal(state{Version: 1, Entries: entries})
	if err != nil {
		return err
	}
	if len(b) > maxBytes {
		return errors.New("query library is full; remove saved queries")
	}
	if err = os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return errors.New("query library could not be saved")
	}
	f, err := privatefs.CreateTemp(filepath.Dir(s.path), ".query-library-*")
	if err != nil {
		return errors.New("query library could not be saved")
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		return errors.New("query library could not be saved")
	}
	if err = os.Rename(f.Name(), s.path); err != nil {
		return errors.New("query library could not be saved")
	}
	s.data.Entries = entries
	return nil
}

// Save adds or refreshes exact SQL in its scope. Successful runs and saved drafts are distinct.
func (s *Store) Save(scope QueryScope, sql string, favorite bool) error {
	return s.save(scope, sql, favorite, nil)
}
func validName(name string) bool {
	return len(name) <= 200 && utf8.ValidString(name) && !strings.ContainsAny(name, "\x00\r\n")
}

// SaveNamed saves an editor snapshot with a user-supplied title; legacy untitled entries remain readable.
func (s *Store) SaveNamed(scope QueryScope, sql, name string) error {
	name = strings.TrimSpace(name)
	if name == "" || !validName(name) {
		return errors.New("query name must contain 1–200 bytes on one line")
	}
	return s.save(scope, sql, true, &name)
}

// Rename changes only the title of an existing saved query, retaining SQL and source identity.
func (s *Store) Rename(id, name string) error {
	name = strings.TrimSpace(name)
	if name == "" || !validName(name) {
		return errors.New("query name must contain 1–200 bytes on one line")
	}
	entries := slices.Clone(s.data.Entries)
	i := slices.IndexFunc(entries, func(e QueryEntry) bool { return e.ID == id && e.Favorite })
	if i < 0 {
		return errors.New("saved query no longer exists")
	}
	entries[i].Name = name
	return s.commit(entries)
}
func (s *Store) save(scope QueryScope, sql string, favorite bool, name *string) error {
	if !validScope(scope) || !validSQL(sql) {
		return errors.New("choose a source and SQL of at most 32768 bytes")
	}
	entries := slices.Clone(s.data.Entries)
	index := slices.IndexFunc(entries, func(e QueryEntry) bool { return e.Scope == scope && e.SQL == sql })
	e := QueryEntry{Scope: scope, SQL: sql, Updated: time.Now().UTC().Format(time.RFC3339Nano)}
	if index >= 0 {
		e = entries[index]
		entries = slices.Delete(entries, index, index+1)
	} else {
		var nonce [16]byte
		if _, err := rand.Read(nonce[:]); err != nil {
			return err
		}
		e.ID = hex.EncodeToString(nonce[:])
	}
	if favorite {
		count := 0
		for _, saved := range entries {
			if saved.Favorite {
				count++
			}
		}
		if count >= maxFavorites {
			return errors.New("maximum of 100 favorites reached")
		}
		e.Favorite = true
	} else {
		e.History = true
		e.Updated = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if name != nil {
		e.Name = *name
	}
	entries = append([]QueryEntry{e}, entries...)
	// Naming or saving an old query must not change execution recency. Sort the
	// bounded snapshot before eviction, including states written by older builds.
	slices.SortStableFunc(entries, func(a, b QueryEntry) int {
		at, _ := time.Parse(time.RFC3339Nano, a.Updated)
		bt, _ := time.Parse(time.RFC3339Nano, b.Updated)
		return bt.Compare(at)
	})
	count := 0
	for i := range entries {
		if entries[i].History {
			count++
			if count > maxHistory {
				entries[i].History = false
			}
		}
	}
	entries = slices.DeleteFunc(entries, func(e QueryEntry) bool { return !e.History && !e.Favorite })
	return s.commit(entries)
}

// Change deletes one entry, toggles its favorite membership, or clears history while retaining favorites.
func (s *Store) Change(id, action string) error {
	entries := slices.Clone(s.data.Entries)
	if action == "clear" {
		for i := range entries {
			entries[i].History = false
		}
		entries = slices.DeleteFunc(entries, func(e QueryEntry) bool { return !e.Favorite })
	} else {
		i := slices.IndexFunc(entries, func(e QueryEntry) bool { return e.ID == id })
		if i < 0 {
			return errors.New("saved query no longer exists")
		}
		switch action {
		case "delete":
			entries = slices.Delete(entries, i, i+1)
		case "favorite":
			if !entries[i].Favorite {
				count := 0
				for _, e := range entries {
					if e.Favorite {
						count++
					}
				}
				if count >= maxFavorites {
					return errors.New("maximum of 100 favorites reached")
				}
			}
			entries[i].Favorite = !entries[i].Favorite
			if !entries[i].History && !entries[i].Favorite {
				entries = slices.Delete(entries, i, i+1)
			}
		default:
			return errors.New("unknown query library action")
		}
	}
	return s.commit(entries)
}
