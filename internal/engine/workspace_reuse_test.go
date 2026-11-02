package engine

import (
	"bamboo/internal/datafile"
	"bamboo/internal/fixtures"
	"bamboo/internal/testutil"
	"bamboo/internal/workspace"
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// BenchmarkWorkspaceCatalog compares fresh and retained catalogs through the
// release engine using identical real sources, exact results and source hashes.
func BenchmarkWorkspaceCatalog(b *testing.B) {
	for _, count := range []int{2, 32} {
		for _, retain := range []bool{false, true} {
			b.Run(fmt.Sprintf("files=%d/retain=%t", count, retain), func(b *testing.B) {
				root := b.TempDir()
				if err := fixtures.Generate(root, false); err != nil {
					b.Fatal(err)
				}
				root, _ = filepath.EvalSymlinks(root)
				source, err := os.ReadFile(filepath.Join(root, "orders.parquet"))
				if err != nil {
					b.Fatal(err)
				}
				hash := sha256.Sum256(source)
				parts := make([]string, count)
				for i := range count {
					name := fmt.Sprintf("copy%d.parquet", i)
					if err = os.WriteFile(filepath.Join(root, name), source, 0600); err != nil {
						b.Fatal(err)
					}
					parts[i] = `SELECT count(*) n FROM workspace.` + ident(name)
				}
				s := workspace.New(b.TempDir())
				if _, err = s.Use(root); err != nil {
					b.Fatal(err)
				}
				resolve := func(ref string) (string, error) { return s.Resolve(root, ref) }
				e := New()
				defer e.Close()
				if err = e.Configure(Resources{MemoryMiB: 256, TempGiB: 0, TimeoutSeconds: 60}, nil); err != nil {
					b.Fatal(err)
				}
				request := req("SELECT sum(n)::BIGINT FROM (" + strings.Join(parts, " UNION ALL ") + ")")
				var roots []string
				if retain {
					roots = []string{root}
				}
				query := func() {
					r, err := e.QueryWorkspace(context.Background(), request, resolve, roots...)
					if err != nil || len(r.Rows) != 1 || *r.Rows[0][0] != fmt.Sprint(count*240) {
						b.Fatal("query result", r, err)
					}
				}
				query() // Exclude the first catalog and OS-cache warmup.
				b.ResetTimer()
				for range b.N {
					query()
				}
				b.StopTimer()
				for i := range count {
					after, err := os.ReadFile(filepath.Join(root, fmt.Sprintf("copy%d.parquet", i)))
					if err != nil || sha256.Sum256(after) != hash {
						b.Fatal("source changed", err)
					}
				}
			})
		}
	}
}

func TestWorkspaceReuseFreshTextAndDisk(t *testing.T) {
	e, root := setup(t)
	root, _ = filepath.EvalSymlinks(root)
	s := workspace.New(t.TempDir())
	if _, err := s.Use(root); err != nil {
		t.Fatal(err)
	}
	resolve := func(ref string) (string, error) { return s.Resolve(root, ref) }
	query := func(sql string) *Result {
		t.Helper()
		r, err := e.QueryWorkspace(context.Background(), req(sql), resolve, root)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	q := `SELECT count(*) FROM workspace."orders.parquet"`
	query(q)
	first := e.workspaceReuse.db
	first.diskFree = func(string) (int64, error) { return diskReserve - 1, nil }
	query(q)
	if e.workspaceReuse.db == first {
		t.Fatal("reused a quota larger than available disk")
	}
	// Restoring mtime must not hide a rewrite from the platform change identity.
	path := filepath.Join(root, "orders.parquet")
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	first = e.workspaceReuse.db
	if err = os.WriteFile(path, bytes, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(path, st.ModTime(), st.ModTime()); err != nil {
		t.Fatal(err)
	}
	query(q)
	if e.workspaceReuse.db == first {
		t.Fatal("rewrite with restored mtime reused")
	}
	text := filepath.Join(root, "text.csv")
	if err = os.WriteFile(text, []byte("id,value\n0001,2\n"), 0600); err != nil {
		t.Fatal(err)
	}
	options := datafile.TextOptions{Delimiter: ",", Header: true}
	e.SetTextOptionsResolver(func(string) (datafile.TextOptions, error) { return options, nil })
	textSQL := `SELECT * FROM workspace."text.csv"`
	r := query(textSQL)
	if *r.Rows[0][0] != "0001" || e.workspaceReuse.db != nil {
		t.Fatal("text options or fallback", r)
	}
	options.InferTypes = true
	r = query(textSQL)
	if *r.Rows[0][0] != "0001" || r.Columns[1].Type != "BIGINT" || *r.Rows[0][1] != "2" {
		t.Fatal("options not rebound", r)
	}
	if err = os.WriteFile(text, []byte("renamed,value,extra\n0002,3,yes\n"), 0600); err != nil {
		t.Fatal(err)
	}
	r = query(textSQL)
	if len(r.Columns) != 3 || r.Columns[0].Name != "renamed" {
		t.Fatal("schema not rebound", r)
	}
	query(q)
	query("SELECT 1")
	if e.workspaceReuse.db != nil {
		t.Fatal("constant query retained old views")
	}
	query(q)
	if _, err = e.QueryWorkspace(context.Background(), req(q), resolve); err != nil {
		t.Fatal(err)
	}
	if e.workspaceReuse.db != nil {
		t.Fatal("unidentified root retained catalog")
	}
	query(q)
	if err = e.Configure(e.resources, func() error { return os.ErrPermission }); err == nil {
		t.Fatal("failed save accepted")
	}
	if e.workspaceReuse.db == nil {
		t.Fatal("failed settings save discarded valid state")
	}
}

func TestWorkspaceReuseBoundaries(t *testing.T) {
	e, root := setup(t)
	root, _ = filepath.EvalSymlinks(root)
	s := workspace.New(t.TempDir())
	if _, err := s.Use(root); err != nil {
		t.Fatal(err)
	}
	resolve := func(ref string) (string, error) { return s.Resolve(root, ref) }
	query := func(sql string, want string) {
		t.Helper()
		r, err := e.QueryWorkspace(context.Background(), req(sql), resolve, root)
		if err != nil || *r.Rows[0][0] != want {
			t.Fatal(sql, r, err)
		}
	}
	q := `SELECT count(*) FROM workspace."orders.parquet"`
	query(q, "240")
	first := e.workspaceReuse.db
	query(q, "240")
	if e.workspaceReuse.db != first {
		t.Fatal("no reuse")
	}
	source, err := os.ReadFile(filepath.Join(root, "orders.parquet"))
	if err != nil {
		t.Fatal(err)
	}
	before := sha256.Sum256(source)
	other := filepath.Join(root, "copy.parquet")
	if err := os.WriteFile(other, source, 0600); err != nil {
		t.Fatal(err)
	}
	both := `SELECT count(*) FROM workspace."orders.parquet" a JOIN workspace."copy.parquet" b USING(order_id)`
	query(both, "240")
	second := e.workspaceReuse.db
	if second == first {
		t.Fatal("reference addition reused")
	}
	query(`SELECT count(*) FROM workspace."copy.parquet" b JOIN workspace."orders.parquet" a USING(order_id)`, "240")
	if e.workspaceReuse.db != second {
		t.Fatal("reference order should be equivalent")
	}
	query(q, "240")
	if e.workspaceReuse.db == second {
		t.Fatal("reference removal reused")
	}
	// An old registered view/path must not survive a reduced reference set.
	for _, sql := range []string{
		q + `; COPY (SELECT 1) TO '` + filepath.Join(root, "injected.csv") + `'`,
		`SELECT * FROM workspace."orders.parquet", read_parquet('` + other + `')`,
		`SELECT * FROM workspace."orders.parquet", query_table('workspace.copy.parquet')`,
		`SELECT * FROM workspace."../outside.parquet"`,
	} {
		if _, err := e.QueryWorkspace(context.Background(), req(sql), resolve, root); err == nil {
			t.Fatal("accepted", sql)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "injected.csv")); !os.IsNotExist(err) {
		t.Fatal("write side effect", err)
	}
	after, _ := os.ReadFile(filepath.Join(root, "orders.parquet"))
	if sha256.Sum256(after) != before {
		t.Fatal("source mutation")
	}
	query(q, "240")
	// Rewrite, replacement, deletion, permission revocation and symlink changes.
	copyQ := `SELECT count(*) FROM workspace."copy.parquet"`
	query(copyQ, "240")
	originalDB := e.workspaceReuse.db
	empty, _ := os.ReadFile(filepath.Join(root, "empty.parquet"))
	if err := os.WriteFile(other, empty, 0600); err != nil {
		t.Fatal(err)
	}
	query(copyQ, "0")
	if e.workspaceReuse.db == originalDB {
		t.Fatal("rewrite reused")
	}
	replacement := filepath.Join(root, "replacement.parquet")
	if err := os.WriteFile(replacement, source, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(replacement, other); err != nil {
		t.Fatal(err)
	}
	query(copyQ, "240")
	t.Run("revoked read permission", func(t *testing.T) {
		testutil.DenyRead(t, other)
		if _, err := e.QueryWorkspace(context.Background(), req(copyQ), resolve, root); err == nil {
			t.Fatal("permission revocation bypassed")
		}
	})
	query(copyQ, "240")
	if err := os.Remove(other); err != nil {
		t.Fatal(err)
	}
	if _, err := e.QueryWorkspace(context.Background(), req(copyQ), resolve, root); err == nil {
		t.Fatal("deleted file reused")
	}
	link := filepath.Join(root, "link.parquet")
	if err := os.Symlink(filepath.Join(root, "orders.parquet"), link); err != nil {
		t.Fatal(err)
	}
	linkQ := `SELECT count(*) FROM workspace."link.parquet"`
	query(linkQ, "240")
	os.Remove(link)
	os.Symlink(filepath.Join(root, "empty.parquet"), link)
	query(linkQ, "0")
	outside := t.TempDir()
	outside, _ = filepath.EvalSymlinks(outside)
	outsideFile := filepath.Join(outside, "orders.parquet")
	os.WriteFile(outsideFile, empty, 0600)
	os.Remove(link)
	os.Symlink(outsideFile, link)
	if _, err := e.QueryWorkspace(context.Background(), req(linkQ), resolve, root); err == nil {
		t.Fatal("symlink escape")
	}
	if _, err := s.Use(outside); err != nil {
		t.Fatal(err)
	}
	if r, err := e.QueryWorkspace(context.Background(), req(q), func(ref string) (string, error) { return s.Resolve(outside, ref) }, outside); err != nil || *r.Rows[0][0] != "0" {
		t.Fatal("root switch", r, err)
	}
	query(q, "240")
	if err := e.Configure(Resources{MemoryMiB: 128, TempGiB: 0, TimeoutSeconds: 30}, nil); err != nil {
		t.Fatal(err)
	}
	if e.workspaceReuse.db != nil {
		t.Fatal("resource change retained database")
	}
	query(q, "240")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := e.QueryWorkspace(ctx, req(q), resolve, root); err == nil {
		t.Fatal("cancel")
	}
	query(q, "240")
	if _, err := e.QueryWorkspace(context.Background(), req(`SELECT missing FROM workspace."orders.parquet"`), resolve, root); err == nil {
		t.Fatal("missing column")
	}
	query(q, "240")
	// Cancel a running native operation, then recover using the same exact set.
	active := make(chan error, 1)
	go func() {
		_, err := e.QueryWorkspace(context.Background(), req(`SELECT sum(i) FROM range(1000000000000) t(i) CROSS JOIN (SELECT count(*) FROM workspace."orders.parquet")`), resolve, root)
		active <- err
	}()
	time.Sleep(20 * time.Millisecond)
	e.Cancel()
	select {
	case err := <-active:
		if err == nil {
			t.Fatal("active cancellation accepted")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancellation did not return")
	}
	query(q, "240")
	e.DiscardWorkspaceReuse()
	if e.workspaceReuse.db != nil {
		t.Fatal("explicit cleanup")
	}
	query(q, "240")
	e.Close()
	if e.workspaceReuse.db != nil {
		t.Fatal("close cleanup")
	}
	t.Log("exact set/order, root, rewrite/replace/delete, permissions, symlinks, SQL/path attacks, source hash, resources, cancel/error recovery and close passed")
}
func TestWorkspaceReuseRealSpill(t *testing.T) {
	e, root := setup(t)
	root, _ = filepath.EvalSymlinks(root)
	s := workspace.New(t.TempDir())
	if _, err := s.Use(root); err != nil {
		t.Fatal(err)
	}
	resolve := func(ref string) (string, error) { return s.Resolve(root, ref) }
	if err := e.Configure(Resources{MemoryMiB: 128, TempGiB: 1, TimeoutSeconds: 60}, nil); err != nil {
		t.Fatal(err)
	}
	q := `SELECT count(*) FROM workspace."orders.parquet"`
	if _, err := e.QueryWorkspace(context.Background(), req(q), resolve, root); err != nil {
		t.Fatal(err)
	}
	dir := e.workspaceReuse.db.tempDir
	// Keep the exact same authorized file set while forcing a real external sort.
	sql := `SELECT sum(rn)::BIGINT FROM (SELECT row_number() OVER (ORDER BY hash(i), repeat(md5(i::VARCHAR),4)) rn FROM range(2000000) t(i)) CROSS JOIN (SELECT count(*) FROM workspace."orders.parquet")`
	done := make(chan error, 1)
	go func() {
		r, err := e.QueryWorkspace(context.Background(), req(sql), resolve, root)
		if err == nil && *r.Rows[0][0] != "2000001000000" {
			t.Error("wrong spill result")
		}
		done <- err
	}()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	observed := false
	for {
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
			if !observed {
				t.Fatal("no nonempty spill observed")
			}
			if _, err := os.Stat(dir); !os.IsNotExist(err) {
				t.Fatal("spill not removed", err)
			}
			if e.workspaceReuse.db != nil {
				t.Fatal("spilled connection retained")
			}
			if _, err := e.QueryWorkspace(context.Background(), req(q), resolve, root); err != nil {
				t.Fatal(err)
			}
			t.Log("real nonempty spill, exact sum, removal and recovery passed")
			return
		case <-ticker.C:
			if !observed {
				observed = observeSpill(t, dir)
			}
		}
	}
}

func TestWorkspaceReuseIdleExpiry(t *testing.T) {
	e, root := setup(t)
	root, _ = filepath.EvalSymlinks(root)
	s := workspace.New(t.TempDir())
	if _, err := s.Use(root); err != nil {
		t.Fatal(err)
	}
	if _, err := e.QueryWorkspace(context.Background(), req(`SELECT count(*) FROM workspace."orders.parquet"`), func(ref string) (string, error) { return s.Resolve(root, ref) }, root); err != nil {
		t.Fatal(err)
	}
	time.Sleep(31 * time.Second)
	e.workspaceReuse.mu.Lock()
	defer e.workspaceReuse.mu.Unlock()
	if e.workspaceReuse.db != nil {
		t.Fatal("idle connection was not released")
	}
}
