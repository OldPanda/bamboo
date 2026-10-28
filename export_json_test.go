package main

import (
	"bamboo/internal/engine"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestExportPreservesValuesAndRefusesOverwrite(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "page.json")
	exact := "9223372036854775807"
	empty := ""
	r := &engine.Result{Columns: []engine.Column{{Name: "id", Type: "BIGINT"}}, Rows: [][]*string{{&exact, nil, &empty}}}
	if err := writeExport(p, r); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	var got engine.Result
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if *got.Rows[0][0] != exact || got.Rows[0][1] != nil || *got.Rows[0][2] != "" {
		t.Fatal("export lost values")
	}
	if err := writeExport(p, r); err == nil {
		t.Fatal("overwrote existing file")
	}
	link := filepath.Join(dir, "link.json")
	os.Symlink(p, link)
	if err := writeExport(link, r); err == nil {
		t.Fatal("followed symlink")
	}
	after, _ := os.ReadFile(p)
	if string(b) != string(after) {
		t.Fatal("existing file changed")
	}
}
