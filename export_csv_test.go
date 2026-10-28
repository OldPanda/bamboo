package main

import (
	"bamboo/internal/engine"
	"context"
	"encoding/csv"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestCSVExportRoundTripAndSnapshot(t *testing.T) {
	w, d, dir := workbench(t)
	exact, complex, empty := "9223372036854775807", "竹子,\"quoted\"\nsecond line", ""
	w.last = &engine.Result{Columns: []engine.Column{{Name: "id", Type: "BIGINT"}, {Name: "a,\"b", Type: "VARCHAR"}, {Name: "missing", Type: "VARCHAR"}, {Name: "empty", Type: "VARCHAR"}}, Rows: [][]*string{{&exact, &complex, nil, &empty}}}
	ctx := context.Background()
	if _, err := w.ExportPageAs(ctx, "xml"); err == nil {
		t.Fatal("invalid format accepted")
	}
	if p, err := w.ExportPageAs(ctx, "csv"); p != "" || err != nil {
		t.Fatal("cancel", p, err)
	}
	d.path = filepath.Join(dir, "bad.json")
	if _, err := w.ExportPageAs(ctx, "csv"); err == nil {
		t.Fatal("incorrect extension")
	}
	d.path = filepath.Join(dir, "page.csv")
	d.onSave = func() { w.last = &engine.Result{} }
	p, err := w.ExportPageAs(ctx, "csv")
	if err != nil {
		t.Fatal(err)
	}
	if d.saveOptions.DefaultPath != "bamboo-page.csv" || d.saveOptions.Filters[0].Extensions[0] != "csv" {
		t.Fatal(d.saveOptions)
	}
	f, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got, err := csv.NewReader(f).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	want := [][]string{{"id", "a,\"b", "missing", "empty"}, {exact, complex, "", ""}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%#v != %#v", got, want)
	}
	before, _ := os.ReadFile(p)
	if _, err = w.ExportPageAs(ctx, "csv"); err == nil {
		t.Fatal("overwritten")
	}
	after, _ := os.ReadFile(p)
	if string(before) != string(after) {
		t.Fatal("file changed")
	}
	link := filepath.Join(dir, "link.csv")
	if err = os.Symlink(p, link); err != nil {
		t.Fatal(err)
	}
	if err = writeExportFormat(link, w.last, "csv"); err == nil {
		t.Fatal("followed symlink")
	}
}
func TestCSVEmptyAndInvalidRows(t *testing.T) {
	p := filepath.Join(t.TempDir(), "empty.csv")
	r := &engine.Result{Columns: []engine.Column{{Name: "id"}, {Name: "name"}}}
	if err := writeExportFormat(p, r, "csv"); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	if string(b) != "id,name\n" {
		t.Fatal(string(b))
	}
	r.Rows = [][]*string{{nil}}
	if err := writeExportFormat(p+".bad", r, "csv"); err == nil {
		t.Fatal("bad row accepted")
	}
	if _, err := os.Stat(p + ".bad"); !os.IsNotExist(err) {
		t.Fatal("invalid export created")
	}
	if err := writeExportFormat(p+".nil", nil, "csv"); err == nil {
		t.Fatal("nil result accepted")
	}
}
func TestCSVFailureCleansUp(t *testing.T) {
	for _, stage := range []string{"write", "close"} {
		t.Run(stage, func(t *testing.T) {
			p := filepath.Join(t.TempDir(), "page.csv")
			sentinel := errors.New(stage + " failed")
			var f *failingFile
			err := writeExportFormatWith(p, &engine.Result{Columns: []engine.Column{{Name: "id"}}}, "csv", func(p string) (io.WriteCloser, error) {
				raw, e := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
				if e != nil {
					return nil, e
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
				t.Fatal("failure handling", err)
			}
			if _, e := os.Stat(p); !os.IsNotExist(e) {
				t.Fatal("partial CSV remains")
			}
		})
	}
}

func TestCSVFormulaProtection(t *testing.T) {
	cases := []struct{ value, typ, want string }{
		{"=1+1", "VARCHAR", "'=1+1"}, {"+2+2", "VARCHAR", "'+2+2"},
		{"-2+3", "VARCHAR", "'-2+3"}, {"@SUM(1)", "VARCHAR", "'@SUM(1)"},
		{"\t=1+1", "VARCHAR", "'\t=1+1"}, {"\r=1+1", "VARCHAR", "'\r=1+1"},
		{"\n=1+1", "VARCHAR", "'\n=1+1"}, {"  =1+1", "VARCHAR", "'  =1+1"},
		{"\ufeff=1+1", "VARCHAR", "'\ufeff=1+1"}, {"＝1+1", "VARCHAR", "'＝1+1"},
		{"-42", "BIGINT", "-42"}, {"-9223372036854775808", "BIGINT", "-9223372036854775808"},
		{"-12345678901234567890.123456789", "DECIMAL(38,9)", "-12345678901234567890.123456789"},
		{"-1.25e+10", "DOUBLE", "-1.25e+10"}, {"-42", "VARCHAR", "'-42"},
		{"-1+2", "BIGINT", "'-1+2"}, {"", "VARCHAR", ""}, {"竹子,\"text\"\nline", "VARCHAR", "竹子,\"text\"\nline"},
	}
	r := &engine.Result{}
	row := []*string{}
	want := []string{}
	for _, c := range cases {
		r.Columns = append(r.Columns, engine.Column{Name: c.value, Type: c.typ})
		value := c.value
		row = append(row, &value)
		want = append(want, c.want)
	}
	r.Rows = [][]*string{row}
	p := filepath.Join(t.TempDir(), "protected.csv")
	if err := writeExportFormat(p, r, "csv"); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got, err := csv.NewReader(f).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	// encoding/csv normalizes CRLF; these fixtures only contain isolated CR.
	if !reflect.DeepEqual(got[1], want) {
		t.Fatalf("values: %#v want %#v", got[1], want)
	}
	for i, c := range cases {
		expected := c.want
		if c.value != "" && c.value[0] == '-' {
			expected = "'" + c.value
		}
		if got[0][i] != expected {
			t.Errorf("header %d: %q want %q", i, got[0][i], expected)
		}
		if *r.Rows[0][i] != c.value {
			t.Fatal("export mutated original data")
		}
	}
}
