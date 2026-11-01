package engine

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStreamCompleteQueryAndBudgets(t *testing.T) {
	e, dir := setup(t)
	ctx := context.Background()
	source := filepath.Join(dir, "orders.parquet")
	before, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	r := Request{SQL: "SELECT order_id AS id, city FROM data", Limit: 2, Offset: 30, FilterColumn: "city", FilterValue: "Kyoto", Sort: "id", Desc: true}
	count, headers := 0, 0
	err = e.Stream(ctx, r, func(cols []Column, row []*string) error {
		if row == nil {
			headers++
			if len(cols) != 2 || cols[0].Name != "id" {
				t.Fatal(cols)
			}
			return nil
		}
		if *row[0] != fmt.Sprint(1237-count*4) || *row[1] != "Kyoto" {
			t.Fatal(row)
		}
		count++
		return nil
	})
	if err != nil || count != 60 || headers != 1 {
		t.Fatal(count, headers, err)
	}
	// More than a page and more than the page byte budget, consumed one row at a time.
	count = 0
	err = e.Stream(ctx, req("SELECT i, repeat('x',60000) FROM range(600) t(i)"), func(_ []Column, row []*string) error {
		if row != nil {
			if *row[0] != fmt.Sprint(count) || len(*row[1]) != 60000 {
				t.Fatal(row[0])
			}
			count++
		}
		return nil
	})
	if err != nil || count != 600 {
		t.Fatal(count, err)
	}
	for _, q := range []string{"SELECT repeat('x',65537)", "SELECT " + strings.Repeat("repeat('x',65536),", 64) + " repeat('x',65536)", "SELECT 1; COPY data TO 'unsafe.parquet'", "SELECT * FROM read_parquet('https://example.com/a.parquet')"} {
		if err = e.Stream(ctx, req(q), func([]Column, []*string) error { return nil }); err == nil {
			t.Fatal("accepted", q)
		}
	}
	after, err := os.ReadFile(source)
	if err != nil || sha256.Sum256(before) != sha256.Sum256(after) {
		t.Fatal("source changed", err)
	}
	count = 0
	if err = e.Stream(ctx, req("SELECT * FROM data WHERE false"), func(_ []Column, row []*string) error {
		count++
		if row != nil {
			t.Fatal(row)
		}
		return nil
	}); err != nil || count != 1 {
		t.Fatal(count, err)
	}
}

func TestStreamCancellationAndConsumerFailure(t *testing.T) {
	e, _ := setup(t)
	ctx := context.Background()
	sentinel := errors.New("disk full")
	if err := e.Stream(ctx, req("SELECT 1"), nil); err == nil {
		t.Fatal("nil consumer")
	}
	for _, onHeader := range []bool{true, false} {
		err := e.Stream(ctx, req("SELECT * FROM data"), func(_ []Column, row []*string) error {
			if (row == nil) == onHeader {
				return sentinel
			}
			return nil
		})
		if !errors.Is(err, sentinel) {
			t.Fatal(err)
		}
	}
	child, cancel := context.WithCancel(ctx)
	count := 0
	err := e.Stream(child, req("SELECT * FROM range(1000000)"), func(_ []Column, row []*string) error {
		if row != nil {
			count++
			cancel()
		}
		return nil
	})
	if err == nil || count != 1 {
		t.Fatal(count, err)
	}
	err = e.Stream(ctx, req("SELECT * FROM range(1000000)"), func(_ []Column, row []*string) error {
		if row == nil {
			e.Cancel()
		}
		return nil
	})
	if err == nil {
		t.Fatal("engine cancel ignored")
	}
	e.gate <- struct{}{}
	if err = e.Stream(ctx, req("SELECT 1"), func([]Column, []*string) error { return nil }); err == nil {
		t.Fatal("concurrent stream")
	}
	<-e.gate
	if _, err := e.Query(ctx, req("SELECT 42")); err != nil {
		t.Fatal("recovery", err)
	}
}

func TestStreamLargeParquetLowMemory(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "stream.parquet")
	generator, err := sql.Open("duckdb", "")
	if err != nil {
		t.Fatal(err)
	}
	_, err = generator.Exec("COPY (SELECT i AS id, repeat(md5(i::VARCHAR),64) AS payload FROM range(150000) t(i)) TO " + literal(path) + " (FORMAT PARQUET,COMPRESSION UNCOMPRESSED,ROW_GROUP_SIZE 2048)")
	generator.Close()
	if err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(path)
	if err != nil || st.Size() < 256<<20 {
		t.Fatal("fixture must exceed twice the memory budget", st, err)
	}
	e := New()
	defer e.Close()
	if err = e.Configure(Resources{MemoryMiB: 128, TempGiB: 0, TimeoutSeconds: 60}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err = e.Open(ctx, path); err != nil {
		t.Fatal(err)
	}
	count := 0
	err = e.Stream(ctx, req("SELECT * FROM data"), func(_ []Column, row []*string) error {
		if row != nil {
			if *row[0] != fmt.Sprint(count) || len(*row[1]) != 2048 {
				t.Fatal(row[0])
			}
			count++
		}
		return nil
	})
	if err != nil || count != 150000 {
		t.Fatalf("incremental low-memory scan: rows=%d error=%v", count, err)
	}
	count = 0
	err = e.Stream(ctx, req(`SELECT id AS "duplicate", NULL AS "duplicate" FROM data ORDER BY id DESC`), func(_ []Column, row []*string) error {
		if row != nil {
			if *row[0] != fmt.Sprint(149999-count) || row[1] != nil {
				t.Fatal("sorted duplicate-column output", row)
			}
			count++
		}
		return nil
	})
	if err != nil || count != 150000 {
		t.Fatalf("ordered scan: rows=%d error=%v", count, err)
	}
	count = 0
	err = e.Stream(ctx, req("SELECT CASE WHEN id=149999 THEN error('late row failure') ELSE payload END FROM data"), func(_ []Column, row []*string) error {
		if row != nil {
			count++
		}
		return nil
	})
	if err == nil || count == 0 || count >= 150000 {
		t.Fatalf("expected rows before late execution failure: rows=%d error=%v", count, err)
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
		t.Fatalf("incremental cancellation: rows=%d error=%v", count, err)
	}
}
