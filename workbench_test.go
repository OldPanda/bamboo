package main

import (
	"bamboo/internal/engine"
	"bamboo/internal/fixtures"
	"bamboo/internal/testutil"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

type testDialogs struct {
	paths       []string
	path        string
	err         error
	openOptions mygo.OpenDialogOptions
	saveOptions mygo.SaveDialogOptions
	onSave      func()
}

func (d *testDialogs) Open(o mygo.OpenDialogOptions) ([]string, error) {
	d.openOptions = o
	return d.paths, d.err
}
func (d *testDialogs) Save(o mygo.SaveDialogOptions) (string, error) {
	d.saveOptions = o
	if d.onSave != nil {
		d.onSave()
	}
	return d.path, d.err
}
func workbench(t *testing.T) (*Workbench, *testDialogs, string) {
	t.Helper()
	dir := t.TempDir()
	if err := fixtures.Generate(dir, false); err != nil {
		t.Fatal(err)
	}
	d := &testDialogs{}
	w := &Workbench{engine: engine.New(), dialogs: d, initial: filepath.Join(dir, "orders.parquet")}
	t.Cleanup(w.engine.Close)
	return w, d, dir
}
func readPage(t *testing.T, w *Workbench, sql string) *engine.Result {
	t.Helper()
	r, err := w.Query(context.Background(), engine.Request{SQL: sql, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestWorkbenchOpenAndState(t *testing.T) {
	w, d, dir := workbench(t)
	ctx := context.Background()
	if w.InitialFile() != filepath.Join(dir, "orders.parquet") {
		t.Fatal("initial path")
	}
	if r, err := w.Open(ctx); err != nil || r != nil {
		t.Fatal("picker cancel", r, err)
	}
	d.err = errors.New("picker failed")
	if _, err := w.Open(ctx); !errors.Is(err, d.err) {
		t.Fatal(err)
	}
	d.err = nil
	d.paths = []string{w.initial, "ignored"}
	f, err := w.Open(ctx)
	if err != nil || f.Rows != "240" {
		t.Fatal(f, err)
	}
	if d.openOptions.Multiple || d.openOptions.Filters[0].Extensions[0] != "parquet" {
		t.Fatal(d.openOptions)
	}
	r := readPage(t, w, "SELECT * FROM data")
	if _, err := w.OpenPath(ctx, filepath.Join(dir, "malformed.parquet")); err == nil || w.last != r {
		t.Fatal("failed open lost export state", err)
	}
	if _, err := w.Query(ctx, engine.Request{SQL: "SELECT missing FROM data", Limit: 1}); err == nil || w.last != r {
		t.Fatal("failed query lost export state", err)
	}
	w.opMu.Lock()
	if _, err := w.OpenPath(ctx, w.initial); err == nil {
		t.Error("concurrent open accepted")
	}
	if _, err := w.Query(ctx, engine.Request{Limit: 1}); err == nil {
		t.Error("concurrent query accepted")
	}
	w.opMu.Unlock()
	if _, err := w.OpenPath(ctx, filepath.Join(dir, "empty.parquet")); err != nil || w.last != nil {
		t.Fatal("replacement retained old page", err)
	}
	if r := readPage(t, w, "SELECT * FROM data"); len(r.Rows) != 0 || len(r.Columns) != 2 {
		t.Fatal(r)
	}
}

func TestWorkbenchCancelAndRecovery(t *testing.T) {
	w, _, _ := workbench(t)
	ctx := context.Background()
	w.Cancel()
	if _, err := w.OpenPath(ctx, w.initial); err != nil {
		t.Fatal(err)
	}
	previous := readPage(t, w, "SELECT 7")
	done := make(chan error, 1)
	go func() {
		_, err := w.Query(ctx, engine.Request{Limit: 1, SQL: "SELECT sum(a.i*b.i) FROM range(1000000) a(i), range(1000000) b(i)"})
		done <- err
	}()
	deadline := time.After(3 * time.Second)
	// Repeated cancellation also handles the small window before engine.start.
	for {
		w.Cancel()
		select {
		case err := <-done:
			if err == nil || w.last != previous {
				t.Fatal("cancel lost previous page", err)
			}
			readPage(t, w, "SELECT 8")
			return
		case <-deadline:
			t.Fatal("cancel did not finish")
		case <-time.After(time.Millisecond):
		}
	}
}

func TestExportDialogAndSnapshot(t *testing.T) {
	w, d, dir := workbench(t)
	ctx := context.Background()
	if _, err := w.ExportPage(ctx); err == nil {
		t.Fatal("export without data")
	}
	if _, err := w.OpenPath(ctx, w.initial); err != nil {
		t.Fatal(err)
	}
	r := readPage(t, w, "SELECT 9223372036854775807::BIGINT AS exact, NULL AS missing, '' AS empty, {'date': DATE '0001-01-01', 'time': TIME_NS '00:00:00.000000001'} AS int96")
	if p, err := w.ExportPage(ctx); p != "" || err != nil {
		t.Fatal("cancel export", p, err)
	}
	d.err = errors.New("save failed")
	if _, err := w.ExportPage(ctx); !errors.Is(err, d.err) {
		t.Fatal(err)
	}
	d.err = nil
	for _, name := range []string{"page.csv", "page.JSON", "page"} {
		d.path = filepath.Join(dir, name)
		if _, err := w.ExportPage(ctx); err == nil {
			t.Fatal("invalid extension", name)
		}
		if _, err := os.Stat(d.path); !os.IsNotExist(err) {
			t.Fatal("created invalid export")
		}
	}
	d.path = filepath.Join(dir, "page.json")
	d.onSave = func() { readPage(t, w, "SELECT 2 AS newer") }
	p, err := w.ExportPage(ctx)
	if err != nil || p != d.path {
		t.Fatal(p, err)
	}
	if d.saveOptions.DefaultPath != "bamboo-page.json" || d.saveOptions.Filters[0].Extensions[0] != "json" {
		t.Fatal(d.saveOptions)
	}
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	var got engine.Result
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if *got.Rows[0][0] != *r.Rows[0][0] || got.Rows[0][1] != nil || *got.Rows[0][2] != "" || got.Columns[0].Type != "BIGINT" {
		t.Fatal("export was not a precise snapshot", got)
	}
	if got.Columns[3].Type != `STRUCT(date DATE, "time" TIME_NS)` || got.Rows[0][3] == nil || *got.Rows[0][3] != "{'date': 0001-01-01, 'time': '00:00:00.000000001'}" {
		t.Fatal("export lost exact INT96 representation", got)
	}
	testutil.Private(t, p, 0600)
	if _, err := w.ExportPage(ctx); err == nil {
		t.Fatal("overwrote export")
	}
}

type failingFile struct {
	*os.File
	writeErr, closeErr error
	closed             bool
}

func (f *failingFile) Write(b []byte) (int, error) {
	if f.writeErr != nil {
		return 0, f.writeErr
	}
	return f.File.Write(b)
}
func (f *failingFile) Close() error {
	f.closed = true
	err := f.File.Close()
	if f.closeErr != nil {
		return f.closeErr
	}
	return err
}
func TestExportFailureCleansUp(t *testing.T) {
	for _, stage := range []string{"write", "close"} {
		t.Run(stage, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "page.json")
			sentinel := errors.New(stage + " failed")
			var f *failingFile
			err := writeExportFormatWith(path, &engine.Result{}, "json", func(p string) (io.WriteCloser, error) {
				raw, err := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
				if err != nil {
					return nil, err
				}
				f = &failingFile{File: raw}
				if stage == "write" {
					f.writeErr = sentinel
				} else {
					f.closeErr = sentinel
				}
				return f, nil
			})
			if !errors.Is(err, sentinel) || !f.closed {
				t.Fatal("failure not returned or file not closed", err)
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatal("partial export retained", err)
			}
		})
	}
	if err := writeExportFormat(filepath.Join(t.TempDir(), "missing", "page.json"), &engine.Result{}, "json"); err == nil || !strings.Contains(err.Error(), "new filename") {
		t.Fatal("creation failure", err)
	}
}
