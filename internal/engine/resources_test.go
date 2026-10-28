package engine

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestResourceConfiguration(t *testing.T) {
	e, _ := setup(t)
	old := e.db
	r := DefaultResources()
	r.MemoryMiB = 128
	r.MemoryAuto = false
	if err := e.Configure(r, func() error { return errors.New("save failed") }); err == nil || e.db != old {
		t.Fatal("failed save changed reader")
	}
	_, done, err := e.start(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err = e.Configure(r, nil); err == nil {
		t.Fatal("changed busy reader")
	}
	done()
	if err = e.Configure(r, nil); err != nil {
		t.Fatal(err)
	}
	if _, err = e.Query(context.Background(), req("SELECT count(*) FROM data")); err != nil {
		t.Fatal("file lost", err)
	}
	var memory string
	if err = e.db.QueryRow("SELECT current_setting('memory_limit')").Scan(&memory); err != nil || memory != "128.0 MiB" {
		t.Fatal(memory, err)
	}
	ctx, finish, err := e.start(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	deadline, _ := ctx.Deadline()
	if time.Until(deadline) < 299*time.Second {
		t.Fatal("query timeout")
	}
	finish()
	for _, bad := range []Resources{{MemoryMiB: 0, TempGiB: 4, TimeoutSeconds: 300}, {MemoryMiB: CurrentMemoryLimits().MaxMemoryMiB + 1, TempGiB: 4, TimeoutSeconds: 300}, {MemoryMiB: 256, TempGiB: -1, TimeoutSeconds: 300}, {MemoryMiB: 256, TempGiB: int(1 << 33), TimeoutSeconds: 300}, {MemoryMiB: 256, TempGiB: 4, TimeoutSeconds: 0}, {MemoryMiB: 256, TempGiB: 4, TimeoutSeconds: 3601}} {
		if bad.Validate() == nil {
			t.Fatal(bad)
		}
	}
	if spillAllowance(4<<30, 2<<30) != 1<<30 || spillAllowance(4<<30, 512<<20) != 0 {
		t.Fatal("reserve")
	}
}
func TestDiskSpillAndRecovery(t *testing.T) {
	e, _ := setup(t)
	// The minimum supported memory forces external sorting with this workload.
	e.db.Close()
	e.db = nil
	e.resources = Resources{MemoryMiB: 128, TempGiB: 1, TimeoutSeconds: 60}
	spillQuery := "SELECT sum(rn)::BIGINT FROM (SELECT row_number() OVER (ORDER BY hash(i), repeat(md5(i::VARCHAR), 4)) rn FROM range(2000000) t(i))"
	if _, err := e.Query(context.Background(), req("SELECT 1")); err != nil {
		t.Fatal(err)
	}
	dir := e.db.tempDir
	stat, err := os.Stat(dir)
	if err != nil || stat.Mode().Perm() != 0700 {
		t.Fatal("private directory", err)
	}
	result := make(chan error, 1)
	go func() {
		r, err := e.Query(context.Background(), req(spillQuery))
		if err == nil && *r.Rows[0][0] != "2000001000000" {
			err = errors.New("incorrect external sort result")
		}
		result <- err
	}()
	observed := false
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	running := true
	for running {
		select {
		case err := <-result:
			if err != nil {
				t.Fatal(err)
			}
			running = false
		case <-ticker.C:
			entries, _ := os.ReadDir(dir)
			for _, entry := range entries {
				info, _ := entry.Info()
				if info != nil && info.Size() > 0 {
					observed = true
				}
			}
		}
	}
	if !observed {
		t.Fatal("test did not observe actual disk spill")
	}
	if _, err = os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("spill directory not cleaned after query", err)
	}
	if _, err = e.Query(context.Background(), req("SELECT count(*) FROM data")); err != nil {
		t.Fatal("recovery", err)
	}
	t.Log("forced 128 MiB query spilled to disk, exact result verified, directory removed")
	// DuckDB adds its own scratch directory to its allowlist. This directory is
	// private and emptied after spills; it must not grant access to its parent.
	secret := filepath.Join(filepath.Dir(e.db.tempDir), filepath.Base(e.db.tempDir)+"-outside.txt")
	if err = os.WriteFile(secret, []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(secret)
	escape := e.db.tempDir + "/../" + filepath.Base(secret)
	if _, err = e.Query(context.Background(), req("SELECT * FROM read_text("+literal(escape)+")")); err == nil {
		t.Fatal("temporary directory traversal permitted")
	}
	e.resources.TempGiB = 0
	if _, err = e.Query(context.Background(), req("SELECT sum(rn) FROM (SELECT row_number() OVER (ORDER BY hash(i)) rn FROM range(100000000) t(i))")); err == nil {
		t.Fatal("oversized query unexpectedly fits without spill")
	}
	if _, err = e.Query(context.Background(), req("SELECT 42")); err != nil {
		t.Fatal("recovery after quota failure", err)
	}
}
func TestSpillCancellation(t *testing.T) {
	e, _ := setup(t)
	e.db.Close()
	e.db = nil
	e.resources = Resources{MemoryMiB: 128, TempGiB: 1, TimeoutSeconds: 60}
	if _, err := e.Query(context.Background(), req("SELECT 1")); err != nil {
		t.Fatal(err)
	}
	dir := e.db.tempDir
	result := make(chan error, 1)
	go func() {
		_, err := e.Query(context.Background(), req("SELECT sum(rn) FROM (SELECT row_number() OVER (ORDER BY hash(i)) rn FROM range(100000000) t(i))"))
		result <- err
	}()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		entries, _ := os.ReadDir(dir)
		if len(entries) > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	e.Cancel()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("cancel succeeded")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancel did not finish")
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("canceled spill not removed", err)
	}
	if _, err := e.Query(context.Background(), req("SELECT 42")); err != nil {
		t.Fatal(err)
	}
	// Parent deadlines must still override the longer query deadline.
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	_, err := e.Query(ctx, req("SELECT sum(a.i*b.i) FROM range(100000) a(i), range(100000) b(i)"))
	if err == nil {
		t.Fatal("deadline ignored")
	}
}
func TestResourceDefaults(t *testing.T) {
	r := DefaultResources()
	if err := r.Validate(); err != nil {
		t.Fatal(err)
	}
	db, err := openDatabase(context.Background(), nil, Resources{MemoryMiB: 128, TempGiB: 0, TimeoutSeconds: 30})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var got string
	db.QueryRow("SELECT current_setting('max_temp_directory_size')").Scan(&got)
	if !strings.Contains(got, "0 bytes") {
		t.Fatal(got)
	}
}

func TestLowDiskGuard(t *testing.T) {
	db, err := newDatabase(context.Background(), Resources{MemoryMiB: 128, TempGiB: 1, TimeoutSeconds: 30})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	dir := db.tempDir
	if err = os.WriteFile(filepath.Join(dir, "synthetic-spill"), []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	db.diskFree = func(string) (int64, error) { return diskReserve - 1, nil }
	ctx, stop := db.watchDisk(context.Background())
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("disk guard did not cancel")
	}
	if err = stop(); err == nil || !strings.Contains(err.Error(), "free disk") {
		t.Fatal(err)
	}
	db.Close()
	if _, err = os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("cleanup", err)
	}
}
func TestWorkspaceResourceBudget(t *testing.T) {
	e, dir := setup(t)
	if err := e.Configure(Resources{MemoryMiB: 128, TempGiB: 0, TimeoutSeconds: 30}, nil); err != nil {
		t.Fatal(err)
	}
	result, err := e.QueryWorkspace(context.Background(), req(`SELECT count(*), current_setting('memory_limit'), current_setting('max_temp_directory_size') FROM workspace."orders.parquet"`), func(name string) (string, error) { return filepath.Join(dir, name), nil })
	if err != nil {
		t.Fatal(err)
	}
	if *result.Rows[0][0] != "240" || *result.Rows[0][1] != "128.0 MiB" || *result.Rows[0][2] != "0 bytes" {
		t.Fatal(result.Rows)
	}
}

