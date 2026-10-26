package engine

import (
	"bamboo/internal/workspace"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkspaceQueries(t *testing.T) {
	e, root := setup(t)
	root, _ = filepath.EvalSymlinks(root)
	s := workspace.New(t.TempDir())
	if _, err := s.Use(root); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	source, err := os.ReadFile(filepath.Join(root, "orders.parquet"))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(filepath.Join(root, "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	names := []string{"nested/orders.parquet", `竹 ' " orders.parquet`, "data.parquet"}
	for _, name := range names {
		if err = os.WriteFile(filepath.Join(root, name), source, 0600); err != nil {
			t.Fatal(err)
		}
	}
	open := func() {
		t.Helper()
		if _, err = e.OpenScoped(ctx, filepath.Join(root, "orders.parquet"), func(rel string) (string, error) { return s.Resolve(root, rel) }); err != nil {
			t.Fatal(err)
		}
	}
	open()
	cases := map[string]string{
		`SELECT count(*) FROM workspace."orders.parquet" a JOIN workspace."nested/orders.parquet" b USING(order_id)`:                                          "240",
		`WITH combined AS (SELECT * FROM workspace."orders.parquet" UNION ALL SELECT * FROM workspace."nested/orders.parquet") SELECT count(*) FROM combined`: "480",
		`SELECT count(*) FROM data a JOIN workspace."nested/orders.parquet" b USING(order_id)`:                                                                "240",
		`SELECT count(*) FROM workspace."empty.parquet"`:                                                                                                      "0",
		`SELECT count(*) FROM "workspace" /* nesting /* yes */ */ . "orders.parquet"`:                                                                         "240",
		`SELECT count(*) FROM workspace."竹 ' "" orders.parquet"`:                                                                                              "240",
		`SELECT count(*) FROM workspace."data.parquet"`:                                                                                                       "240",
		`SELECT big_id FROM workspace."special.parquet"`:                                                                                                      "9223372036854775807",
	}
	for q, want := range cases {
		t.Run(q, func(t *testing.T) {
			r, err := e.Query(ctx, req(q))
			if err != nil {
				t.Fatal(err)
			}
			if len(r.Rows) != 1 || r.Rows[0][0] == nil || *r.Rows[0][0] != want {
				t.Fatalf("got %+v want %s", r, want)
			}
		})
	}
	r := req(`SELECT a.order_id FROM workspace."orders.parquet" a JOIN workspace."nested/orders.parquet" b USING(order_id)`)
	r.Limit = 50
	r.Offset = 50
	r.Sort = "order_id"
	r.Desc = true
	page, err := e.Query(ctx, r)
	if err != nil || len(page.Rows) != 50 || !page.More || *page.Rows[0][0] != "1190" {
		t.Fatal(page, err)
	}
	r.Offset = 0
	r.FilterColumn = "order_id"
	r.FilterValue = "1001"
	page, err = e.Query(ctx, r)
	if err != nil || len(page.Rows) != 1 {
		t.Fatal(page, err)
	}
	// Missing/invalid siblings do not prevent unrelated queries or destroy the active file.
	for _, q := range []string{`SELECT * FROM workspace."missing.parquet"`, `SELECT * FROM workspace."malformed.parquet"`, `SELECT * FROM workspace."nested"`, `SELECT * FROM workspace."*.parquet"`, `SELECT * FROM workspace."../outside.parquet"`, `SELECT * FROM workspace."/tmp/outside.parquet"`} {
		if _, err = e.Query(ctx, req(q)); err == nil {
			t.Fatalf("accepted %s", q)
		}
	}
	outside := t.TempDir()
	outside, _ = filepath.EvalSymlinks(outside)
	os.WriteFile(filepath.Join(outside, "private.parquet"), source, 0600)
	os.Symlink(filepath.Join(outside, "private.parquet"), filepath.Join(root, "escape.parquet"))
	os.WriteFile(filepath.Join(root, "secret.txt"), []byte("private"), 0600)
	os.Mkdir(filepath.Join(root, "directory.parquet"), 0700)
	for _, q := range []string{
		`SELECT * FROM workspace."escape.parquet"`, `SELECT * FROM workspace."directory.parquet"`,
		`SELECT * FROM workspace."orders.parquet", read_parquet(` + literal(filepath.Join(outside, "private.parquet")) + `)`,
		`SELECT * FROM workspace."orders.parquet", read_parquet(` + literal(filepath.Join(root, "special.parquet")) + `)`,
		`SELECT * FROM workspace."orders.parquet", read_text(` + literal(filepath.Join(root, "secret.txt")) + `)`,
		`SELECT * FROM workspace."orders.parquet", read_parquet('https://example.com/data.parquet')`,
		`SELECT 1; COPY data TO '/tmp/should-not-exist.csv'`,
	} {
		if _, err = e.Query(ctx, req(q)); err == nil {
			t.Fatalf("accepted boundary escape: %s", q)
		}
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = e.Query(canceled, req(`SELECT * FROM workspace."orders.parquet"`)); err == nil {
		t.Fatal("canceled query accepted")
	}
	if _, err = e.Query(ctx, req(`SELECT * FROM workspace."orders.parquet"`)); err != nil {
		t.Fatal("recovery", err)
	}
	if err = s.Close(root); err != nil {
		t.Fatal(err)
	}
	if _, err = e.Query(ctx, req(`SELECT * FROM workspace."orders.parquet"`)); err == nil {
		t.Fatal("closed workspace accepted")
	}
	if _, err = e.Open(ctx, filepath.Join(root, "orders.parquet")); err != nil {
		t.Fatal(err)
	}
	if _, err = e.Query(ctx, req(`SELECT * FROM workspace."orders.parquet"`)); err == nil {
		t.Fatal("scope leaked into standalone file")
	}
	if _, err = e.Query(ctx, req("SELECT * FROM data")); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(filepath.Join(root, "orders.parquet"))
	if string(after) != string(source) {
		t.Fatal("source mutated")
	}
}

func TestWorkspaceReferenceDiscovery(t *testing.T) {
	for _, q := range []string{`SELECT 'workspace."secret.parquet"'`, `SELECT 1 -- workspace."secret.parquet"`, `SELECT 1 /* workspace."secret.parquet" /* nested */ */`, `SELECT 'it''s workspace."secret.parquet"'`} {
		refs, err := workspaceReferences(q)
		if err != nil || len(refs) != 0 {
			t.Fatal(q, refs, err)
		}
	}
	refs, err := workspaceReferences("WITH x_2 AS (SELECT * FROM WORKSPACE . \"a.parquet\")\nSELECT * FROM x_2 JOIN workspace.\"a.parquet\" ON true\t\r")
	if err != nil || len(refs) != 1 || refs[0] != "a.parquet" {
		t.Fatal(refs, err)
	}
	if _, err = workspaceReferences("DROP VIEW data"); err == nil {
		t.Fatal("unsafe statement")
	}
	names := []string{}
	for i := 0; i < 33; i++ {
		names = append(names, `workspace.`+ident(strings.Repeat("a", i+1)+".parquet"))
	}
	if _, err = workspaceReferences("SELECT * FROM " + strings.Join(names, ",")); err == nil {
		t.Fatal("unbounded file references")
	}
}
