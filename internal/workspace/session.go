package workspace

import (
	"errors"
	"path"
	"path/filepath"
	"slices"
	"strings"
)

// Session remembers open file identities and the selected file or workspace.
// It contains no credentials, results or executable SQL; files reopen lazily.
type Session struct {
	Files  []string `json:"files"`
	Active string   `json:"active"`
}

func validLocation(value string) bool {
	if len(value) > 32768 || strings.ContainsRune(value, 0) {
		return false
	}
	if strings.HasPrefix(value, "s3://") || strings.HasPrefix(value, "r2://") {
		rest := value[5:]
		return rest != "" && path.Clean(rest) == rest && !strings.HasPrefix(rest, "/") && !strings.Contains(rest, "\\") && !strings.HasPrefix(rest, "../")
	}
	return filepath.IsAbs(value) && filepath.Clean(value) == value
}
func validSession(v *Session) bool {
	if v.Files == nil || len(v.Files) > 128 || (v.Active != "" && !validLocation(v.Active)) {
		return false
	}
	seen := map[string]bool{}
	for _, f := range v.Files {
		if !validLocation(f) || !strings.EqualFold(path.Ext(f), ".parquet") || seen[f] {
			return false
		}
		seen[f] = true
	}
	return true
}
func session(d *state) *Session {
	if d.Session == nil {
		d.Session = &Session{Files: []string{}}
		// Migrate the last file per folder from older versions. Unknown historical
		// standalone documents were never stored and cannot be reconstructed.
		roots := slices.Clone(d.Open)
		if d.Last != "" && !slices.Contains(roots, d.Last) {
			roots = append(roots, d.Last)
		}
		for _, root := range roots {
			if p := d.Profiles[root]; p != nil && p.Active != "" && p.Active != "." {
				location := filepath.Join(root, p.Active)
				if !slices.Contains(d.Session.Files, location) {
					d.Session.Files = append(d.Session.Files, location)
				}
			}
		}
	}
	return d.Session
}
func remember(d *state, location string, file bool) error {
	v := session(d)
	if !validLocation(location) {
		return errors.New("invalid session location")
	}
	if file && !slices.Contains(v.Files, location) {
		if len(v.Files) >= 128 {
			return errors.New("maximum of 128 open files reached")
		}
		v.Files = append(v.Files, location)
	}
	v.Active = location
	return nil
}
func forgetFile(d *state, location string) {
	v := session(d)
	v.Files = slices.DeleteFunc(v.Files, func(f string) bool { return f == location })
	if v.Active == location {
		v.Active = ""
	}
}
func localOwner(d *state, file string) string {
	owner := ""
	for _, root := range d.Open {
		rel, err := filepath.Rel(root, file)
		if err == nil && relative(rel) && len(root) > len(owner) {
			owner = root
		}
	}
	return owner
}
func forgetRoot(d *state, root string) {
	v := session(d)
	v.Files = slices.DeleteFunc(v.Files, func(f string) bool {
		owned := localOwner(d, f) == root || strings.HasPrefix(f, root+"/") && strings.Contains(root, "://")
		if owned && v.Active == f {
			v.Active = ""
		}
		return owned
	})
	if v.Active == root {
		v.Active = ""
	}
}

// Remember records a successfully opened file or selected workspace atomically.
func (s *Store) Remember(location string, file bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.copy()
	if err := remember(&d, location, file); err != nil {
		return err
	}
	return s.commit(d)
}

// Forget removes an explicitly closed file without deleting its source.
func (s *Store) Forget(location string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.copy()
	forgetFile(&d, location)
	return s.commit(d)
}

// ForgetRoot removes session entries for an explicitly closed cloud workspace.
func (s *Store) ForgetRoot(root string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.copy()
	forgetRoot(&d, root)
	return s.commit(d)
}

// MigrateSession seeds legacy local and cloud selections without writing during
// restoration. The next successful user change persists this additive format.
func (s *Store) MigrateSession(infos []Info) *Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Session == nil {
		v := &Session{Files: []string{}}
		for _, info := range infos {
			v.Active = info.Root
			if info.Active != "" && info.Active != "." {
				location := filepath.Join(info.Root, info.Active)
				if strings.Contains(info.Root, "://") {
					location = info.Root + "/" + info.Active
				}
				if !slices.Contains(v.Files, location) {
					v.Files = append(v.Files, location)
				}
				v.Active = location
			}
		}
		if s.loadErr == nil {
			s.data.Session = v
		}
		return v
	}
	return s.copy().Session
}

// CloseCloud coordinates session cleanup with the cloud store's atomic change.
// A rejected cloud write restores the previous session; rollback failures are
// returned alongside the original error so neither failure is silently lost.
func (s *Store) CloseCloud(location string, root bool, closeCloud func() error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous := s.copy()
	d := s.copy()
	if root {
		forgetRoot(&d, location)
	} else {
		forgetFile(&d, location)
	}
	if err := s.commit(d); err != nil {
		return err
	}
	if err := closeCloud(); err != nil {
		return errors.Join(err, s.commit(previous))
	}
	return nil
}
