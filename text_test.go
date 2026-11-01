package main

import (
	"bamboo/internal/datafile"
	"bamboo/internal/engine"
	"bamboo/internal/workspace"
	"context"
	"crypto/sha256"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestTextInputSessionWorkspaceAndExport(t *testing.T) {
	w, d, dir := workbench(t)
	config := t.TempDir()
	w.folders = workspace.New(config)
	path := filepath.Join(dir, "data.csv")
	text := "id,value\n1001,9223372036854775807\n1002,000123\n"
	if err := os.WriteFile(path, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	d.paths = []string{path}
	f, err := w.Open(context.Background())
	if err != nil || f.TextOptions == nil {
		t.Fatal(f, err)
	}
	path = f.Path
	readPage(t, w, "SELECT * FROM data")
	d.path = filepath.Join(dir, "original.jsonl")
	if _, err = w.ExportFullAs(context.Background(), "jsonl"); err != nil {
		t.Fatal(err)
	}
	if err = w.SetTextOptions(path, datafile.TextOptions{Delimiter: ","}); err != nil {
		t.Fatal(err)
	}
	if _, err = w.ExportFullAs(context.Background(), "json"); err == nil {
		t.Fatal("stale export after interpretation change")
	}
	w.folders = workspace.New(config)
	if got := w.folders.MigrateSession(nil); got.Active != path || len(got.Files) != 1 {
		t.Fatal(got)
	}
	info, err := w.useWorkspace(dir)
	if err != nil {
		t.Fatal(err)
	}
	listing, err := w.ListDirectory(info.Root, ".", 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, entry := range listing.Entries {
		found = found || entry.Name == "data.csv"
	}
	if !found {
		t.Fatal("CSV not discovered")
	}
	opened, err := w.OpenWorkspaceFile(context.Background(), info.Root, "data.csv")
	if err != nil || opened.File.TextOptions.Header {
		t.Fatal(opened, err)
	}
	r := readPage(t, w, "SELECT * FROM data")
	if len(r.Rows) != 3 || *r.Rows[0][0] != "id" {
		t.Fatal(r)
	}
	if err = w.SetTextOptions(path, datafile.TextOptions{Delimiter: ",", Header: true, InferTypes: true}); err != nil {
		t.Fatal(err)
	}
	r, err = w.QueryWorkspace(context.Background(), info.Root, engine.Request{SQL: `SELECT c.id, p.city FROM workspace."data.csv" c JOIN workspace."orders.parquet" p ON c.id=p.order_id ORDER BY c.id`, Limit: 1})
	if err != nil || r.Columns[0].Type != "BIGINT" || len(r.Rows) != 1 || !r.More {
		t.Fatal(r, err)
	}
	d.path = filepath.Join(dir, "joined.json")
	if _, err = w.ExportFullAs(context.Background(), "json"); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(d.path)
	if err != nil {
		t.Fatal(err)
	}
	var output engine.Result
	if err = json.Unmarshal(b, &output); err != nil || len(output.Rows) != 2 || *output.Rows[1][0] != "1002" {
		t.Fatal(output, err)
	}
	after, err := os.ReadFile(path)
	if err != nil || sha256.Sum256(after) != sha256.Sum256([]byte(text)) {
		t.Fatal("source modified", err)
	}
}

func TestSetTextOptionsFailures(t *testing.T) {
	w, _, dir := workbench(t)
	options := datafile.DefaultTextOptions("a.csv")
	if err := w.SetTextOptions(filepath.Join(dir, "a.csv"), options); err == nil {
		t.Fatal("no settings store")
	}
	w.folders = workspace.New(t.TempDir())
	w.opMu.Lock()
	err := w.SetTextOptions(filepath.Join(dir, "a.csv"), options)
	w.opMu.Unlock()
	if err == nil {
		t.Fatal("busy")
	}
	for _, path := range []string{"relative.csv", filepath.Join(dir, "missing.csv"), w.initial} {
		if err = w.SetTextOptions(path, options); err == nil {
			t.Fatal(path)
		}
	}
	path := filepath.Join(dir, "folder.csv")
	if err = os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err = w.SetTextOptions(path, options); err == nil {
		t.Fatal("directory")
	}
	path = filepath.Join(dir, "a.csv")
	if err = os.WriteFile(path, []byte("a\n1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = w.SetTextOptions(path, datafile.TextOptions{Delimiter: "\n"}); err == nil {
		t.Fatal("invalid delimiter")
	}
}
