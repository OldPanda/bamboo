package engine

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"sync"
	"syscall"
	"time"
)

// Resources budgets DuckDB, not the entire process (UI and network caches are separate).
type Resources struct {
	MemoryMiB      int  `json:"memoryMiB"`
	MemoryAuto     bool `json:"memoryAuto"`
	TempGiB        int  `json:"tempGiB"`
	TempAuto       bool `json:"tempAuto"`
	TimeoutSeconds int  `json:"timeoutSeconds"`
}

// DefaultResources returns automatic memory, bounded spill and query timeout defaults.
func DefaultResources() Resources {
	return Resources{MemoryMiB: 256, MemoryAuto: true, TempGiB: 4, TempAuto: true, TimeoutSeconds: 300}
}

// Validate rejects unsupported modes and out-of-range query resource limits.
func (r Resources) Validate() error {
	return r.validateMemory(CurrentMemoryLimits())
}
func (r Resources) validateMemory(limits MemoryLimits) error {
	if !r.MemoryAuto && (r.MemoryMiB < 128 || r.MemoryMiB > limits.MaxMemoryMiB) {
		return errors.New("query memory must be at least 128 MiB and no greater than physical memory")
	}
	if r.TempGiB < 0 || int64(r.TempGiB) > (int64(1<<63-1)>>30) {
		return errors.New("temporary disk limit must be a non-negative supported GiB value")
	}
	if r.TimeoutSeconds < 15 || r.TimeoutSeconds > 3600 {
		return errors.New("query timeout must be between 15 and 3600 seconds")
	}
	return nil
}

// Configure serializes persistence with operations; failed saves leave the reader intact.
func (e *Engine) Configure(r Resources, save func() error) error {
	if err := r.Validate(); err != nil {
		return err
	}
	select {
	case e.gate <- struct{}{}:
	default:
		return errors.New("another operation is running; cancel it or wait")
	}
	defer func() { <-e.gate }()
	if save != nil {
		if err := save(); err != nil {
			return err
		}
	}
	if e.db != nil {
		e.db.Close()
		e.db = nil
	}
	e.resources = r
	return nil
}

const diskReserve = int64(1 << 30)

func availableDisk(path string) (int64, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, err
	}
	return int64(st.Bavail) * int64(st.Bsize), nil
}
func spillAllowance(requested, available int64) int64 {
	return max(0, min(requested, available-diskReserve))
}

// database owns its private spill directory. DuckDB permits internal scratch
// access when external access is disabled; never put source/config files here.
type database struct {
	diskFree func(string) (int64, error)
	*sql.DB
	tempDir   string
	tempBytes int64
	closeOnce sync.Once
	closeErr  error
}

func (db *database) Close() error {
	db.closeOnce.Do(func() {
		db.closeErr = db.DB.Close()
		if db.tempDir != "" {
			if err := os.RemoveAll(db.tempDir); db.closeErr == nil {
				db.closeErr = err
			}
		}
	})
	return db.closeErr
}
func (db *database) hasSpill() bool {
	if db.tempDir == "" {
		return false
	}
	entries, err := os.ReadDir(db.tempDir)
	return err != nil || len(entries) > 0
}
func newDatabase(ctx context.Context, configs ...Resources) (*database, error) {
	r := DefaultResources()
	if len(configs) > 0 {
		r = configs[0]
	}
	limits := CurrentMemoryLimits()
	if err := r.validateMemory(limits); err != nil {
		return nil, err
	}
	raw, err := sql.Open("duckdb", fmt.Sprintf("?threads=2&memory_limit=%dMiB&max_temp_directory_size=0B&autoload_known_extensions=false&autoinstall_known_extensions=false", r.memoryBudget(limits)))
	if err != nil {
		return nil, err
	}
	db := &database{DB: raw, diskFree: availableDisk}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	fail := func(err error) (*database, error) { db.Close(); return nil, err }
	if r.TempAuto || r.TempGiB > 0 {
		dir, err := os.MkdirTemp("", "bamboo-query-*")
		if err != nil {
			return fail(err)
		}
		db.tempDir = dir
		free, err := availableDisk(dir)
		if err != nil {
			if !r.TempAuto {
				return fail(err)
			}
			free = 0
		}
		db.tempBytes = r.diskBudget(free)
		for _, q := range []string{"SET temp_directory=" + literal(dir), fmt.Sprintf("SET max_temp_directory_size='%dB'", db.tempBytes)} {
			if _, err = db.ExecContext(ctx, q); err != nil {
				return fail(err)
			}
		}
	}
	if !r.TempAuto && r.TempGiB == 0 {
		if _, err = db.ExecContext(ctx, "SET temp_directory=''"); err != nil {
			return fail(err)
		}
	}
	return db, nil
}

// Recheck free space during a spilling query. The reserve is best effort against
// other applications writing concurrently; DuckDB also enforces its fixed quota.
func (db *database) watchDisk(parent context.Context) (context.Context, func() error) {
	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	var failure error
	if db.tempDir == "" || db.tempBytes == 0 {
		close(done)
	} else {
		go func() {
			defer close(done)
			timer := time.NewTicker(100 * time.Millisecond)
			defer timer.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-timer.C:
					if !db.hasSpill() {
						continue
					}
					free, err := db.diskFree(db.tempDir)
					if err != nil || free < diskReserve {
						failure = errors.New("query stopped to preserve free disk space")
						cancel()
						return
					}
				}
			}
		}()
	}
	return ctx, func() error { cancel(); <-done; return failure }
}
