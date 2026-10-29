package engine

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRemoteFailuresReleaseScopeAndKeepLocalReader(t *testing.T) {
	e, dir := setup(t)
	extension, err := filepath.Abs("../../build/extensions/httpfs.duckdb_extension")
	if err != nil {
		t.Fatal(err)
	}
	if err = verifyHTTPFS(extension); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"resolver", "missing-extension", "invalid-resources", "invalid-parquet"} {
		t.Run(kind, func(t *testing.T) {
			e.SetHTTPFS(extension)
			e.resources = DefaultResources()
			if kind == "missing-extension" {
				e.SetHTTPFS(filepath.Join(dir, "missing-extension"))
			}
			if kind == "invalid-resources" {
				e.resources.TimeoutSeconds = 0
			}
			closed := 0
			var scopeCtx context.Context
			resolve := func(ctx context.Context, _ []string) (*RemoteScope, error) {
				scopeCtx = ctx
				if kind == "resolver" {
					return nil, errors.New("synthetic resolver failure")
				}
				return &RemoteScope{
					Paths: []string{filepath.Join(dir, "malformed.parquet")}, Sizes: []int64{10},
					Close: func() { closed++ }, Error: func() error { return nil },
				}, nil
			}
			if _, err := e.OpenRemote(context.Background(), "s3://fixture/data.parquet", "data.parquet", resolve); err == nil {
				t.Fatal("failed remote open succeeded")
			}
			if scopeCtx == nil || scopeCtx.Err() == nil {
				t.Fatal("failed open retained its context")
			}
			wantClosed := 1
			if kind == "resolver" {
				wantClosed = 0
			}
			if closed != wantClosed {
				t.Fatalf("scope closed %d times, want %d", closed, wantClosed)
			}
			e.resources = DefaultResources()
			result, err := e.Query(context.Background(), req("SELECT count(*) FROM data"))
			if err != nil || *result.Rows[0][0] != "240" {
				t.Fatal("previous local reader lost", err)
			}
		})
	}
}

func TestRemoteQueryFailureClosesScope(t *testing.T) {
	extension, err := filepath.Abs("../../build/extensions/httpfs.duckdb_extension")
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"missing-extension", "invalid-view"} {
		t.Run(kind, func(t *testing.T) {
			e := New()
			defer e.Close()
			e.SetHTTPFS(extension)
			if kind == "missing-extension" {
				e.SetHTTPFS(filepath.Join(t.TempDir(), "missing"))
			}
			closed := 0
			e.remoteRef = "base.parquet"
			e.remote = func(context.Context, []string) (*RemoteScope, error) {
				return &RemoteScope{
					Paths: []string{filepath.Join(t.TempDir(), "missing.parquet"), "unused.parquet"},
					Close: func() { closed++ }, Error: func() error { return nil },
				}, nil
			}
			db, cleanup, err := e.remoteDatabaseForQuery(context.Background(), []string{"other.parquet"})
			if err == nil || db != nil || cleanup != nil || closed != 1 || e.remoteScope != nil {
				t.Fatalf("failure leaked scope: %v %v %d", db, err, closed)
			}
		})
	}
}