func TestSpillJoinAndGroup(t *testing.T) {
	for _, tc := range []struct{ name, sql string }{
		{"join", `SELECT count(*) FROM (SELECT repeat(md5(i::VARCHAR),4) k FROM range(2000000) t(i)) a JOIN (SELECT repeat(md5(i::VARCHAR),4) k FROM range(2000000) t(i)) b USING(k)`},
		{"group", `SELECT sum(n)::BIGINT FROM (SELECT md5(i::VARCHAR) k,count(*) n FROM range(2000000) t(i) GROUP BY k)`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e, _ := setup(t)
			if err := e.Configure(Resources{MemoryMiB: 128, TempGiB: 1, TimeoutSeconds: 60}, nil); err != nil {
				t.Fatal(err)
			}
			if _, err := e.Query(context.Background(), req("SELECT 1")); err != nil {
				t.Fatal(err)
			}
			dir := e.db.tempDir
			result := make(chan error, 1)
			go func() {
				r, err := e.Query(context.Background(), req(tc.sql))
				if err == nil && *r.Rows[0][0] != "2000000" {
					err = errors.New("wrong result")
				}
				result <- err
			}()
			observed := false
			ticker := time.NewTicker(time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case err := <-result:
					if err != nil {
						t.Fatal(err)
					}
					if !observed {
						t.Fatal("no spill observed")
					}
					if _, err = os.Stat(dir); !os.IsNotExist(err) {
						t.Fatal("spill not cleaned", err)
					}
					t.Log("real spill observed; exact result and cleanup verified")
					return
				case <-ticker.C:
					entries, _ := os.ReadDir(dir)
					for _, entry := range entries {
						info, _ := entry.Info()
						if info != nil && info.Size() > 0 {
							observed = true
						}
					}
				}
			}
		})
	}
}

func TestTemporaryDiskQuota(t *testing.T) {
	db, err := newDatabase(context.Background(), Resources{MemoryMiB: 128, TempGiB: 1, TimeoutSeconds: 30})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	dir := db.tempDir
	if _, err = db.Exec("SET max_temp_directory_size='1MiB'"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var value string
	err = db.QueryRowContext(ctx, `SELECT sum(rn)::VARCHAR FROM (SELECT row_number() OVER (ORDER BY hash(i),repeat(md5(i::VARCHAR),4)) rn FROM range(2000000) t(i))`).Scan(&value)
	if err == nil || !strings.Contains(err.Error(), "max_temp_directory_size") {
		t.Fatal("disk quota was not enforced", err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("quota failure cleanup", err)
	}
}
