package engine

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSQLLexicalBoundaries(t *testing.T) {
	for _, s := range []string{"SELECT 'unfinished", `SELECT "unfinished`, "SELECT (1", "SELECT 1)", "SELECT (1;)", "SELECT $$x$$", "SELECT 1 /* unfinished", "SELECT 1; -- trailing", "SELECT 1; SELECT 2", "/*comment*/ SELECT 1"} {
		t.Run(s, func(t *testing.T) {
			if _, err := selectSQL(s); err == nil {
				t.Fatal("accepted invalid boundary")
			}
		})
	}
	for input, want := range map[string]string{"": "SELECT * FROM data", "  \n ": "SELECT * FROM data", "select 'it''s;safe' ; ": "select 'it''s;safe'", `SELECT 1 AS "a""b"`: `SELECT 1 AS "a""b"`, "WITH x AS (SELECT (1)) SELECT * FROM x": "WITH x AS (SELECT (1)) SELECT * FROM x", "SELECT 1 -- ; )\n + 2": "SELECT 1 -- ; )\n + 2", "SELECT /* outer /* inner */ end */ 1": "SELECT /* outer /* inner */ end */ 1"} {
		got, err := selectSQL(input)
		if err != nil || got != want {
			t.Errorf("%q = %q, %v; want %q", input, got, err, want)
		}
	}
}

