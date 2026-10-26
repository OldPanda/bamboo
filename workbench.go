package main

import (
	"bamboo/internal/engine"
	"bamboo/internal/r2"
	"bamboo/internal/workspace"
	"context"
	"encoding/json"
	"errors"
	"github.com/egoist/mygo"
	"io"
	"os"
	"path/filepath"
	"sync"
)

// fileDialogs is the native boundary; tests use a dialog double without opening UI.
type fileDialogs interface {
	Open(mygo.OpenDialogOptions) ([]string, error)
	Save(mygo.SaveDialogOptions) (string, error)
}

// Workbench exposes only local file selection, bounded queries and explicit export.
type Workbench struct {
	engine       *engine.Engine
	remote       *r2.Store
	remoteCancel context.CancelFunc
	folders      *workspace.Store
	mu           sync.Mutex
	opMu         sync.Mutex
	last         *engine.Result
	initial      string
	dialogs      fileDialogs
}

func (w *Workbench) InitialFile() string { return w.initial }
func (w *Workbench) Open(ctx context.Context) (*engine.File, error) {
	paths, err := w.dialogs.Open(mygo.OpenDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "Open a Parquet file", Filters: []mygo.FileFilter{{Name: "Parquet", Extensions: []string{"parquet"}}}})
	if err != nil || len(paths) == 0 {
		return nil, err
	}
	return w.OpenPath(ctx, paths[0])
}
func (w *Workbench) OpenPath(ctx context.Context, path string) (*engine.File, error) {
	if !w.opMu.TryLock() {
		return nil, errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	f, err := w.engine.Open(ctx, path)
	if err == nil {
		w.mu.Lock()
		w.last = nil
		w.mu.Unlock()
	}
	return f, err
}
func (w *Workbench) Query(ctx context.Context, r engine.Request) (*engine.Result, error) {
	if !w.opMu.TryLock() {
		return nil, errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	result, err := w.engine.Query(ctx, r)
	if err == nil {
		w.mu.Lock()
		w.last = result
		w.mu.Unlock()
	}
	return result, err
}
func (w *Workbench) Cancel() {
	w.mu.Lock()
	if w.remoteCancel != nil {
		w.remoteCancel()
	}
	w.mu.Unlock()
	w.engine.Cancel()
}

// ExportPage saves the last successful page as typed JSON, keeping null distinct
// from empty text and preserving numeric precision. It never re-runs the query.
func (w *Workbench) ExportPage(ctx context.Context) (string, error) {
	w.mu.Lock()
	r := w.last
	w.mu.Unlock()
	if r == nil {
		return "", errors.New("run a query before exporting")
	}
	path, err := w.dialogs.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "Export visible page as JSON", DefaultPath: "bamboo-page.json", Filters: []mygo.FileFilter{{Name: "JSON", Extensions: []string{"json"}}}})
	if err != nil || path == "" {
		return "", err
	}
	if filepath.Ext(path) != ".json" {
		return "", errors.New("export filename must end in .json")
	}
	return path, writeExport(path, r)
}
func writeExport(path string, r *engine.Result) error {
	return writeExportWith(path, r, func(path string) (io.WriteCloser, error) {
		return os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	})
}

// writeExportWith keeps file creation and write/close failure handling testable.
func writeExportWith(path string, r *engine.Result, create func(string) (io.WriteCloser, error)) error {
	// O_EXCL also prevents symlink replacement and accidental source overwrites.
	f, err := create(path)
	if err != nil {
		return errors.New("choose a new filename; existing files are never overwritten")
	}
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	err = enc.Encode(r)
	closeErr := f.Close()
	if err != nil {
		os.Remove(path)
		return err
	}
	if closeErr != nil {
		os.Remove(path)
	}
	return closeErr
}
