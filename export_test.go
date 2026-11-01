package main

import (
	"bamboo/internal/cloudstorage"
	"bamboo/internal/cloudstoragetest"
	"bamboo/internal/engine"
	"bamboo/internal/testutil"
	"bamboo/internal/workspace"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFullExportScopesAndFormats(t *testing.T) {
	w, d, dir := workbench(t)
	ctx := context.Background()
	w.folders = workspace.New(t.TempDir())
	info, err := w.useWorkspace(dir)
	if err != nil {
		t.Fatal(err)
	}
	server := cloudstoragetest.New(dir)
	defer server.Close()
	w.remote = cloudstorage.NewWithTransport(t.TempDir(), &cloudstoragetest.Vault{}, server.Transport)
	extension, _ := filepath.Abs("build/extensions/httpfs.duckdb_extension")
	w.engine.SetHTTPFS(extension)
	cloud, err := w.ConnectR2(ctx, cloudstoragetest.Input())
	if err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(w.initial)
	if err != nil {
		t.Fatal(err)
	}
	for _, scope := range []string{"file", "workspace", "cloud-file", "cloud-workspace"} {
		t.Run(scope, func(t *testing.T) {
			err = nil
			q := engine.Request{SQL: "SELECT order_id AS id, city, NULL AS missing, '' AS empty, 9223372036854775807::BIGINT AS exact, '=SUM(A1)' AS formula FROM data", Limit: 2, Offset: 10, FilterColumn: "city", FilterValue: "Kyoto", Sort: "id", Desc: true}
			switch scope {
			case "file":
				_, err = w.OpenPath(ctx, w.initial)
			case "cloud-file":
				_, err = w.OpenWorkspaceFile(ctx, cloud.Root, "orders.parquet")
			default:
				q.SQL = strings.Replace(q.SQL, "FROM data", `FROM (SELECT * FROM workspace."orders.parquet" UNION ALL SELECT * FROM workspace."orders.parquet" WHERE false) o JOIN (SELECT 1) ON true`, 1)
			}
			if err != nil {
				t.Fatal(err)
			}
			if strings.HasSuffix(scope, "workspace") {
				root := info.Root
				if scope == "cloud-workspace" {
					root = cloud.Root
				}
				_, err = w.QueryWorkspace(ctx, root, q)
			} else {
				_, err = w.Query(ctx, q)
			}
			if err != nil {
				t.Fatal(err)
			}
			// A failed new query cannot replace the successful request or workspace.
			if _, err = w.Query(ctx, engine.Request{SQL: "SELECT missing_column FROM data", Limit: 2}); err == nil {
				t.Fatal("bad SQL accepted")
			}
			for _, format := range []string{"json", "jsonl", "csv", "tsv"} {
				d.path = filepath.Join(dir, scope+"."+format)
				d.onSave = func() {
					if _, err := w.OpenPath(ctx, w.initial); err == nil {
						t.Error("switch during export")
					}
					if _, err := w.OpenWorkspaceQuery(info.Root); err == nil {
						t.Error("workspace switch during export")
					}
					if !w.GetExportProgress().Running {
						t.Error("missing busy status")
					}
				}
				path, err := w.ExportFullAs(ctx, format)
				if err != nil || path != d.path {
					t.Fatal(path, err)
				}
				testutil.Private(t, path, 0600)
				data, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				var rows [][]*string
				switch format {
				case "json":
					var got engine.Result
					if err = json.Unmarshal(data, &got); err != nil || got.More || got.Offset != 0 || got.Columns[4].Type != "BIGINT" {
						t.Fatal(got, err)
					}
					rows = got.Rows
				case "jsonl":
					dec := json.NewDecoder(bytes.NewReader(data))
					var header struct{ Columns []engine.Column }
					if err = dec.Decode(&header); err != nil || header.Columns[4].Type != "BIGINT" {
						t.Fatal(header, err)
					}
					for {
						var record struct{ Row []*string }
						err = dec.Decode(&record)
						if err == io.EOF {
							break
						}
						if err != nil {
							t.Fatal(err)
						}
						rows = append(rows, record.Row)
					}
				default:
					reader := csv.NewReader(bytes.NewReader(data))
					if format == "tsv" {
						reader.Comma = '\t'
					}
					records, err := reader.ReadAll()
					if err != nil || len(records) != 61 {
						t.Fatal(len(records), err)
					}
					for i, row := range records[1:] {
						if row[0] != fmt.Sprint(1237-i*4) || row[2] != "" || row[3] != "" || row[4] != "9223372036854775807" || row[5] != "'=SUM(A1)" {
							t.Fatal(row)
						}
					}
				}
				if format == "json" || format == "jsonl" {
					if len(rows) != 60 {
						t.Fatal(len(rows))
					}
					for i, row := range rows {
						if *row[0] != fmt.Sprint(1237-i*4) || row[2] != nil || *row[3] != "" || *row[4] != "9223372036854775807" || *row[5] != "=SUM(A1)" {
							t.Fatal(row)
						}
					}
				}
				if p := w.GetExportProgress(); p.Running || p.Rows != "60" {
					t.Fatal(p)
				}
				if _, err = w.ExportFullAs(ctx, format); err == nil {
					t.Fatal("overwrote export")
				}
			}
		})
	}
	after, err := os.ReadFile(w.initial)
	if err != nil || sha256.Sum256(original) != sha256.Sum256(after) {
		t.Fatal("source changed", err)
	}
	partials, _ := filepath.Glob(filepath.Join(dir, ".bamboo-export-partial-*"))
	if len(partials) != 0 {
		t.Fatal(partials)
	}
}

func TestFullExportFailureAndRecovery(t *testing.T) {
	w, d, dir := workbench(t)
	ctx := context.Background()
	if _, err := w.ExportFullAs(ctx, "xml"); err == nil {
		t.Fatal("format")
	}
	if _, err := w.ExportFullAs(ctx, "json"); err == nil {
		t.Fatal("missing result")
	}
	w.opMu.Lock()
	_, err := w.ExportFullAs(ctx, "json")
	w.opMu.Unlock()
	if err == nil {
		t.Fatal("busy")
	}
	if _, err = w.OpenPath(ctx, w.initial); err != nil {
		t.Fatal(err)
	}
	readPage(t, w, "SELECT * FROM data")
	if p, err := w.ExportFullAs(ctx, "json"); p != "" || err != nil {
		t.Fatal(p, err)
	}
	d.err = errors.New("picker failure")
	if _, err = w.ExportFullAs(ctx, "json"); !errors.Is(err, d.err) {
		t.Fatal(err)
	}
	d.err = nil
	d.path = filepath.Join(dir, "wrong.csv")
	if _, err = w.ExportFullAs(ctx, "json"); err == nil {
		t.Fatal("extension")
	}
	d.path = filepath.Join(dir, "canceled.json")
	d.onSave = w.Cancel
	if _, err = w.ExportFullAs(ctx, "json"); err == nil {
		t.Fatal("cancel")
	}
	if _, err = os.Stat(d.path); !os.IsNotExist(err) {
		t.Fatal("canceled target exists")
	}
	d.onSave = nil
	d.path = filepath.Join(dir, "missing", "output.json")
	if _, err = w.ExportFullAs(ctx, "json"); err == nil {
		t.Fatal("missing parent")
	}
	d.path = filepath.Join(dir, "empty.json")
	readPage(t, w, "SELECT * FROM data WHERE false")
	if _, err = w.ExportFullAs(ctx, "json"); err != nil {
		t.Fatal(err)
	}
	if w.GetExportProgress().Rows != "0" {
		t.Fatal("empty count")
	}
	if _, err = w.OpenPath(ctx, filepath.Join(dir, "empty.parquet")); err != nil {
		t.Fatal(err)
	}
	if _, err = w.ExportFullAs(ctx, "json"); err == nil {
		t.Fatal("stale export")
	}
	path := filepath.Join(dir, "partial.json")
	sentinel := errors.New("disk full")
	err = writeFullExport(ctx, path, "json", func(sink engine.RowSink) error {
		if err := sink([]engine.Column{{Name: "a", Type: "VARCHAR"}}, nil); err != nil {
			t.Fatal(err)
		}
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatal(err)
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("partial published")
	}
	child, cancel := context.WithCancel(ctx)
	err = writeFullExport(child, path, "json", func(sink engine.RowSink) error { cancel(); return sink([]engine.Column{}, nil) })
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestAdditionalPageFormats(t *testing.T) {
	w, d, dir := workbench(t)
	ctx := context.Background()
	if _, err := w.OpenPath(ctx, w.initial); err != nil {
		t.Fatal(err)
	}
	readPage(t, w, `SELECT '' AS "=head" UNION ALL SELECT NULL UNION ALL SELECT 'a'||chr(9)||'b'||chr(10)||'"quoted"'`)
	for _, format := range []string{"jsonl", "tsv"} {
		d.path = filepath.Join(dir, "page."+format)
		if _, err := w.ExportPageAs(ctx, format); err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(d.path)
		if err != nil {
			t.Fatal(err)
		}
		if format == "tsv" {
			reader := csv.NewReader(bytes.NewReader(b))
			reader.Comma = '\t'
			rows, err := reader.ReadAll()
			if err != nil || len(rows) != 4 || rows[0][0] != "'=head" || rows[1][0] != "" || rows[2][0] != "" || rows[3][0] != "a\tb\n\"quoted\"" {
				t.Fatal(rows, err)
			}
		} else if bytes.Count(b, []byte("\n")) != 4 {
			t.Fatal(string(b))
		}
	}
}

type exportFailureWriter struct{ remaining int }

func (w *exportFailureWriter) Write(p []byte) (int, error) {
	if w.remaining == 0 {
		return 0, io.ErrClosedPipe
	}
	w.remaining--
	return len(p), nil
}
func TestStreamWriterErrors(t *testing.T) {
	cols := []engine.Column{{Name: "=header", Type: "VARCHAR"}}
	value := "text"
	row := []*string{&value}
	for _, format := range []string{"json", "jsonl", "csv", "tsv"} {
		for n := 0; n < 5; n++ {
			w := &resultWriter{dst: &exportFailureWriter{remaining: n}, format: format}
			err := w.write(cols, nil)
			if err == nil {
				err = w.write(cols, row)
			}
			if err == nil {
				err = w.write(cols, row)
			}
			if err == nil {
				err = w.finish()
			}
			if format == "json" && err == nil {
				t.Fatal("missing write error", n)
			}
		}
		w := &resultWriter{dst: io.Discard, format: format}
		if err := w.write(cols, nil); err != nil {
			t.Fatal(err)
		}
		if err := w.write(cols, []*string{}); err == nil {
			t.Fatal("row width")
		}
	}
}