func TestOpenPathsAndFailedReplacement(t *testing.T) {
	e, dir := setup(t)
	for _, name := range []string{"glob*.parquet", "glob?.parquet", "glob[1].parquet"} {
		p := filepath.Join(dir, name)
		// Windows cannot create names containing * or ?; still test their rejection.
		if err := os.WriteFile(p, []byte("x"), 0600); err != nil && !(runtime.GOOS == "windows" && strings.ContainsAny(name, "*?")) {
			t.Fatal(err)
		}
		if _, err := e.Open(context.Background(), p); err == nil || !strings.Contains(err.Error(), "glob") {
			t.Fatalf("glob %q: %v", p, err)
		}
	}
	p := filepath.Join(dir, "directory.parquet")
	if err := os.Mkdir(p, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Open(context.Background(), p); err == nil || !strings.Contains(err.Error(), "regular") {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := e.Open(ctx, filepath.Join(dir, "orders.parquet")); err == nil {
		t.Fatal("canceled open succeeded")
	}
	// Holding the gate makes the competing operation deterministic, with no sleeps.
	_, done, err := e.start(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Open(context.Background(), filepath.Join(dir, "empty.parquet")); err == nil {
		t.Error("concurrent open succeeded")
	}
	done()
	r, err := e.Query(context.Background(), req("SELECT count(*) FROM data"))
	if err != nil || *r.Rows[0][0] != "240" {
		t.Fatal("old session lost", err)
	}
	link := filepath.Join(dir, "alias.PARQUET")
	if err := os.Symlink(filepath.Join(dir, "orders.parquet"), link); err != nil {
		t.Fatal(err)
	}
	f, err := e.Open(context.Background(), link)
	if err != nil || f.Name != "orders.parquet" || f.Rows != "240" {
		t.Fatal("canonical symlink", f, err)
	}
}

func TestQueryErrorsAndExactBoundaries(t *testing.T) {
	empty := New()
	defer empty.Close()
	if _, err := empty.Query(context.Background(), req("SELECT 1")); err == nil {
		t.Fatal("query without file succeeded")
	}
	e, _ := setup(t)
	for _, q := range []Request{req(strings.Repeat("x", 32769)), {Limit: 1, FilterValue: strings.Repeat("x", 4097)}, {Limit: 1, Sort: "missing"}, {Limit: 1, FilterColumn: "missing"}, req("SELECT CAST('no' AS INTEGER)")} {
		if _, err := e.Query(context.Background(), q); err == nil {
			t.Fatalf("accepted %+v", q)
		}
	}
	for _, q := range []Request{{Limit: 500, Offset: 1000000000}, {Limit: 1, SQL: "SELECT repeat('x',65536)"}, {Limit: 64, SQL: "SELECT repeat('x',65536) FROM range(64)"}, {Limit: 1, SQL: "SELECT " + strings.Repeat("1,", 255) + "1"}, {Limit: 1, FilterColumn: "city", FilterValue: strings.Repeat("x", 4096)}, {Limit: 1, SQL: "SELECT 1" + strings.Repeat(" ", 32760)}} {
		r, err := e.Query(context.Background(), q)
		if err != nil {
			t.Fatal("inclusive limit", err)
		}
		if r.More {
			t.Fatal("unexpected extra row", q)
		}
	}
	r, err := e.Query(context.Background(), req("SELECT 42"))
	if err != nil || *r.Rows[0][0] != "42" {
		t.Fatal("failed query prevented recovery", err)
	}
}

func TestOversizedSchemaFailsWithoutReplacingSession(t *testing.T) {
	e, dir := setup(t)
	db, err := sql.Open("duckdb", "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	p := filepath.Join(dir, "wide.parquet")
	fields := make([]string, 64)
	for i := range fields {
		fields[i] = "1 AS " + ident(strings.Repeat("x", 16384)+strings.Repeat("y", i))
	}
	if _, err := db.Exec("COPY (SELECT " + strings.Join(fields, ",") + ") TO " + literal(p) + " (FORMAT PARQUET)"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Open(context.Background(), p); err == nil || !strings.Contains(err.Error(), "schema exceeds 1 MiB") {
		t.Fatal("wide schema", err)
	}
	r, err := e.Query(context.Background(), req("SELECT count(*) FROM data"))
	if err != nil || *r.Rows[0][0] != "240" {
		t.Fatal("old data lost", err)
	}
	resolve := func(string) (string, error) { return p, nil }
	if _, err := e.QueryWorkspace(context.Background(), req(`SELECT * FROM workspace."wide.parquet"`), resolve); err == nil || !strings.Contains(err.Error(), "schema exceeds 1 MiB") {
		t.Fatal("oversized query schema was accepted", err)
	}
	r, err = e.QueryWorkspace(context.Background(), req(`SELECT 42 FROM workspace."wide.parquet"`), resolve)
	if err != nil || len(r.Columns) != 1 || len(r.Rows) != 1 || *r.Rows[0][0] != "42" {
		t.Fatal("narrow workspace query could not recover", err)
	}
}

func TestSchemaBudgetExactBoundaries(t *testing.T) {
	e, _ := setup(t)
	nameBytes := MaxSchema - 64 - len("INTEGER")
	name := strings.Repeat("竹", nameBytes/3) + strings.Repeat("x", nameBytes%3)
	cols, err := describe(context.Background(), e.db, "SELECT 1 AS "+ident(name))
	if err != nil || len(cols) != 1 || cols[0].Name != name {
		t.Fatal("inclusive metadata byte budget", err)
	}
	if _, err := describe(context.Background(), e.db, "SELECT 1 AS "+ident(name+"x")); err == nil || !strings.Contains(err.Error(), "schema exceeds 1 MiB") {
		t.Fatal("metadata byte budget was not enforced", err)
	}
}

func TestNestedTypeMetadata(t *testing.T) {
	e, dir := setup(t)
	if _, err := e.Open(context.Background(), filepath.Join(dir, "special.parquet")); err != nil {
		t.Fatal(err)
	}
	r, err := e.Query(context.Background(), req("SELECT utc_time, nested, bytes, formula FROM data"))
	if err != nil {
		t.Fatal(err)
	}
	wants := []string{"2026-01-02 03:04:05+00", "{'label': 竹子, 'items': [1, NULL, 3]}", `\x00\xFF`, "=1+1"}
	for i, want := range wants {
		if r.Rows[0][i] == nil || *r.Rows[0][i] != want {
			t.Errorf("column %d: %v want %s", i, r.Rows[0][i], want)
		}
	}
	if r.Columns[0].Type != "TIMESTAMP WITH TIME ZONE" || r.Columns[2].Type != "BLOB" || !strings.HasPrefix(r.Columns[1].Type, "STRUCT(") {
		t.Fatal(r.Columns)
	}
}