func TestRemoteBusyNeverResolvesAndErrorsHideURLs(t *testing.T) {
	e := New()
	defer e.Close()
	e.gate <- struct{}{}
	resolve := func(context.Context, []string) (*RemoteScope, error) {
		t.Fatal("busy engine resolved a new scope")
		return nil, nil
	}
	if _, err := e.OpenRemote(context.Background(), "remote", "file", resolve); err == nil {
		t.Fatal("busy open accepted")
	}
	if _, err := e.QueryRemoteWorkspace(context.Background(), req("SELECT 1"), resolve); err == nil {
		t.Fatal("busy query accepted")
	}
	<-e.gate
	scope := &RemoteScope{Paths: []string{"http://127.0.0.1/private-capability"}, Error: func() error { return nil }}
	if remoteError(scope, nil) != nil {
		t.Fatal("successful result acquired an error")
	}
	err := remoteError(scope, errors.New("failed to read "+scope.Paths[0]))
	if strings.Contains(err.Error(), "private-capability") || !strings.Contains(err.Error(), "[cloud object]") {
		t.Fatal(err)
	}
	gatewayErr := errors.New("object changed during query")
	scope.Error = func() error { return gatewayErr }
	if !errors.Is(remoteError(scope, errors.New("opaque database failure")), gatewayErr) {
		t.Fatal("gateway cause lost")
	}
	bad := filepath.Join(t.TempDir(), "httpfs")
	if err := os.WriteFile(bad, []byte("untrusted extension"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifyHTTPFS(bad); err == nil {
		t.Fatal("unverified extension accepted")
	}
}

func TestDatabaseStartupFailuresDoNotLeaveSpillDirectories(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TMPDIR", dir)
	for _, spill := range []bool{false, true} {
		r := DefaultResources()
		r.TempAuto = spill
		r.TempGiB = 0
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if db, err := newDatabase(ctx, r); err == nil || db != nil {
			t.Fatal("canceled startup accepted")
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 0 {
		t.Fatal("failed startup retained spill files", entries, err)
	}
	t.Setenv("TMPDIR", filepath.Join(dir, "missing"))
	if db, err := newDatabase(context.Background()); err == nil || db != nil {
		t.Fatal("missing temp root accepted")
	}
	if _, err := availableDisk(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("missing volume accepted")
	}
	t.Setenv("TMPDIR", dir)
	e, _ := setup(t)
	r := DefaultResources()
	r.TimeoutSeconds = 0
	if err := e.Configure(r, func() error { t.Fatal("invalid configuration persisted"); return nil }); err == nil {
		t.Fatal("invalid limits accepted")
	}
	result, err := e.Query(context.Background(), req("SELECT count(*) FROM data"))
	if err != nil || *result.Rows[0][0] != "240" {
		t.Fatal("configuration failure lost current reader", err)
	}
}

func TestReaderReopenFailuresRecoverWithoutLosingSelection(t *testing.T) {
	for _, remote := range []bool{false, true} {
		t.Run(map[bool]string{false: "local", true: "remote"}[remote], func(t *testing.T) {
			e, dir := setup(t)
			path := filepath.Join(dir, "orders.parquet")
			body, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			closed := 0
			if remote {
				extension, err := filepath.Abs("../../build/extensions/httpfs.duckdb_extension")
				if err != nil {
					t.Fatal(err)
				}
				e.SetHTTPFS(extension)
				_, err = e.OpenRemote(context.Background(), "s3://fixture/orders.parquet", "orders.parquet",
					func(context.Context, []string) (*RemoteScope, error) {
						return &RemoteScope{Paths: []string{path}, Sizes: []int64{int64(len(body))}, Close: func() { closed++ }, Error: func() error { return nil }}, nil
					})
				if err != nil {
					t.Fatal(err)
				}
			}
			selected := e.file
			if err := e.Configure(DefaultResources(), nil); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			if _, _, err := e.queryDatabase(ctx, "SELECT * FROM data"); err == nil {
				t.Fatal("canceled reopen succeeded")
			}
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			if _, err := e.Query(context.Background(), req("SELECT * FROM data")); err == nil {
				t.Fatal("removed source reopened")
			}
			if e.db != nil || e.file != selected || closed != 0 {
				t.Fatal("failed reopen lost selected file or retained failed database")
			}
			if err := os.WriteFile(path, body, 0600); err != nil {
				t.Fatal(err)
			}
			result, err := e.Query(context.Background(), req("SELECT count(*) FROM data"))
			if err != nil || *result.Rows[0][0] != "240" {
				t.Fatal("restored source could not reopen", err)
			}
			e.Close()
			if remote && closed != 1 {
				t.Fatal("scope not released exactly once", closed)
			}
		})
	}
}

func TestWorkspaceResolverRejectsInvalidAndDisappearedPaths(t *testing.T) {
	e, dir := setup(t)
	for _, path := range []string{"relative.parquet", filepath.Join(dir, "missing.parquet")} {
		e.resolve = func(string) (string, error) { return path, nil }
		if _, err := e.Query(context.Background(), req("SELECT * FROM workspace.\"other.parquet\"")); err == nil {
			t.Fatal("invalid resolved path accepted", path)
		}
	}
	if db, cleanup, err := e.queryDatabase(context.Background(), "SELECT 1; DROP VIEW data"); err == nil || db != nil || cleanup != nil {
		t.Fatal("invalid SQL reached database creation")
	}
}
