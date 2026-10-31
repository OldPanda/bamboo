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

// WorkspaceFile combines file metadata, restored SQL and any persistence warning.
type WorkspaceFile struct {
	File    *engine.File    `json:"file"`
	Query   workspace.Query `json:"query"`
	Warning string          `json:"warning"`
}

// OpenWorkspace shows a native folder chooser and opens the selected local workspace.
func (w *Workbench) OpenWorkspace(ctx context.Context) (*workspace.Info, error) {
	paths, err := w.dialogs.Open(mygo.OpenDialogOptions{Parent: mygo.CallerWindow(ctx), Title: w.languageText("Open a workspace folder", "打开工作区文件夹"), Directory: true})
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

// RenameWorkspace changes a local or cloud workspace display name.
func (w *Workbench) RenameWorkspace(root, name string) (*workspace.Info, error) {
	if isRemoteWorkspace(root) {
		return w.remote.Rename(root, name)
	}
	return w.folders.Rename(root, name)
}

// ListDirectory lists a bounded page inside a local or cloud workspace.
func (w *Workbench) ListDirectory(root, relative string, offset int) (*workspace.Page, error) {
	if isRemoteWorkspace(root) {
		if !w.opMu.TryLock() {
			return nil, errors.New("another operation is running")
		}
		defer w.opMu.Unlock()
		ctx, done := w.remoteOperation(context.Background())
		defer done()
		return w.remote.List(ctx, root, relative, offset)
	}
	return w.folders.List(root, relative, offset)
}

// SaveWorkspaceQuery persists separate editor draft and executed SQL for a workspace path.
func (w *Workbench) SaveWorkspaceQuery(root, relative, draft, applied string) error {
	if isRemoteWorkspace(root) {
		return w.remote.Save(root, relative, workspace.Query{Draft: draft, Applied: applied})
	}
	return w.folders.Save(root, relative, workspace.Query{Draft: draft, Applied: applied})
}

// OpenWorkspaceFile opens a scoped Parquet reader and restores its saved query.
func (w *Workbench) OpenWorkspaceFile(ctx context.Context, root, relative string) (*WorkspaceFile, error) {
	if !w.opMu.TryLock() {
		return nil, errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	if isRemoteWorkspace(root) {
		return w.openRemoteFile(ctx, root, relative)
	}
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

// RestoreWorkspaces reopens saved local and cloud workspaces with per-workspace warnings.
func (w *Workbench) RestoreWorkspaces() (*workspace.Restored, error) {
	restored, err := w.folders.RestoreAll()
	if err != nil {
		restored = &workspace.Restored{Workspaces: []workspace.Info{}, Warning: err.Error()}
	}
	if w.remote != nil {
		infos, remoteErr := w.remote.Restore()
		restored.Workspaces = append(restored.Workspaces, infos...)
		if remoteErr != nil {
			restored.Warning += " " + remoteErr.Error()
		}
	}
	restored.Session = w.folders.MigrateSession(restored.Workspaces)
	return restored, nil
}

// CloseWorkspace closes a local or cloud workspace while retaining its saved preferences.
func (w *Workbench) CloseWorkspace(root string) error {
	if isRemoteWorkspace(root) {
		if !w.opMu.TryLock() {
			return errors.New("another operation is running")
		}
		defer w.opMu.Unlock()
		return w.folders.CloseCloud(root, true, func() error { return w.remote.Close(root) })
	}
	return w.folders.Close(root)
}

// CloseWorkspaceFile clears a workspace file selection without removing the source object.
func (w *Workbench) CloseWorkspaceFile(root, relative string) error {
	if isRemoteWorkspace(root) {
		return w.folders.CloseCloud(root+"/"+relative, false, func() error { return w.remote.CloseFile(root, relative) })
	}
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
	if isRemoteWorkspace(root) {
		q, err := w.remote.Saved(root, ".")
		if err != nil {
			return q, err
		}
		if err = w.folders.Remember(root, false); err != nil {
			return q, err
		}
		return q, w.remote.Select(root, ".")
	}
	q, err := w.folders.Saved(root, ".")
	if err != nil {
		return q, err
	}
	return q, w.folders.Select(root, ".")
}

// QueryWorkspace runs a read-only query limited to the selected workspace.
func (w *Workbench) QueryWorkspace(ctx context.Context, root string, r engine.Request) (*engine.Result, error) {
	if !w.opMu.TryLock() {
		return nil, errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	if isRemoteWorkspace(root) {
		result, err := w.engine.QueryRemoteWorkspace(ctx, r, w.remote.Resolver(root))
		if err == nil {
			w.mu.Lock()
			w.last = result
			w.mu.Unlock()
		}
		return result, err
	}
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

// CloseFile forgets an independent file while retaining its source bytes.
func (w *Workbench) CloseFile(path string) error {
	return w.folders.Forget(path)
}
