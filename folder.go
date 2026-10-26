package main

import (
	"bamboo/internal/engine"
	"bamboo/internal/workspace"
	"context"
	"errors"
	"github.com/egoist/mygo"
	"path/filepath"
	"strings"
)

type WorkspaceFile struct {
	File    *engine.File    `json:"file"`
	Query   workspace.Query `json:"query"`
	Warning string          `json:"warning"`
}

func (w *Workbench) OpenWorkspace(ctx context.Context) (*workspace.Info, error) {
	paths, err := w.dialogs.Open(mygo.OpenDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "Open a workspace folder", Directory: true})
	if err != nil || len(paths) == 0 {
		return nil, err
	}
	return w.useWorkspace(paths[0])
}
func (w *Workbench) useWorkspace(path string) (*workspace.Info, error) {
	if !w.opMu.TryLock() {
		return nil, errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	return w.folders.Use(path)
}
func (w *Workbench) RenameWorkspace(root, name string) (*workspace.Info, error) {
	return w.folders.Rename(root, name)
}
func (w *Workbench) ListDirectory(root, relative string, offset int) (*workspace.Page, error) {
	return w.folders.List(root, relative, offset)
}
func (w *Workbench) SaveWorkspaceQuery(root, relative, draft, applied string) error {
	return w.folders.Save(root, relative, workspace.Query{Draft: draft, Applied: applied})
}
func (w *Workbench) OpenWorkspaceFile(ctx context.Context, root, relative string) (*WorkspaceFile, error) {
	if !w.opMu.TryLock() {
		return nil, errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	path, err := w.folders.Resolve(root, relative)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(filepath.Ext(path), ".parquet") {
		return nil, errors.New("choose a Parquet file")
	}
	q, err := w.folders.Saved(root, relative)
	if err != nil {
		return nil, err
	}
	f, err := w.engine.OpenScoped(ctx, path, func(relative string) (string, error) { return w.folders.Resolve(root, relative) })
	if err != nil {
		return nil, err
	}
	w.mu.Lock()
	w.last = nil
	w.mu.Unlock()
	r := &WorkspaceFile{File: f, Query: q}
	if err = w.folders.Select(root, relative); err != nil {
		r.Warning = "File opened, but its recent-file state could not be saved: " + err.Error()
	}
	return r, nil
}

func (w *Workbench) RestoreWorkspaces() (*workspace.Restored, error) { return w.folders.RestoreAll() }
func (w *Workbench) CloseWorkspace(root string) error                { return w.folders.Close(root) }
func (w *Workbench) CloseWorkspaceFile(root, relative string) error {
	return w.folders.CloseFile(root, relative)
}

// ClearPreview releases the active engine after the last open file is closed.
func (w *Workbench) ClearPreview() error {
	if !w.opMu.TryLock() {
		return errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	w.engine.Close()
	w.mu.Lock()
	w.last = nil
	w.mu.Unlock()
	return nil
}

// OpenWorkspaceQuery restores the independent folder query and remembers this view.
func (w *Workbench) OpenWorkspaceQuery(root string) (workspace.Query, error) {
	q, err := w.folders.Saved(root, ".")
	if err != nil {
		return q, err
	}
	return q, w.folders.Select(root, ".")
}
func (w *Workbench) QueryWorkspace(ctx context.Context, root string, r engine.Request) (*engine.Result, error) {
	if !w.opMu.TryLock() {
		return nil, errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	if _, err := w.folders.Resolve(root, "."); err != nil {
		return nil, err
	}
	result, err := w.engine.QueryWorkspace(ctx, r, func(relative string) (string, error) { return w.folders.Resolve(root, relative) })
	if err == nil {
		w.mu.Lock()
		w.last = result
		w.mu.Unlock()
	}
	return result, err
}
