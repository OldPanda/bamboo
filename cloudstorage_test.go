package main

import (
	"bamboo/internal/cloudstorage"
	"bamboo/internal/cloudstoragetest"
	"bamboo/internal/engine"
	"bamboo/internal/workspace"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestR2Workbench(t *testing.T) {
	w, _, dir := workbench(t)
	w.folders = workspace.New(t.TempDir())
	server := cloudstoragetest.New(dir)
	defer server.Close()
	w.remote = cloudstorage.NewWithTransport(t.TempDir(), &cloudstoragetest.Vault{}, server.Transport)
	extension, _ := filepath.Abs("build/extensions/httpfs.duckdb_extension")
	w.engine.SetHTTPFS(extension)
	ctx := context.Background()
	info, e := w.ConnectR2(ctx, cloudstoragetest.Input())
	if e != nil {
		t.Fatal(e)
	}
	root := info.Root
	restored, e := w.RestoreWorkspaces()
	if e != nil || len(restored.Workspaces) != 1 {
		t.Fatal(restored, e)
	}
	page, e := w.ListDirectory(root, ".", 0)
	if e != nil || len(page.Entries) == 0 {
		t.Fatal(page, e)
	}
	if _, e = w.OpenWorkspaceQuery(root); e != nil {
		t.Fatal(e)
	}
	q := engine.Request{SQL: `SELECT count(*) FROM workspace."orders.parquet"`, Limit: 100}
	result, e := w.QueryWorkspace(ctx, root, q)
	if e != nil || *result.Rows[0][0] != "240" || w.last != result {
		t.Fatal(result, e)
	}
	if e = w.SaveWorkspaceQuery(root, ".", q.SQL, q.SQL); e != nil {
		t.Fatal(e)
	}
	saved, e := w.OpenWorkspaceQuery(root)
	if e != nil || saved.Draft != q.SQL {
		t.Fatal(saved, e)
	}
	opened, e := w.OpenWorkspaceFile(ctx, root, "orders.parquet")
	if e != nil || opened.File.Rows != "240" {
		t.Fatal(opened, e)
	}
	if _, e = w.Query(ctx, engine.Request{SQL: `SELECT * FROM data LIMIT 2`, Limit: 100}); e != nil {
		t.Fatal(e)
	}
	if _, e = w.RenameWorkspace(root, "Remote orders"); e != nil {
		t.Fatal(e)
	}
	if e = w.CloseWorkspaceFile(root, "orders.parquet"); e != nil {
		t.Fatal(e)
	}
	w.opMu.Lock()
	if _, e = w.ConnectR2(ctx, cloudstoragetest.Input()); e == nil {
		t.Fatal("busy connect")
	}
	if _, e = w.ListDirectory(root, ".", 0); e == nil {
		t.Fatal("busy listing")
	}
	if e = w.CloseWorkspace(root); e == nil {
		t.Fatal("busy close")
	}
	w.opMu.Unlock()
	server.Delay.Store(1000)
	done := make(chan error, 1)
	go func() { _, e := w.ListDirectory(root, ".", 0); done <- e }()
	time.Sleep(40 * time.Millisecond)
	w.Cancel()
	if e = <-done; e == nil {
		t.Fatal("cancel failed")
	}
	server.Delay.Store(0)
	server.Failure.Store(403)
	if _, e = w.OpenWorkspaceFile(ctx, root, "orders.parquet"); e == nil {
		t.Fatal("permission error")
	}
	if _, e = w.QueryWorkspace(ctx, root, q); e == nil {
		t.Fatal("query failure")
	}
	server.Failure.Store(0)
	if e = w.CloseWorkspace(root); e != nil {
		t.Fatal(e)
	}
	if _, e = w.OpenWorkspaceQuery(root); e == nil {
		t.Fatal("closed root")
	}
	if _, e = w.OpenWorkspaceFile(ctx, root, "orders.parquet"); e == nil {
		t.Fatal("closed file")
	}
	w.ClearPreview()
	if _, e = w.OpenPath(ctx, filepath.Join(dir, "orders.parquet")); e != nil {
		t.Fatal(e)
	}
}
func TestR2KeychainSynthetic(t *testing.T) {
	if os.Getenv("BAMBOO_KEYCHAIN_TEST") != "1" {
		t.Skip("opt-in native Keychain acceptance")
	}
	vault := cloudstorage.NewVault()
	id := "bamboo-validation-" + strings.ReplaceAll(filepath.Base(t.TempDir()), "/", "-") + time.Now().Format("150405.000000000")
	defer vault.Delete(id)
	creds := cloudstorage.Credentials{AccessKey: "synthetic-access", SecretKey: "synthetic-secret"}
	if e := vault.Set(id, creds); e != nil {
		t.Fatal(e)
	}
	got, e := vault.Get(id)
	if e != nil || got != creds {
		t.Fatal("Keychain round trip", e)
	}
	creds.SecretKey = "synthetic-updated"
	if e = vault.Set(id, creds); e != nil {
		t.Fatal(e)
	}
	got, e = vault.Get(id)
	if e != nil || got != creds {
		t.Fatal("Keychain update", e)
	}
	if e = vault.Delete(id); e != nil {
		t.Fatal(e)
	}
	if _, e = vault.Get(id); e == nil {
		t.Fatal("Keychain item remains")
	}
	if e = vault.Delete(id); e != nil {
		t.Fatal(e)
	}
}

func TestConnectionSettingsBridge(t *testing.T) {
	w, _, dir := workbench(t)
	w.folders = workspace.New(t.TempDir())
	server := cloudstoragetest.New(dir)
	defer server.Close()
	w.remote = cloudstorage.NewWithTransport(t.TempDir(), &cloudstoragetest.Vault{}, server.Transport)
	ctx := context.Background()
	info, err := w.SaveR2Connection(ctx, "", cloudstoragetest.Input())
	if err != nil {
		t.Fatal(err)
	}
	if list, e := w.ListConnections(); e != nil || len(list) != 1 || list[0].Open {
		t.Fatal(list, e)
	}
	if err = w.TestR2Connection(ctx, info.Root); err != nil {
		t.Fatal(err)
	}
	if _, err = w.OpenR2Connection(ctx, info.Root); err != nil {
		t.Fatal(err)
	}
	w.opMu.Lock()
	if _, err = w.SaveR2Connection(ctx, info.Root, cloudstoragetest.Input()); err == nil {
		t.Fatal("busy save")
	}
	if err = w.TestR2Connection(ctx, info.Root); err == nil {
		t.Fatal("busy test")
	}
	if _, err = w.OpenR2Connection(ctx, info.Root); err == nil {
		t.Fatal("busy open")
	}
	if err = w.DeleteR2Connection(info.Root); err == nil {
		t.Fatal("busy delete")
	}
	w.opMu.Unlock()
	if err = w.CloseWorkspace(info.Root); err != nil {
		t.Fatal(err)
	}
	if list, e := w.ListConnections(); e != nil || len(list) != 1 || list[0].Open {
		t.Fatal(list, e)
	}
	if err = w.DeleteR2Connection(info.Root); err != nil {
		t.Fatal(err)
	}
	if list, e := w.ListConnections(); e != nil || len(list) != 0 {
		t.Fatal(list, e)
	}
}

func s3FixtureInput() cloudstorage.ConnectInput {
	in := cloudstoragetest.Input()
	in.Provider = "s3"
	in.Region = "us-west-2"
	in.Endpoint = ""
	in.SessionToken = "fixture-session"
	in.Name = "S3 analytics"
	return in
}
func TestS3Workbench(t *testing.T) {
	w, _, dir := workbench(t)
	w.folders = workspace.New(t.TempDir())
	server := cloudstoragetest.New(dir)
	defer server.Close()
	w.remote = cloudstorage.NewWithTransport(t.TempDir(), &cloudstoragetest.Vault{}, server.Transport)
	extension, _ := filepath.Abs("build/extensions/httpfs.duckdb_extension")
	w.engine.SetHTTPFS(extension)
	ctx := context.Background()
	info, e := w.ConnectR2(ctx, s3FixtureInput())
	if e != nil {
		t.Fatal(e)
	}
	root := info.Root
	restored, e := w.RestoreWorkspaces()
	if e != nil || len(restored.Workspaces) != 1 {
		t.Fatal(restored, e)
	}
	page, e := w.ListDirectory(root, ".", 0)
	if e != nil || len(page.Entries) == 0 {
		t.Fatal(page, e)
	}
	if _, e = w.OpenWorkspaceQuery(root); e != nil {
		t.Fatal(e)
	}
	q := engine.Request{SQL: `SELECT count(*) FROM workspace."orders.parquet"`, Limit: 100}
	result, e := w.QueryWorkspace(ctx, root, q)
	if e != nil || *result.Rows[0][0] != "240" || w.last != result {
		t.Fatal(result, e)
	}
	if e = w.SaveWorkspaceQuery(root, ".", q.SQL, q.SQL); e != nil {
		t.Fatal(e)
	}
	saved, e := w.OpenWorkspaceQuery(root)
	if e != nil || saved.Draft != q.SQL {
		t.Fatal(saved, e)
	}
	opened, e := w.OpenWorkspaceFile(ctx, root, "orders.parquet")
	if e != nil || opened.File.Rows != "240" {
		t.Fatal(opened, e)
	}
	if _, e = w.Query(ctx, engine.Request{SQL: `SELECT * FROM data LIMIT 2`, Limit: 100}); e != nil {
		t.Fatal(e)
	}
	if _, e = w.RenameWorkspace(root, "Remote orders"); e != nil {
		t.Fatal(e)
	}
	if e = w.CloseWorkspaceFile(root, "orders.parquet"); e != nil {
		t.Fatal(e)
	}
	w.opMu.Lock()
	if _, e = w.ConnectR2(ctx, s3FixtureInput()); e == nil {
		t.Fatal("busy connect")
	}
	if _, e = w.ListDirectory(root, ".", 0); e == nil {
		t.Fatal("busy listing")
	}
	if e = w.CloseWorkspace(root); e == nil {
		t.Fatal("busy close")
	}
	w.opMu.Unlock()
	server.Delay.Store(1000)
	done := make(chan error, 1)
	go func() { _, e := w.ListDirectory(root, ".", 0); done <- e }()
	time.Sleep(40 * time.Millisecond)
	w.Cancel()
	if e = <-done; e == nil {
		t.Fatal("cancel failed")
	}
	server.Delay.Store(0)
	server.Failure.Store(403)
	if _, e = w.OpenWorkspaceFile(ctx, root, "orders.parquet"); e == nil {
		t.Fatal("permission error")
	}
	if _, e = w.QueryWorkspace(ctx, root, q); e == nil {
		t.Fatal("query failure")
	}
	server.Failure.Store(0)
	if e = w.CloseWorkspace(root); e != nil {
		t.Fatal(e)
	}
	if _, e = w.OpenWorkspaceQuery(root); e == nil {
		t.Fatal("closed root")
	}
	if _, e = w.OpenWorkspaceFile(ctx, root, "orders.parquet"); e == nil {
		t.Fatal("closed file")
	}
	w.ClearPreview()
	if _, e = w.OpenPath(ctx, filepath.Join(dir, "orders.parquet")); e != nil {
		t.Fatal(e)
	}
}

func TestCloudResourceSettings(t *testing.T) {
	w, _, dir := workbench(t)
	w.configDir = t.TempDir()
	w.folders = workspace.New(t.TempDir())
	server := cloudstoragetest.New(dir)
	defer server.Close()
	w.remote = cloudstorage.NewWithTransport(t.TempDir(), &cloudstoragetest.Vault{}, server.Transport)
	extension, _ := filepath.Abs("build/extensions/httpfs.duckdb_extension")
	w.engine.SetHTTPFS(extension)
	ctx := context.Background()
	info, err := w.ConnectR2(ctx, cloudstoragetest.Input())
	if err != nil {
		t.Fatal(err)
	}
	if err = w.SetResources(engine.Resources{MemoryMiB: 128, TempGiB: 1, TimeoutSeconds: 60}); err != nil {
		t.Fatal(err)
	}
	query := engine.Request{SQL: `SELECT count(*),current_setting('memory_limit') FROM workspace."orders.parquet"`, Limit: 1}
	result, err := w.QueryWorkspace(ctx, info.Root, query)
	if err != nil {
		t.Fatal(err)
	}
	if *result.Rows[0][0] != "240" || *result.Rows[0][1] != "128.0 MiB" {
		t.Fatal(result.Rows)
	}
	if _, err = w.OpenWorkspaceFile(ctx, info.Root, "orders.parquet"); err != nil {
		t.Fatal(err)
	}
	if err = w.SetResources(engine.Resources{MemoryMiB: 512, TempGiB: 0, TimeoutSeconds: 60}); err != nil {
		t.Fatal(err)
	}
	result, err = w.Query(ctx, engine.Request{SQL: "SELECT count(*),current_setting('memory_limit'),current_setting('max_temp_directory_size') FROM data", Limit: 1})
	if err != nil {
		t.Fatal("active cloud reader lost", err)
	}
	if *result.Rows[0][0] != "240" || *result.Rows[0][1] != "512.0 MiB" || *result.Rows[0][2] != "0 bytes" {
		t.Fatal(result.Rows)
	}
}
