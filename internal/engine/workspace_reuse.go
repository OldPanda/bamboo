package engine

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// workspaceReuse owns at most one idle catalog. Engine.gate serializes leases;
// the mutex protects expiry, which can run independently of an engine operation.
// Fingerprints detect changes between queries, not concurrent-write snapshots.
type workspaceReuse struct {
	mu    sync.Mutex
	key   string
	db    *database
	timer *time.Timer
	epoch uint64
}

func (c *workspaceReuse) clear() {
	c.epoch++
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	if c.db != nil {
		c.db.Close()
		c.db = nil
	}
	c.key = ""
}
func (c *workspaceReuse) close() { c.mu.Lock(); defer c.mu.Unlock(); c.clear() }
func (c *workspaceReuse) take(key string) *database {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.epoch++
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	if c.db != nil && c.db.tempDir != "" {
		free, err := c.db.diskFree(c.db.tempDir)
		if err != nil || free < c.db.tempBytes+diskReserve {
			c.clear()
			return nil
		}
	}
	if key == "" || key != c.key {
		c.clear()
		return nil
	}
	db := c.db
	c.db = nil // An idle timer must never close a leased database.
	return db
}
func (c *workspaceReuse) put(key string, db *database) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.clear()
	c.key, c.db = key, db
	epoch := c.epoch
	c.timer = time.AfterFunc(30*time.Second, func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.epoch == epoch {
			c.clear()
		}
	})
}

func (e *Engine) reuseKey(refs, paths []string) (string, error) {
	if e.workspaceReuse == nil || e.workspaceRoot == "" || e.file != nil || len(refs) == 0 {
		return "", nil
	}
	entries := []string{e.workspaceRoot, fmt.Sprint(e.resources)}
	files := make([]string, 0, len(paths))
	for i, path := range paths {
		// Text inference/options are intentionally rebound on each query.
		if !strings.EqualFold(filepath.Ext(path), ".parquet") {
			return "", nil
		}
		f, err := os.Open(path) // Recheck read access even when DuckDB holds a handle.
		if err != nil {
			return "", err
		}
		st, statErr := f.Stat()
		identity, reliable := localIdentity(f, st)
		closeErr := f.Close()
		if statErr != nil {
			return "", statErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		if !st.Mode().IsRegular() || !reliable {
			return "", nil
		}
		b, _ := json.Marshal([]any{refs[i], path, st.Size(), st.ModTime().UnixNano(), st.Mode(), identity})
		files = append(files, string(b))
	}
	sort.Strings(files)
	entries = append(entries, files...)
	b, _ := json.Marshal(entries)
	return string(b), nil
}

func (e *Engine) releaseWorkspace(db *database, key string, refs, paths []string) {
	// A failed/spilling query already closes e.db. Recheck identity so a file
	// changed while the query ran cannot seed the next query's retained catalog.
	if e.db == db {
		next, err := e.reuseKey(refs, paths)
		if err == nil && next == key {
			e.workspaceReuse.put(key, db)
			return
		}
	}
	db.Close()
}

// DiscardWorkspaceReuse releases the idle local catalog after workspace closure.
// It waits for any active operation to finish; Workbench serializes callers.
func (e *Engine) DiscardWorkspaceReuse() {
	e.gate <- struct{}{}
	defer func() { <-e.gate }()
	if e.workspaceReuse != nil {
		e.workspaceReuse.close()
	}
}
