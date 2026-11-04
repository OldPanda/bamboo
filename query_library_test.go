package main

import (
	"bamboo/internal/engine"
	"bamboo/internal/querylibrary"
	"bamboo/internal/workspace"
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"sync"
	"testing"
)

func TestQueryLibraryWorkbench(t *testing.T) {
	w, _, dir := workbench(t)
	w.configDir = t.TempDir()
	w.folders = workspace.New(w.configDir)
	ctx := context.Background()
	scope := querylibrary.QueryScope{Kind: "file", Path: w.initial}
	if w.RememberQuery(scope, "SELECT 1") == nil {
		t.Fatal("no successful query")
	}
	opened, err := w.OpenPath(ctx, w.initial)
	if err != nil {
		t.Fatal(err)
	}
	scope.Path = opened.Path
	before, err := os.ReadFile(w.initial)
	if err != nil {
		t.Fatal(err)
	}
	sql := "SELECT 9223372036854775807::BIGINT AS exact FROM data"
	readPage(t, w, sql)
	entries, err := w.QueryLibrary()
	if err != nil || len(entries) != 0 {
		t.Fatal("preview polluted history", entries, err)
	}
	for _, bad := range []querylibrary.QueryScope{{Kind: "workspace", Path: w.initial}, {Kind: "file", Path: "/other"}} {
		if w.RememberQuery(bad, sql) == nil {
			t.Fatal("wrong source")
		}
	}
	if w.RememberQuery(scope, "SELECT 2") == nil {
		t.Fatal("wrong SQL")
	}
	if err = w.RememberQuery(scope, sql); err != nil {
		t.Fatal(err)
	}
	if err = w.SaveFavorite(scope, sql); err != nil {
		t.Fatal(err)
	}
	entries, err = w.QueryLibrary()
	if err != nil || len(entries) != 1 || !entries[0].Favorite || !entries[0].History {
		t.Fatal(entries, err)
	}
	if _, err = w.Query(ctx, engine.Request{SQL: "SELECT missing FROM data"}); err == nil {
		t.Fatal("bad query accepted")
	}
	entries, _ = w.QueryLibrary()
	if len(entries) != 1 {
		t.Fatal("failed query polluted history")
	}
	if err = w.ChangeSavedQuery("", "clear"); err != nil {
		t.Fatal(err)
	}
	restarted := &Workbench{configDir: w.configDir}
	entries, err = restarted.QueryLibrary()
	if err != nil || len(entries) != 1 || entries[0].History || entries[0].SQL != sql {
		t.Fatal(entries, err)
	}
	if err = w.ChangeSavedQuery(entries[0].ID, "delete"); err != nil {
		t.Fatal(err)
	}
	info, err := w.useWorkspace(dir)
	if err != nil {
		t.Fatal(err)
	}
	q := "SELECT count(*) FROM workspace.\"orders.parquet\""
	if _, err = w.QueryWorkspace(ctx, info.Root, engine.Request{SQL: q, Limit: 100}); err != nil {
		t.Fatal(err)
	}
	if err = w.RememberQuery(querylibrary.QueryScope{Kind: "workspace", Path: info.Root}, q); err != nil {
		t.Fatal(err)
	}
	w.opMu.Lock()
	if w.RememberQuery(scope, sql) == nil {
		t.Fatal("concurrent record accepted")
	}
	w.opMu.Unlock()
	after, err := os.ReadFile(w.initial)
	if err != nil || sha256.Sum256(before) != sha256.Sum256(after) {
		t.Fatal("source changed", err)
	}
}

func TestQueryLibraryWriteFailurePreservesResult(t *testing.T) {
	w, _, _ := workbench(t)
	w.configDir = t.TempDir()
	ctx := context.Background()
	if _, err := w.OpenPath(ctx, w.initial); err != nil {
		t.Fatal(err)
	}
	readPage(t, w, "SELECT 1")
	if err := os.Mkdir(w.configDir+"/query-library.json", 0700); err != nil {
		t.Fatal(err)
	}
	if w.RememberQuery(querylibrary.QueryScope{Kind: "file", Path: w.initial}, "SELECT 1") == nil {
		t.Fatal("bad settings accepted")
	}
	if w.last == nil || *w.last.Rows[0][0] != "1" {
		t.Fatal("successful result lost")
	}
}

func TestQueryLibraryConcurrentFavorites(t *testing.T) {
	w := &Workbench{configDir: t.TempDir()}
	scope := querylibrary.QueryScope{Kind: "file", Path: "/synthetic/data.parquet"}
	var group sync.WaitGroup
	for i := range 20 {
		group.Add(1)
		go func() {
			defer group.Done()
			if err := w.SaveFavorite(scope, fmt.Sprintf("SELECT %d", i)); err != nil {
				t.Error(err)
			}
			if _, err := w.QueryLibrary(); err != nil {
				t.Error(err)
			}
		}()
	}
	group.Wait()
	entries, err := w.QueryLibrary()
	if err != nil || len(entries) != 20 {
		t.Fatal(len(entries), err)
	}
}

func TestNamedQueryWorkbenchPersistence(t *testing.T) {
	w := &Workbench{configDir: t.TempDir()}
	scope := querylibrary.QueryScope{Kind: "file", Path: "/synthetic/data.parquet"}
	if err := w.SaveNamedQuery(scope, "SELECT 9223372036854775807", "Daily count"); err != nil {
		t.Fatal(err)
	}
	entries, err := w.QueryLibrary()
	if err != nil {
		t.Fatal(err)
	}
	if err = w.RenameSavedQuery(entries[0].ID, "Daily <img> total"); err != nil {
		t.Fatal(err)
	}
	restarted := &Workbench{configDir: w.configDir}
	entries, err = restarted.QueryLibrary()
	if err != nil || entries[0].Name != "Daily <img> total" || entries[0].SQL != "SELECT 9223372036854775807" || entries[0].Scope != scope {
		t.Fatal(entries, err)
	}
	if w.SaveNamedQuery(scope, "SELECT 1", "") == nil || w.RenameSavedQuery("missing", "name") == nil {
		t.Fatal("invalid name/id accepted")
	}
}
