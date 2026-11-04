package main

import (
	"bamboo/internal/querylibrary"
	"errors"
)

func (w *Workbench) library() *querylibrary.Store {
	if w.queries == nil {
		w.queries = querylibrary.New(w.configDir)
	}
	return w.queries
}

// QueryLibrary lists local history and favorites without opening sources or executing SQL.
func (w *Workbench) QueryLibrary() ([]querylibrary.QueryEntry, error) {
	w.libraryMu.Lock()
	defer w.libraryMu.Unlock()
	return w.library().Entries()
}

// RememberQuery records only the exact successful, unfiltered first-page snapshot.
// The frontend invokes this after explicit Run, never after preview, sorting or pagination.
func (w *Workbench) RememberQuery(scope querylibrary.QueryScope, sql string) error {
	if !w.opMu.TryLock() {
		return errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	w.mu.Lock()
	valid := w.last != nil && w.lastRequest.SQL == sql && w.lastRequest.Offset == 0 && w.lastRequest.Sort == "" && w.lastRequest.FilterColumn == ""
	root := w.lastRoot
	w.mu.Unlock()
	expected := querylibrary.QueryScope{Kind: "workspace", Path: root}
	if root == "" {
		expected = querylibrary.QueryScope{Kind: "file", Path: w.engine.CurrentPath()}
	}
	if !valid || scope != expected {
		return errors.New("query history requires the current successful query")
	}
	w.libraryMu.Lock()
	defer w.libraryMu.Unlock()
	return w.library().Save(scope, sql, false)
}

// SaveFavorite saves a draft for its displayed source; it never executes or authorizes SQL.
func (w *Workbench) SaveFavorite(scope querylibrary.QueryScope, sql string) error {
	w.libraryMu.Lock()
	defer w.libraryMu.Unlock()
	return w.library().Save(scope, sql, true)
}

// ChangeSavedQuery changes membership or deletes local entries without touching data files.
func (w *Workbench) ChangeSavedQuery(id, action string) error {
	w.libraryMu.Lock()
	defer w.libraryMu.Unlock()
	return w.library().Change(id, action)
}

// SaveNamedQuery saves a named editor snapshot without executing SQL.
func (w *Workbench) SaveNamedQuery(scope querylibrary.QueryScope, sql, name string) error {
	w.libraryMu.Lock()
	defer w.libraryMu.Unlock()
	return w.library().SaveNamed(scope, sql, name)
}

// RenameSavedQuery updates a saved title without changing its SQL or original source.
func (w *Workbench) RenameSavedQuery(id, name string) error {
	w.libraryMu.Lock()
	defer w.libraryMu.Unlock()
	return w.library().Rename(id, name)
}
