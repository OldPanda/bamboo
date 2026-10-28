package engine

import (
	"context"
	"crypto/sha256"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEscapeStringSourceWriteRejected(t *testing.T) {
	e, dir := setup(t)
	target := filepath.Join(dir, "orders.parquet")
	before, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for _, prefix := range []string{"E", "e"} {
		for depth := 1; depth <= 4; depth++ {
			q := "SELECT " + prefix + "'\\'' AS v" + strings.Repeat(") AS escaped", depth) + "; COPY (SELECT 42 AS audit_canary) TO " + literal(target) + " (FORMAT PARQUET, USE_TMP_FILE false); " + strings.Repeat("SELECT * FROM (", depth) + "SELECT " + prefix + "'\\'' AS v"
			if _, err := e.Query(ctx, req(q)); err == nil {
				t.Fatal("accepted source write")
			}
			// Exercise the native parser independently of the lexical rejection.
			if err := validateSelect(ctx, e.db, "SELECT * FROM ("+q+"\n) AS source"); err == nil {
				t.Fatal("native parser accepted injected commands")
			}
			after, err := os.ReadFile(target)
			if err != nil {
				t.Fatal(err)
			}
			if sha256.Sum256(before) != sha256.Sum256(after) {
				t.Fatal("source changed despite query rejection")
			}
		}
	}
	r, err := e.Query(ctx, req("SELECT count(*) FROM data"))
	if err != nil || *r.Rows[0][0] != "240" {
		t.Fatal("source unusable after attack", err)
	}
}

func TestNativeSelectParserDoesNotExecute(t *testing.T) {
	e, dir := setup(t)
	target := filepath.Join(dir, "orders.parquet")
	before, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		"SELECT 1; SELECT 2", "", "SELECT (", "SET enable_external_access = true",
		"COPY (SELECT 42) TO " + literal(target) + " (FORMAT PARQUET, USE_TMP_FILE false)",
		"SELECT 1; COPY (SELECT 42) TO " + literal(target) + " (FORMAT PARQUET, USE_TMP_FILE false); SELECT 2",
	} {
		if err := validateSelect(context.Background(), e.db, q); err == nil {
			t.Fatalf("accepted %q", q)
		}
	}
	after, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if sha256.Sum256(before) != sha256.Sum256(after) {
		t.Fatal("parser executed a statement")
	}
	for _, q := range []string{"SELECT * FROM data", "WITH x AS (SELECT 1) SELECT * FROM x", "SELECT ?", "SELECT 'it''s;safe'", `SELECT E'\''`} {
		if err := validateSelect(context.Background(), e.db, q); err != nil {
			t.Fatalf("native parse %q: %v", q, err)
		}
	}
}

func TestUnsupportedLexicalForms(t *testing.T) {
	for _, q := range []string{`SELECT E'hello'`, `SELECT e'hello'`, `WITH x AS (SELECT E'\'') SELECT * FROM x`, "SELECT 1\x00; SELECT 2", "SELECT 1 -- hidden\r; SELECT 2", "SELECT 1 -- hidden\r)"} {
		if _, err := selectSQL(q); err == nil {
			t.Fatalf("accepted %q", q)
		}
	}
	e, _ := setup(t)
	for _, q := range []string{`SELECT 'E''quoted'`, `SELECT '\'`, `SELECT 1 AS "E'alias"`, "SELECT /* outer /* E' */ inner */ 1", "SELECT 1 -- E'\r + 2", "WITH x AS (SELECT 'it''s;safe' AS v) SELECT v FROM x"} {
		if _, err := e.Query(context.Background(), req(q)); err != nil {
			t.Fatalf("valid query %q: %v", q, err)
		}
	}
}
