package main

import (
	"bamboo/internal/engine"
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
	if i, e := w.folders.Restore(); e != nil || i != nil {
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
	if i, e = w.folders.Restore(); e != nil || i.Active != "orders.parquet" {
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
	if e = w.folders.Leave(); e != nil {
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

func TestMultiWorkspaceService(t *testing.T) {
	w, _, root := workbench(t)
	root, _ = filepath.EvalSymlinks(root)
	w.folders = workspace.New(t.TempDir())
	w.useWorkspace(root)
	r, e := w.RestoreWorkspaces()
	if e != nil || len(r.Workspaces) != 1 {
		t.Fatal(r, e)
	}
	if _, e = w.OpenWorkspaceFile(context.Background(), root, "orders.parquet"); e != nil {
		t.Fatal(e)
	}
	readPage(t, w, "SELECT * FROM data")
	w.opMu.Lock()
	if e = w.ClearPreview(); e == nil {
		t.Fatal("cleared busy engine")
	}
	w.opMu.Unlock()
	if e = w.ClearPreview(); e != nil || w.last != nil {
		t.Fatal(e)
	}
	if _, e = w.Query(context.Background(), engine.Request{SQL: "SELECT * FROM data", Limit: 1}); e == nil {
		t.Fatal("query after close")
	}
	if e = w.CloseWorkspaceFile(root, "orders.parquet"); e != nil {
		t.Fatal(e)
	}
	if e = w.CloseWorkspace(root); e != nil {
		t.Fatal(e)
	}
}

func TestWorkspaceCrossFileService(t *testing.T) {
	w, _, root := workbench(t)
	root, _ = filepath.EvalSymlinks(root)
	w.folders = workspace.New(t.TempDir())
	if _, err := w.useWorkspace(root); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := w.OpenWorkspaceFile(ctx, root, "orders.parquet"); err != nil {
		t.Fatal(err)
	}
	r, err := w.Query(ctx, engine.Request{SQL: `SELECT a.order_id, b.big_id FROM data a CROSS JOIN workspace."special.parquet" b ORDER BY a.order_id`, Limit: 2})
	if err != nil || len(r.Rows) != 2 || *r.Rows[0][1] != "9223372036854775807" || w.last != r {
		t.Fatal(r, err)
	}
	if err = w.CloseWorkspace(root); err != nil {
		t.Fatal(err)
	}
	if _, err = w.Query(ctx, engine.Request{SQL: `SELECT * FROM workspace."special.parquet"`, Limit: 1}); err == nil {
		t.Fatal("closed scope accessible")
	}
	if _, err = w.OpenPath(ctx, filepath.Join(root, "orders.parquet")); err != nil {
		t.Fatal(err)
	}
	if _, err = w.Query(ctx, engine.Request{SQL: `SELECT * FROM workspace."special.parquet"`, Limit: 1}); err == nil {
		t.Fatal("standalone retained workspace")
	}
}

func TestIndependentWorkspaceQuery(t *testing.T) {
	w, _, root := workbench(t)
	root, _ = filepath.EvalSymlinks(root)
	w.folders = workspace.New(t.TempDir())
	if _, err := w.useWorkspace(root); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	q, err := w.OpenWorkspaceQuery(root)
	if err != nil || q.Draft != "" || q.Applied != "" {
		t.Fatal(q, err)
	}
	// No document has been opened, but direct cross-file SQL and constant queries work.
	sql := `SELECT count(*) FROM workspace."orders.parquet" a CROSS JOIN workspace."special.parquet" b`
	r, err := w.QueryWorkspace(ctx, root, engine.Request{SQL: sql, Limit: 100})
	if err != nil || *r.Rows[0][0] != "240" || w.last != r {
		t.Fatal(r, err)
	}
	if err = w.SaveWorkspaceQuery(root, ".", sql+" -- draft", sql); err != nil {
		t.Fatal(err)
	}
	q, err = w.OpenWorkspaceQuery(root)
	if err != nil || q.Draft != sql+" -- draft" || q.Applied != sql {
		t.Fatal(q, err)
	}
	restored, err := w.RestoreWorkspaces()
	if err != nil || restored.Workspaces[0].Active != "." {
		t.Fatal(restored, err)
	}
	if _, err = w.QueryWorkspace(ctx, root, engine.Request{SQL: "SELECT 1", Limit: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err = w.OpenWorkspaceFile(ctx, root, "orders.parquet"); err != nil {
		t.Fatal(err)
	}
	if _, err = w.QueryWorkspace(ctx, root, engine.Request{SQL: "SELECT * FROM data", Limit: 1}); err == nil {
		t.Fatal("workspace-only query inherited a file alias")
	}
	if _, err = w.QueryWorkspace(ctx, root, engine.Request{SQL: `SELECT * FROM workspace."../outside.parquet"`, Limit: 1}); err == nil {
		t.Fatal("traversal")
	}
	w.opMu.Lock()
	_, err = w.QueryWorkspace(ctx, root, engine.Request{SQL: sql, Limit: 1})
	w.opMu.Unlock()
	if err == nil {
		t.Fatal("busy query accepted")
	}
	if err = w.ClearPreview(); err != nil {
		t.Fatal(err)
	}
	if _, err = w.Query(ctx, engine.Request{SQL: "SELECT * FROM data", Limit: 1}); err == nil {
		t.Fatal("closed file scope reused")
	}
	if err = w.CloseWorkspace(root); err != nil {
		t.Fatal(err)
	}
	if _, err = w.QueryWorkspace(ctx, root, engine.Request{SQL: sql, Limit: 1}); err == nil {
		t.Fatal("closed workspace query")
	}
	if _, err = w.OpenWorkspaceQuery(root); err == nil {
		t.Fatal("closed workspace restored")
	}
}
