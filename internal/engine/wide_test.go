package engine_test

import (
	"bamboo/internal/cloudstorage"
	"bamboo/internal/cloudstoragetest"
	"bamboo/internal/engine"
	"bamboo/internal/workspace"
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func wideParquet(t *testing.T, width, count int) string {
	t.Helper()
	db, err := sql.Open("duckdb", "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	fields := make([]string, width)
	for i := range fields {
		fields[i] = fmt.Sprintf("i * 10000 + %d AS c%d", i, i)
	}
	p := filepath.Join(t.TempDir(), "wide.parquet")
	q := fmt.Sprintf("COPY (SELECT %s FROM range(%d) t(i)) TO '%s' (FORMAT PARQUET)", strings.Join(fields, ","), count, strings.ReplaceAll(p, "'", "''"))
	if _, err := db.Exec(q); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestWideParquetPreview(t *testing.T) {
	for _, width := range []int{257, 512, 1024, 4096} {
		t.Run(fmt.Sprint(width), func(t *testing.T) {
			p := wideParquet(t, width, 150)
			before, err := os.ReadFile(p)
			if err != nil {
				t.Fatal(err)
			}
			e := engine.New()
			defer e.Close()
			f, err := e.Open(context.Background(), p)
			if err != nil {
				t.Fatal(err)
			}
			if len(f.Columns) != width || f.Rows != "150" {
				t.Fatal("schema lost columns or row count")
			}
			limit := min(100, engine.MaxPageCells/width)
			seen := 0
			for {
				r, err := e.Query(context.Background(), engine.Request{SQL: "SELECT * FROM data ORDER BY c0", Offset: seen, Limit: 100})
				if err != nil {
					t.Fatal(err)
				}
				if len(r.Columns) != width || r.PageSize != limit || len(r.Rows) != min(limit, 150-seen) || r.Offset != seen {
					t.Fatal("unexpected wide page dimensions", len(r.Columns), len(r.Rows), r.PageSize, r.Offset)
				}
				for i, row := range r.Rows {
					if len(row) != width {
						t.Fatal("row lost columns")
					}
					for j, cell := range row {
						if cell == nil || *cell != fmt.Sprint((seen+i)*10000+j) {
							t.Fatalf("wrong value at row %d column %d", seen+i, j)
						}
					}
				}
				seen += len(r.Rows)
				if r.More != (seen < 150) {
					t.Fatal("wrong next-page availability")
				}
				if !r.More {
					break
				}
			}
			last := fmt.Sprintf("c%d", width-1)
			r, err := e.Query(context.Background(), engine.Request{SQL: "SELECT * FROM data", Limit: 100, Sort: last, Desc: true, FilterColumn: last, FilterValue: fmt.Sprint(1490000 + width - 1)})
			if err != nil || len(r.Rows) != 1 || *r.Rows[0][width-1] != fmt.Sprint(1490000+width-1) {
				t.Fatal("last-column sort/filter", err)
			}
			r, err = e.Query(context.Background(), engine.Request{SQL: "SELECT " + last + " FROM data", Limit: 100})
			if err != nil || len(r.Columns) != 1 || r.PageSize != 100 || len(r.Rows) != 100 {
				t.Fatal("narrow projection did not restore requested page size", err)
			}
			after, err := os.ReadFile(p)
			if err != nil || sha256.Sum256(before) != sha256.Sum256(after) {
				t.Fatal("source changed", err)
			}
		})
	}
}

func TestWideEmptyAndNullResults(t *testing.T) {
	p := wideParquet(t, 1024, 0)
	e := engine.New()
	defer e.Close()
	if _, err := e.Open(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	r, err := e.Query(context.Background(), engine.Request{Limit: 500})
	if err != nil || len(r.Columns) != 1024 || len(r.Rows) != 0 || r.More || r.PageSize != 125 {
		t.Fatal("empty wide preview", err)
	}
	for _, value := range []string{"NULL::VARCHAR", "''"} {
		q := "SELECT " + strings.Repeat(value+",", 1023) + value + " FROM range(126)"
		r, err := e.Query(context.Background(), engine.Request{SQL: q, Limit: 500})
		if err != nil || len(r.Columns) != 1024 || len(r.Rows) != 125 || !r.More || r.PageSize != 125 {
			t.Fatal("empty cells bypassed budget", err)
		}
		for _, row := range r.Rows {
			for _, cell := range row {
				if value == "''" && (cell == nil || *cell != "") || value != "''" && cell != nil {
					t.Fatal("NULL/empty value changed")
				}
			}
		}
		r, err = e.Query(context.Background(), engine.Request{SQL: q, Limit: 500, Offset: 125})
		if err != nil || len(r.Rows) != 1 || r.More || r.PageSize != 125 {
			t.Fatal("final wide page", err)
		}
	}
}

func TestWideQueryPreservesExactLateColumns(t *testing.T) {
	e := engine.New()
	defer e.Close()
	q := "SELECT " + strings.Repeat("1,", 256) + `9223372036854775807::BIGINT AS big, 12345678901234567890.123456789::DECIMAL(38,9) AS exact, NULL AS missing, '' AS empty, '<img>' AS "末列 "" <img>"`
	r, err := e.QueryWorkspace(context.Background(), engine.Request{SQL: q, Limit: 100}, func(string) (string, error) {
		t.Fatal("constant query resolved a file")
		return "", nil
	})
	if err != nil || len(r.Columns) != 261 || len(r.Rows) != 1 {
		t.Fatal("wide computed query", err)
	}
	row := r.Rows[0]
	if *row[256] != "9223372036854775807" || *row[257] != "12345678901234567890.123456789" || row[258] != nil || *row[259] != "" || *row[260] != "<img>" || r.Columns[260].Name != `末列 " <img>` {
		t.Fatal("late columns lost exact values, NULL/empty or quoted names")
	}
}

func TestWideWorkspaceAndCloudPreview(t *testing.T) {
	p := wideParquet(t, 257, 3)
	dir := filepath.Dir(p)
	ctx := context.Background()
	e := engine.New()
	defer e.Close()
	check := func(t *testing.T, r *engine.Result, err error) {
		t.Helper()
		if err != nil || len(r.Columns) != 257 || len(r.Rows) != 3 || *r.Rows[2][256] != "20256" || r.More {
			t.Fatal("wide workspace/cloud preview", err)
		}
	}
	ws := workspace.New(t.TempDir())
	info, err := ws.Use(dir)
	if err != nil {
		t.Fatal(err)
	}
	request := engine.Request{SQL: `SELECT * FROM workspace."wide.parquet" ORDER BY c0`, Limit: 100}
	r, err := e.QueryWorkspace(ctx, request, func(ref string) (string, error) { return ws.Resolve(info.Root, ref) })
	check(t, r, err)
	server := cloudstoragetest.New(dir)
	defer server.Close()
	extension, err := filepath.Abs("../../build/extensions/httpfs.duckdb_extension")
	if err != nil {
		t.Fatal(err)
	}
	e.SetHTTPFS(extension)
	for _, provider := range []string{"r2", "s3"} {
		t.Run(provider, func(t *testing.T) {
			store := cloudstorage.NewWithTransport(t.TempDir(), &cloudstoragetest.Vault{}, server.Transport)
			input := cloudstoragetest.Input()
			if provider == "s3" {
				input.Provider, input.Endpoint, input.Region = "s3", "", "us-west-2"
				input.SessionToken = "fixture-session"
			}
			info, err := store.Connect(ctx, input)
			if err != nil {
				t.Fatal(err)
			}
			resolve := store.Resolver(info.Root)
			f, err := e.OpenRemote(ctx, info.Root+"/wide.parquet", "wide.parquet", resolve)
			if err != nil || len(f.Columns) != 257 {
				t.Fatal("wide cloud metadata", err)
			}
			r, err := e.Query(ctx, engine.Request{SQL: "SELECT * FROM data ORDER BY c0", Limit: 100})
			check(t, r, err)
			bytes := server.Bytes.Load()
			r, err = e.Query(ctx, engine.Request{SQL: "SELECT * FROM data ORDER BY c0", Limit: 100})
			check(t, r, err)
			if server.Bytes.Load() != bytes {
				t.Fatal("warm wide preview downloaded data again")
			}
			r, err = e.QueryRemoteWorkspace(ctx, request, resolve)
			check(t, r, err)
			e.Close()
		})
	}
}
