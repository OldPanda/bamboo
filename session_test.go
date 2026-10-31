package main

import (
	"bamboo/internal/engine"
	"bamboo/internal/fixtures"
	"bamboo/internal/workspace"
	"context"
	"crypto/sha256"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"
)

// These child processes exercise the production Workbench and release DuckDB
// without a desktop window, shared in-memory stores, or the user's settings.
func TestSessionAcrossProcesses(t *testing.T) {
	if config := os.Getenv("BAMBOO_SESSION_TEST_CONFIG"); config != "" {
		root := os.Getenv("BAMBOO_SESSION_TEST_ROOT")
		outside := filepath.Join(filepath.Dir(root), "independent.parquet")
		w := &Workbench{folders: workspace.New(config), engine: engine.New()}
		defer w.engine.Close()
		ctx := context.Background()
		switch os.Getenv("BAMBOO_SESSION_TEST_PHASE") {
		case "create":
			if _, err := w.useWorkspace(root); err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"orders.parquet", "special.parquet"} {
				if _, err := w.OpenWorkspaceFile(ctx, root, name); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := w.OpenPath(ctx, outside); err != nil {
				t.Fatal(err)
			}
		case "restore":
			r, err := w.RestoreWorkspaces()
			if err != nil || len(r.Workspaces) != 1 || len(r.Session.Files) != 3 || r.Session.Active != outside {
				t.Fatal(r, err)
			}
			// No engine or historical query was opened merely by restoring metadata.
			if _, err = w.Query(ctx, engine.Request{SQL: "SELECT * FROM data", Limit: 1}); err == nil {
				t.Fatal("restore opened an engine")
			}
			if _, err = w.OpenPath(ctx, r.Session.Active); err != nil {
				t.Fatal(err)
			}
			rows, err := w.Query(ctx, engine.Request{SQL: workspace.DefaultSQL, Limit: 100})
			if err != nil || len(rows.Rows) != 100 {
				t.Fatal(rows, err)
			}
			if err = w.CloseFile(outside); err != nil {
				t.Fatal(err)
			}
			if err = w.CloseWorkspaceFile(root, "special.parquet"); err != nil {
				t.Fatal(err)
			}
		case "closed":
			r, err := w.RestoreWorkspaces()
			if err != nil || len(r.Session.Files) != 1 || !slices.Contains(r.Session.Files, filepath.Join(root, "orders.parquet")) {
				t.Fatal(r, err)
			}
			if err = w.CloseWorkspace(root); err != nil {
				t.Fatal(err)
			}
		case "empty":
			r, err := w.RestoreWorkspaces()
			if err != nil || len(r.Workspaces) != 0 || len(r.Session.Files) != 0 {
				t.Fatal(r, err)
			}
		}
		return
	}
	base := t.TempDir()
	base, _ = filepath.EvalSymlinks(base)
	root := filepath.Join(base, "data")
	if err := fixtures.Generate(root, false); err != nil {
		t.Fatal(err)
	}
	source, _ := os.ReadFile(filepath.Join(root, "orders.parquet"))
	outside := filepath.Join(base, "independent.parquet")
	if err := os.WriteFile(outside, source, 0600); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, phase := range []string{"create", "restore", "closed", "empty"} {
		if phase == "restore" {
			os.Remove(filepath.Join(root, "special.parquet"))
		}
		cmd := exec.Command(executable, "-test.run=^TestSessionAcrossProcesses$")
		cmd.Env = append(os.Environ(), "BAMBOO_SESSION_TEST_CONFIG="+filepath.Join(base, "config"), "BAMBOO_SESSION_TEST_ROOT="+root, "BAMBOO_SESSION_TEST_PHASE="+phase)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%s: %v\n%s", phase, err, output)
		}
	}
	for _, f := range []string{outside, filepath.Join(root, "orders.parquet")} {
		after, err := os.ReadFile(f)
		if err != nil || sha256.Sum256(after) != sha256.Sum256(source) {
			t.Fatal("source changed", err)
		}
	}
}
