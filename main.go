package main

import (
	"bamboo/internal/engine"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/egoist/mygo"
)

//go:embed all:frontend/dist
var frontend embed.FS

// Workbench exposes only local file selection, bounded queries and explicit export.
type Workbench struct {
	engine  *engine.Engine
	mu      sync.Mutex
	opMu    sync.Mutex
	last    *engine.Result
	initial string
}

func (w *Workbench) InitialFile() string { return w.initial }
func (w *Workbench) Open(ctx context.Context) (*engine.File, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "Open a Parquet file", Filters: []mygo.FileFilter{{Name: "Parquet", Extensions: []string{"parquet"}}}})
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
func (w *Workbench) Cancel() { w.engine.Cancel() }

// ExportPage saves the last successful page as typed JSON, keeping null distinct
// from empty text and preserving numeric precision. It never re-runs the query.
func (w *Workbench) ExportPage(ctx context.Context) (string, error) {
	w.mu.Lock()
	r := w.last
	w.mu.Unlock()
	if r == nil {
		return "", errors.New("run a query before exporting")
	}
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "Export visible page as JSON", DefaultPath: "bamboo-page.json", Filters: []mygo.FileFilter{{Name: "JSON", Extensions: []string{"json"}}}})
	if err != nil || path == "" {
		return "", err
	}
	if filepath.Ext(path) != ".json" {
		return "", errors.New("export filename must end in .json")
	}
	return path, writeExport(path, r)
}
func writeExport(path string, r *engine.Result) error {
	// O_EXCL also prevents symlink replacement and accidental source overwrites.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
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
func main() {
	mygo.App.SetName("Bamboo")
	e := engine.New()
	defer e.Close()
	initial := ""
	if len(os.Args) == 3 && os.Args[1] == "--file" {
		initial, _ = filepath.Abs(os.Args[2])
	}
	w := &Workbench{engine: e, initial: initial}
	mygo.Bind(w)
	web, err := fs.Sub(frontend, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	mygo.SetFrontend(web)
	mygo.App.WhenReady(func() {
		win := mygo.NewWindow(mygo.WindowOptions{Title: "Bamboo", Width: 1280, Height: 820, MinWidth: 700, MinHeight: 520, URL: "/", BackgroundColor: "#f7f8f5"})
		win.Page().OnWillNavigate(func(ev *mygo.NavigateEvent) { ev.PreventDefault() })
		win.Page().SetWindowOpenHandler(func(mygo.WindowOpenRequest) *mygo.WindowOptions { return nil })
		if os.Getenv("BAMBOO_SMOKE") != "" {
			go smoke(win)
		}
	})
	if err = mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
