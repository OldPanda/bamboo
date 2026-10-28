package engine

import (
	"bamboo/internal/fixtures"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func setup(t *testing.T) (*Engine, string) {
	t.Helper()
	dir := t.TempDir()
	if err := fixtures.Generate(dir, false); err != nil {
		t.Fatal(err)
	}
	e := New()
	t.Cleanup(e.Close)
	if _, err := e.Open(context.Background(), filepath.Join(dir, "orders.parquet")); err != nil {
		t.Fatal(err)
	}
	return e, dir
}
func req(q string) Request { return Request{SQL: q, Limit: 100} }
func TestPagingFilterSort(t *testing.T) {
	e, _ := setup(t)
	r, err := e.Query(context.Background(), req("SELECT * FROM data"))
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Rows) != 100 || !r.More || *r.Rows[0][0] != "1001" {
		t.Fatalf("bad first page: %+v", r)
	}
	q := req("SELECT * FROM data")
	q.Offset = 200
	r, err = e.Query(context.Background(), q)
	if err != nil || len(r.Rows) != 40 || r.More {
		t.Fatalf("last page: %v %+v", err, r)
	}
	q.Offset = 0
	q.FilterColumn = "city"
	q.FilterValue = "Kyoto"
	q.Sort = "order_id"
	q.Desc = true
	r, err = e.Query(context.Background(), q)
	if err != nil || len(r.Rows) != 60 || *r.Rows[0][0] != "1237" {
		t.Fatalf("filter/sort: %v %+v", err, r)
	}
	q.FilterValue = "' OR 1=1 --"
	r, err = e.Query(context.Background(), q)
	if err != nil || len(r.Rows) != 0 {
		t.Fatal("filter value escaped its parameter", err)
	}
}
func TestExactTypesAndEmpty(t *testing.T) {
	e, dir := setup(t)
	if _, err := e.Open(context.Background(), filepath.Join(dir, "special.parquet")); err != nil {
		t.Fatal(err)
	}
	r, err := e.Query(context.Background(), req("SELECT * FROM data"))
	if err != nil {
		t.Fatal(err)
	}
	wants := map[int]string{0: "9223372036854775807", 1: "18446744073709551615", 2: "12345678901234567890.123456789", 3: "2026-01-02 03:04:05.123456789", 6: "[1, NULL, 3]", 9: "", 10: "<img src=x onerror=alert(1)>"}
	for i, w := range wants {
		if r.Rows[0][i] == nil || *r.Rows[0][i] != w {
			t.Errorf("column %d: got %v want %s", i, r.Rows[0][i], w)
		}
	}
	if r.Rows[0][8] != nil {
		t.Error("null lost")
	}
	t.Logf("nested=%s timestamp_tz=%s blob=%s", *r.Rows[0][5], *r.Rows[0][4], *r.Rows[0][7])
	if _, err = e.Open(context.Background(), filepath.Join(dir, "empty.parquet")); err != nil {
		t.Fatal(err)
	}
	r, err = e.Query(context.Background(), req("SELECT * FROM data"))
	if err != nil || len(r.Rows) != 0 || len(r.Columns) != 2 {
		t.Fatal("empty schema", err, r)
	}
}
func TestReadOnlyAndFileBoundaries(t *testing.T) {
	e, dir := setup(t)
	secret := filepath.Join(dir, "secret.txt")
	os.WriteFile(secret, []byte("private"), 0600)
	out := filepath.Join(dir, "stolen.csv")
	attacks := []string{
		"COPY data TO " + literal(out), "DROP VIEW data", "SET enable_external_access=true", "INSTALL httpfs", "ATTACH ':memory:' AS other", "DELETE FROM data",
		"SELECT 1; COPY data TO " + literal(out), "SELECT 1) x; COPY data TO " + literal(out) + "; SELECT * FROM (SELECT 1",
		"SELECT * FROM read_text(" + literal(secret) + ")", "SELECT * FROM read_parquet(" + literal(filepath.Join(dir, "special.parquet")) + ")",
		"SELECT * FROM read_parquet('https://example.com/private.parquet')", "SELECT * FROM glob(" + literal(dir+"/*") + ")",
		"SELECT * FROM query(" + literal("COPY data TO "+literal(out)) + ")",
		"SELECT * FROM query(" + literal("SET enable_external_access=true") + ")",
		"SELECT * FROM read_blob(" + literal(secret) + ")", "WITH x AS (DELETE FROM data RETURNING *) SELECT * FROM x",
	}
	for _, q := range attacks {
		t.Run(q, func(t *testing.T) {
			if _, err := e.Query(context.Background(), req(q)); err == nil {
				t.Fatal("unsafe query accepted")
			}
		})
	}
	if _, err := os.Stat(out); !os.IsNotExist(err) {
		t.Fatal("query wrote a file")
	}
	for _, path := range []string{"relative.parquet", "https://example.com/data.parquet", dir, secret, filepath.Join(dir, "*.parquet"), filepath.Join(dir, "malformed.parquet")} {
		if _, err := e.Open(context.Background(), path); err == nil {
			t.Errorf("accepted bad path %s", path)
		}
	}
	r, err := e.Query(context.Background(), req("SELECT count(*) FROM data"))
	if err != nil || *r.Rows[0][0] != "240" {
		t.Fatal("failed open destroyed session", err)
	}
	for _, q := range []string{"SELECT ';' AS semi", "SELECT 1 /* ; nested /* ; */ */", "WITH x AS (SELECT 1 AS n) SELECT n FROM x;", "SELECT 1 -- ; comment"} {
		if _, err := e.Query(context.Background(), req(q)); err != nil {
			t.Errorf("valid query %s: %v", q, err)
		}
	}
}
func TestQuotedPathAndIdentifiers(t *testing.T) {
	e, dir := setup(t)
	source, _ := os.ReadFile(filepath.Join(dir, "orders.parquet"))
	p := filepath.Join(dir, "竹 ' file.parquet")
	os.WriteFile(p, source, 0600)
	if _, err := e.Open(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	q := req(`SELECT order_id AS "x""; DROP VIEW data; --" FROM data`)
	q.Sort = `x"; DROP VIEW data; --`
	r, err := e.Query(context.Background(), q)
	if err != nil || len(r.Rows) != 100 {
		t.Fatal("quoted identifier", err)
	}
}
func TestLimitsAndCancellation(t *testing.T) {
	e, _ := setup(t)
	for _, q := range []Request{{Limit: 501}, {Limit: 0}, {Limit: 1, Offset: -1}, {Limit: 1, Offset: 1000000001}, req("SELECT repeat('x',70000)"), req("SELECT repeat('x',60000) FROM range(100)"), req("SELECT " + strings.Repeat("1,", 256) + "1")} {
		if _, err := e.Query(context.Background(), q); err == nil {
			t.Errorf("limit was not enforced %+v", q)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := e.Query(ctx, req("SELECT * FROM data")); err == nil {
		t.Fatal("canceled context accepted")
	}
	done := make(chan error, 1)
	go func() {
		_, err := e.Query(context.Background(), req("SELECT sum(a.i*b.i) FROM range(1000000) a(i), range(1000000) b(i)"))
		done <- err
	}()
	// Wait for the operation to register its cancellation context.
	for i := 0; i < 100; i++ {
		e.mu.Lock()
		active := e.cancel != nil
		e.mu.Unlock()
		if active {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if _, err := e.Query(context.Background(), req("SELECT 1")); err == nil {
		t.Fatal("parallel query accepted")
	}
	started := time.Now()
	e.Cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancel unexpectedly succeeded")
		}
		t.Log("cancellation latency", time.Since(started))
	case <-time.After(3 * time.Second):
		t.Fatal("cancel did not interrupt")
	}
	if _, err := e.Query(context.Background(), req("SELECT 1")); err != nil {
		t.Fatal("engine did not recover", err)
	}
	// Check the actual locked settings, not just the configuration strings.
	for name, want := range map[string]string{"enable_external_access": "false", "autoinstall_known_extensions": "false", "autoload_known_extensions": "false", "lock_configuration": "true", "threads": "2"} {
		var got string
		if err := e.db.QueryRow("SELECT current_setting(?)::VARCHAR", name).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("%s=%s want %s", name, got, want)
		}
	}
	if _, err := e.db.Exec("SET enable_external_access=true"); err == nil {
		t.Fatal("configuration was not locked")
	}
}
func TestLargeFixture(t *testing.T) {
	if os.Getenv("BAMBOO_LARGE_TEST") == "" {
		t.Skip("set BAMBOO_LARGE_TEST=1 for million-row measurement")
	}
	dir := t.TempDir()
	if err := fixtures.Generate(dir, true); err != nil {
		t.Fatal(err)
	}
	e := New()
	defer e.Close()
	start := time.Now()
	f, err := e.Open(context.Background(), filepath.Join(dir, "million.parquet"))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("open=%s bytes=%s rows=%s groups=%s", time.Since(start), f.Bytes, f.Rows, f.RowGroups)
	for _, q := range []Request{{Limit: 100}, {Limit: 100, Offset: 900000}, {Limit: 100, Sort: "amount", Desc: true}, {Limit: 100, FilterColumn: "segment", FilterValue: "segment_42"}, req("SELECT segment, sum(amount) AS total FROM data GROUP BY segment ORDER BY total DESC")} {
		start = time.Now()
		r, err := e.Query(context.Background(), q)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("query=%+v wall=%s rows=%d", q, time.Since(start), len(r.Rows))
	}
}
func TestNoSourceMutation(t *testing.T) {
	e, dir := setup(t)
	p := filepath.Join(dir, "orders.parquet")
	before, _ := os.ReadFile(p)
	_, _ = e.Query(context.Background(), req("SELECT * FROM data"))
	after, _ := os.ReadFile(p)
	if string(before) != string(after) {
		t.Fatal("source changed")
	}
}

func TestDeadline(t *testing.T) {
	e, _ := setup(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := e.Query(ctx, req("SELECT sum(a.i*b.i) FROM range(1000000) a(i), range(1000000) b(i)"))
	if err == nil || time.Since(start) > time.Second {
		t.Fatal("deadline was not honored", err)
	}
	if _, err = e.Query(context.Background(), req("SELECT 1")); err != nil {
		t.Fatal("recovery after deadline", err)
	}
}
