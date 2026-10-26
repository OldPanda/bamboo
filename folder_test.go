package main

import (
	"bamboo/internal/workspace"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestFolderWorkbench(t *testing.T) {
	w, d, root := workbench(t)
	root, _ = filepath.EvalSymlinks(root)
	w.folders = workspace.New(t.TempDir())
	ctx := context.Background()
	if i, e := w.RestoreWorkspace(); e != nil || i != nil {
		t.Fatal(i, e)
	}
	if i, e := w.OpenWorkspace(ctx); e != nil || i != nil {
		t.Fatal(i, e)
	}
	d.err = errors.New("picker")
	if _, e := w.OpenWorkspace(ctx); e == nil {
		t.Fatal("picker error")
	}
	d.err = nil
	d.paths = []string{root}
	i, e := w.OpenWorkspace(ctx)
	if e != nil || i.Root != root || !d.openOptions.Directory {
		t.Fatal(i, e)
	}
	if p, e := w.ListDirectory(root, ".", 0); e != nil || len(p.Entries) == 0 {
		t.Fatal(p, e)
	}
	if _, e = w.RenameWorkspace(root, "Research"); e != nil {
		t.Fatal(e)
	}
	if e = w.SaveWorkspaceQuery(root, "orders.parquet", "SELECT draft", "SELECT 7"); e != nil {
		t.Fatal(e)
	}
	f, e := w.OpenWorkspaceFile(ctx, root, "orders.parquet")
	if e != nil || f.File.Rows != "240" || f.Query.Draft != "SELECT draft" {
		t.Fatal(f, e)
	}
	if i, e = w.RestoreWorkspace(); e != nil || i.Active != "orders.parquet" {
		t.Fatal(i, e)
	}
	for _, rel := range []string{"../escape", "malformed.parquet", "missing.parquet", "."} {
		if _, e = w.OpenWorkspaceFile(ctx, root, rel); e == nil {
			t.Fatal(rel)
		}
	}
	w.opMu.Lock()
	if _, e = w.useWorkspace(root); e == nil {
		t.Fatal("busy")
	}
	if _, e = w.OpenWorkspaceFile(ctx, root, "orders.parquet"); e == nil {
		t.Fatal("busy open")
	}
	w.opMu.Unlock()
	if e = w.LeaveWorkspace(); e != nil {
		t.Fatal(e)
	}
	if _, e = w.OpenWorkspaceFile(ctx, root, "orders.parquet"); e == nil {
		t.Fatal("closed workspace")
	}
	// File data remains available if only saving recent-file state fails.
	config := t.TempDir()
	w.folders = workspace.New(config)
	w.useWorkspace(root)
	os.Remove(filepath.Join(config, "workspaces.json"))
	os.Remove(config)
	os.WriteFile(config, nil, 0600)
	f, e = w.OpenWorkspaceFile(ctx, root, "orders.parquet")
	if e != nil || f.Warning == "" || f.File == nil {
		t.Fatal(f, e)
	}
}
