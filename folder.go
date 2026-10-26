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
func (w *Workbench) RestoreWorkspace() (*workspace.Info, error) { return w.folders.Restore() }
func (w *Workbench) LeaveWorkspace() error                      { return w.folders.Leave() }
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
	f, err := w.engine.Open(ctx, path)
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
