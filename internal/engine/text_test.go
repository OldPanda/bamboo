package engine

import (
	"bamboo/internal/datafile"
	"bufio"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDelimitedLargeStreamAndCancellation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large.csv")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := bufio.NewWriter(f)
	fmt.Fprintln(writer, "id,payload")
	for i := 0; i < 20000; i++ {
		if _, err = fmt.Fprintf(writer, "%d,%s\n", i, strings.Repeat("x", 2048)); err != nil {
			t.Fatal(err)
		}
	}
	if err = writer.Flush(); err != nil {
		t.Fatal(err)
	}
	if err = f.Close(); err != nil {
		t.Fatal(err)
	}
	e := New()
	defer e.Close()
	if err = e.Configure(Resources{MemoryMiB: 128, TempGiB: 0, TimeoutSeconds: 30}, nil); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err = e.Open(ctx, path); err != nil {
		t.Fatal(err)
	}
	count := 0
	if err = e.Stream(ctx, req("SELECT * FROM data"), func(_ []Column, row []*string) error {
		if row != nil {
			if *row[0] != fmt.Sprint(count) || len(*row[1]) != 2048 {
				t.Fatal(row)
			}
			count++
		}
		return nil
	}); err != nil || count != 20000 {
		t.Fatal(count, err)
	}
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	count = 0
	err = e.Stream(child, req("SELECT * FROM data"), func(_ []Column, row []*string) error {
		if row != nil {
			count++
			cancel()
		}
		return nil
	})
	if err == nil || count != 1 {
		t.Fatal(count, err)
	}
	if _, err = e.Query(ctx, req("SELECT count(*) FROM data")); err != nil {
		t.Fatal("recovery", err)
	}
}

func TestDelimitedInputExactValuesAndOptions(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	path := filepath.Join(dir, "客户's.csv")
	content := "\xef\xbb\xbfid,amount,note,empty,missing\r\n9223372036854775807,12345678901234567890.123456789,\"a,b\n\"\"quoted\"\"\",\"\",\r\n0000123,-0.00001,=SUM(A1),\"\",\r\n"
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	e := New()
	defer e.Close()
	f, err := e.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if f.TextOptions == nil || !f.TextOptions.Header || f.Rows != "" || f.RowGroups != "" || f.Columns[0].Name != "id" {
		t.Fatal(f)
	}
	r, err := e.Query(ctx, req("SELECT * FROM data"))
	if err != nil || len(r.Rows) != 2 {
		t.Fatal(r, err)
	}
	if *r.Rows[0][0] != "9223372036854775807" || *r.Rows[0][1] != "12345678901234567890.123456789" || *r.Rows[0][2] != "a,b\n\"quoted\"" || *r.Rows[0][3] != "" || r.Rows[0][4] != nil || *r.Rows[1][0] != "0000123" {
		t.Fatal(r.Rows)
	}
	for _, c := range r.Columns {
		if c.Type != "VARCHAR" {
			t.Fatal(c)
		}
	}
	options := datafile.TextOptions{Delimiter: ",", Header: true, InferTypes: true}
	e.SetTextOptionsResolver(func(string) (datafile.TextOptions, error) { return options, nil })
	if _, err = e.Open(ctx, path); err != nil {
		t.Fatal(err)
	}
	r, err = e.Query(ctx, req("SELECT id::HUGEINT + 1, amount FROM data ORDER BY id::HUGEINT DESC"))
	if err != nil || *r.Rows[0][0] != "9223372036854775808" || r.Columns[1].Type != "VARCHAR" {
		t.Fatal(r, err)
	}
	options.Header = false
	options.InferTypes = false
	if _, err = e.Open(ctx, path); err != nil {
		t.Fatal(err)
	}
	r, err = e.Query(ctx, req("SELECT * FROM data"))
	if err != nil || len(r.Rows) != 3 || *r.Rows[0][0] != "id" {
		t.Fatal(r, err)
	}
	for _, delimiter := range []string{"\t", ";", "|"} {
		options.Delimiter, options.Header = delimiter, true
		text := "id" + delimiter + "name\n1" + delimiter + "hello\n"
		if err = os.WriteFile(path, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err = e.Open(ctx, path); err != nil {
			t.Fatal(delimiter, err)
		}
		r, err = e.Query(ctx, req("SELECT name FROM data"))
		if err != nil || *r.Rows[0][0] != "hello" {
			t.Fatal(r, err)
		}
	}
}

func TestDelimitedInputFailClosedAndWorkspace(t *testing.T) {
	ctx := context.Background()
	e, dir := setup(t)
	path := filepath.Join(dir, "data.tsv")
	text := "order_id\tvalue\n1001\t9223372036854775807\n1002\t\"\"\n"
	if err := os.WriteFile(path, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	resolve := func(name string) (string, error) {
		if name != "data.tsv" && name != "orders.parquet" {
			return "", errors.New("outside workspace")
		}
		return filepath.Join(dir, name), nil
	}
	r, err := e.QueryWorkspace(ctx, req(`SELECT t.value, p.city FROM workspace."data.tsv" t JOIN workspace."orders.parquet" p ON t.order_id::BIGINT=p.order_id ORDER BY p.order_id`), resolve)
	if err != nil || len(r.Rows) != 2 || *r.Rows[0][0] != "9223372036854775807" || *r.Rows[1][0] != "" {
		t.Fatal(r, err)
	}
	count := 0
	if err = e.StreamWorkspace(ctx, req(`SELECT * FROM workspace."data.tsv" UNION ALL SELECT * FROM workspace."data.tsv"`), resolve, func(_ []Column, row []*string) error {
		if row != nil {
			count++
		}
		return nil
	}); err != nil || count != 4 {
		t.Fatal(count, err)
	}
	for _, q := range []string{`SELECT * FROM read_csv('` + path + `')`, `SELECT * FROM workspace."../data.tsv"`, `SELECT 1; COPY data TO '` + path + `'`} {
		if _, err = e.QueryWorkspace(ctx, req(q), resolve); err == nil {
			t.Fatal("accepted", q)
		}
	}
	after, err := os.ReadFile(path)
	if err != nil || sha256.Sum256(after) != sha256.Sum256([]byte(text)) {
		t.Fatal("source changed", err)
	}
	for _, bad := range []string{"a,b\n1,2,3\n", "a,b\n1,\"unterminated\n", "a,b\n1,\xff\n", "a,b\n1," + strings.Repeat("x", 4194305)} {
		if err = os.WriteFile(path, []byte(bad), 0600); err != nil {
			t.Fatal(err)
		}
		e.SetTextOptionsResolver(func(string) (datafile.TextOptions, error) {
			return datafile.TextOptions{Delimiter: ",", Header: true}, nil
		})
		if _, err = e.Open(ctx, path); err == nil {
			if _, err = e.Query(ctx, req("SELECT * FROM data")); err == nil {
				t.Fatal("accepted malformed text")
			}
		}
	}
	for _, optionsError := range []bool{false, true} {
		e.SetTextOptionsResolver(func(string) (datafile.TextOptions, error) {
			if optionsError {
				return datafile.TextOptions{}, errors.New("unreadable settings")
			}
			return datafile.TextOptions{Delimiter: "'"}, nil
		})
		if _, err = e.Open(ctx, path); err == nil {
			t.Fatal("invalid preferences accepted")
		}
	}
}
