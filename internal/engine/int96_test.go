package engine_test

import (
	"bamboo/internal/cloudstorage"
	"bamboo/internal/cloudstoragetest"
	"bamboo/internal/engine"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Write PLAIN INT96 independently of DuckDB: nanoseconds since midnight followed
// by a Julian day, both little endian. Reuse the compact Thrift test encoder.
func int96File(t *testing.T, dir string) string {
	t.Helper()
	var root, col, page, data, metadata, chunk, group, footer compact
	root.field(4, 8, str("schema"))
	root.field(5, 5, vint(1))
	col.field(1, 5, vint(3)) // INT96
	col.field(3, 5, vint(1)) // OPTIONAL
	col.field(4, 8, str("stamp"))
	// Five present values, followed by NULL; one bit-packed definition group.
	payload := []byte{2, 0, 0, 0, 3, 31}
	for _, value := range []struct {
		day   uint32
		nanos uint64
	}{{2440588, 1}, {2440588, 123456789}, {2440587, 86399999999999}, {1721426, 1}, {5373484, 86399999999999}} {
		payload = binary.LittleEndian.AppendUint64(payload, value.nanos)
		payload = binary.LittleEndian.AppendUint32(payload, value.day)
	}
	data.field(1, 5, vint(6))
	data.field(2, 5, vint(0)) // PLAIN
	data.field(3, 5, vint(3)) // RLE definition levels
	data.field(4, 5, vint(3))
	page.field(1, 5, vint(0))
	page.field(2, 5, vint(int64(len(payload))))
	page.field(3, 5, vint(int64(len(payload))))
	page.field(5, 12, data.end())
	encoded := append(page.end(), payload...)
	metadata.field(1, 5, vint(3))
	metadata.field(2, 9, list(5, vint(0), vint(3)))
	metadata.field(3, 9, list(8, str("stamp")))
	metadata.field(4, 5, vint(0)) // UNCOMPRESSED
	metadata.field(5, 6, vint(6))
	metadata.field(6, 6, vint(int64(len(encoded))))
	metadata.field(7, 6, vint(int64(len(encoded))))
	metadata.field(9, 6, vint(4))
	chunk.field(2, 6, vint(4))
	chunk.field(3, 12, metadata.end())
	group.field(1, 9, list(12, chunk.end()))
	group.field(2, 6, vint(int64(len(encoded))))
	group.field(3, 6, vint(6))
	footer.field(1, 5, vint(1))
	footer.field(2, 9, list(12, root.end(), col.end()))
	footer.field(3, 6, vint(6))
	footer.field(4, 9, list(12, group.end()))
	meta := footer.end()
	file := append([]byte("PAR1"), encoded...)
	file = append(file, meta...)
	file = binary.LittleEndian.AppendUint32(file, uint32(len(meta)))
	file = append(file, "PAR1"...)
	path := filepath.Join(dir, "int96.parquet")
	if err := os.WriteFile(path, file, 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func checkINT96(t *testing.T, e *engine.Engine, table string) {
	t.Helper()
	ctx := context.Background()
	want := []string{
		"{'date': 1970-01-01, 'time': '00:00:00.000000001'}",
		"{'date': 1970-01-01, 'time': '00:00:00.123456789'}",
		"{'date': 1969-12-31, 'time': '23:59:59.999999999'}",
		"{'date': 0001-01-01, 'time': '00:00:00.000000001'}",
		"{'date': 9999-12-31, 'time': '23:59:59.999999999'}",
	}
	for i := 0; i < 6; i++ {
		r, err := e.Query(ctx, engine.Request{SQL: "SELECT * FROM " + table, Offset: i, Limit: 1})
		if err != nil {
			t.Fatal(err)
		}
		if len(r.Rows) != 1 || len(r.Columns) != 1 || r.More != (i < 5) || r.Columns[0].Type != `STRUCT(date DATE, "time" TIME_NS)` {
			t.Fatalf("INT96 schema or pagination: %+v", r)
		}
		if i == 5 {
			if r.Rows[0][0] != nil {
				t.Fatal("INT96 NULL changed")
			}
		} else if r.Rows[0][0] == nil || *r.Rows[0][0] != want[i] {
			t.Fatalf("row %d: got %v, want %s", i, r.Rows[0][0], want[i])
		}
	}
	// Child extraction/filtering must remain exact, including predicate pushdown.
	r, err := e.Query(ctx, engine.Request{SQL: "SELECT stamp.date, stamp.time FROM " + table + " WHERE stamp.date = DATE '1970-01-01'", Limit: 10, Sort: "time", Desc: true})
	if err != nil || len(r.Rows) != 2 || *r.Rows[0][1] != "00:00:00.123456789" || *r.Rows[1][1] != "00:00:00.000000001" {
		t.Fatal("INT96 child selection/sort", r, err)
	}
}

func checkINT96Timestamp(t *testing.T, e *engine.Engine, table string) {
	t.Helper()
	// Preserve the existing TIMESTAMP contract, including its documented
	// microsecond precision. Exact sub-microsecond reads are tested separately.
	want := []string{
		"1970-01-01 00:00:00",
		"1970-01-01 00:00:00.123456",
		"1969-12-31 23:59:59.999999",
		"0001-01-01 00:00:00",
		"9999-12-31 23:59:59.999999",
	}
	ctx := context.Background()
	for i := 0; i < 6; i++ {
		r, err := e.Query(ctx, engine.Request{SQL: "SELECT * FROM " + table, Offset: i, Limit: 1})
		if err != nil {
			t.Fatal(err)
		}
		if len(r.Rows) != 1 || len(r.Columns) != 1 || r.More != (i < 5) || r.Columns[0].Type != "TIMESTAMP" {
			t.Fatalf("default INT96 schema or pagination: %+v", r)
		}
		if i == 5 {
			if r.Rows[0][0] != nil {
				t.Fatal("INT96 NULL changed")
			}
		} else if r.Rows[0][0] == nil || *r.Rows[0][0] != want[i] {
			t.Fatalf("row %d: got %v, want %s", i, r.Rows[0][0], want[i])
		}
	}
	// Ordinary timestamp functions, comparisons and ordering must keep working.
	r, err := e.Query(ctx, engine.Request{SQL: "SELECT date_trunc('day', stamp) AS day, stamp + INTERVAL 1 SECOND AS later FROM " + table + " WHERE stamp >= TIMESTAMP '1970-01-01' AND stamp < TIMESTAMP '1970-01-02'", Limit: 10, Sort: "later", Desc: true})
	if err != nil || len(r.Rows) != 2 || *r.Rows[0][0] != "1970-01-01 00:00:00" || *r.Rows[0][1] != "1970-01-01 00:00:01.123456" || *r.Rows[1][1] != "1970-01-01 00:00:01" {
		t.Fatal("INT96 timestamp functions/sort", r, err)
	}
}

func TestINT96CompatibilityAndExplicitPrecision(t *testing.T) {
	path := int96File(t, t.TempDir())
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	e := engine.New()
	defer e.Close()
	if _, err = e.OpenScoped(ctx, path, func(string) (string, error) { return path, nil }); err != nil {
		t.Fatal(err)
	}
	checkINT96Timestamp(t, e, "data")
	checkINT96Timestamp(t, e, `workspace."int96.parquet"`)
	// The existing scoped SQL reader can opt into full precision without
	// changing the default schema or granting access to any additional paths.
	quote := func(path string) string { return "'" + strings.ReplaceAll(path, "'", "''") + "'" }
	exact := "read_parquet(" + quote(path) + ", int96_as='struct')"
	checkINT96(t, e, exact)
	checkINT96Timestamp(t, e, "data") // Opting in must not alter the default view.
	unopened := int96File(t, t.TempDir())
	if _, err = e.Query(ctx, engine.Request{SQL: "SELECT * FROM read_parquet(" + quote(unopened) + ", int96_as='struct')", Limit: 1}); err == nil {
		t.Fatal("explicit INT96 reader accessed unopened file")
	}
	if _, err = e.Query(ctx, engine.Request{SQL: "SELECT CAST('invalid' AS BIGINT) FROM data", Limit: 1}); err == nil {
		t.Fatal("invalid query accepted")
	}
	checkINT96Timestamp(t, e, "data") // Recreated databases retain the default schema.
	checkINT96(t, e, exact)
	server := cloudstoragetest.New(filepath.Dir(path))
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
			if _, err = e.OpenRemote(ctx, info.Root+"/int96.parquet", "int96.parquet", store.Resolver(info.Root)); err != nil {
				t.Fatal(err)
			}
			checkINT96Timestamp(t, e, "data")
			transferred := server.Bytes.Load()
			checkINT96Timestamp(t, e, "data")
			if server.Bytes.Load() != transferred {
				t.Fatal("repeat preview transferred more bytes")
			}
			checkINT96Timestamp(t, e, `workspace."int96.parquet"`)
			e.Close()
		})
	}
	after, err := os.ReadFile(path)
	if err != nil || sha256.Sum256(before) != sha256.Sum256(after) {
		t.Fatal("source changed", err)
	}
	after, err = os.ReadFile(unopened)
	if err != nil || sha256.Sum256(before) != sha256.Sum256(after) {
		t.Fatal("unopened source changed", err)
	}
}
