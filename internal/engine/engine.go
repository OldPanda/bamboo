// Package engine provides bounded, read-only queries over local and scoped cloud Parquet data.
package engine

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "github.com/duckdb/duckdb-go/v2"
)

// MaxPage limits the number of rows returned by one preview.
const MaxPage = 500

// MaxColumns limits the columns exposed by a file or query result.
const MaxColumns = 256

// MaxCell limits the byte length of a rendered cell value.
const MaxCell = 64 * 1024

// MaxResult limits the aggregate byte size of rendered query values.
const MaxResult = 4 * 1024 * 1024

// Timeout bounds metadata operations; query timeouts use Resources instead.
const Timeout = 15 * time.Second

// Column describes a result column and its DuckDB type.
type Column struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// File contains Parquet metadata; large counts use strings to preserve precision in JavaScript.
type File struct {
	Name      string   `json:"name"`
	Path      string   `json:"path"`
	Bytes     string   `json:"bytes"`
	Rows      string   `json:"rows"`
	RowGroups string   `json:"rowGroups"`
	Columns   []Column `json:"columns"`
}

// Request specifies a read-only query, page, sort and optional text filter.
type Request struct {
	SQL          string `json:"sql"`
	Offset       int    `json:"offset"`
	Limit        int    `json:"limit"`
	Sort         string `json:"sort"`
	Desc         bool   `json:"desc"`
	FilterColumn string `json:"filterColumn"`
	FilterValue  string `json:"filterValue"`
}

// Result contains one bounded page; nil cell pointers represent SQL NULL.
type Result struct {
	Columns   []Column    `json:"columns"`
	Rows      [][]*string `json:"rows"`
	More      bool        `json:"more"`
	Offset    int         `json:"offset"`
	ElapsedMS int64       `json:"elapsedMS"`
}

// Engine has one active operation and a separately cancellable context.
type Engine struct {
	gate         chan struct{}
	mu           sync.Mutex
	cancel       context.CancelFunc
	db           *database
	resources    Resources
	file         *File
	resolve      func(string) (string, error)
	httpfs       string
	remote       RemoteResolver
	remoteRef    string
	remoteScope  *RemoteScope
	remoteKeep   *RemoteScope
	remoteCancel context.CancelFunc
}

// New creates an idle engine with default resource budgets.
func New() *Engine { return &Engine{gate: make(chan struct{}, 1), resources: DefaultResources()} }
func (e *Engine) start(parent context.Context, query ...bool) (context.Context, func(), error) {
	select {
	case e.gate <- struct{}{}:
	default:
		return nil, nil, errors.New("another operation is running; cancel it or wait")
	}
	timeout := Timeout
	if len(query) > 0 && query[0] {
		timeout = time.Duration(e.resources.TimeoutSeconds) * time.Second
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	e.mu.Lock()
	e.cancel = cancel
	e.mu.Unlock()
	return ctx, func() { e.mu.Lock(); e.cancel = nil; e.mu.Unlock(); cancel(); <-e.gate }, nil
}

// Cancel interrupts the active operation, if any.
func (e *Engine) Cancel() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cancel != nil {
		e.cancel()
	}
}
func (e *Engine) dropKept() {
	if e.remoteCancel != nil {
		e.remoteCancel()
		e.remoteCancel = nil
	}
	if e.remoteKeep != nil {
		if e.remoteScope == e.remoteKeep {
			e.remoteScope = nil
		}
		e.remoteKeep.Close()
		e.remoteKeep = nil
	}
	if e.db != nil {
		e.db.Close()
		e.db = nil
	}
}

// Close cancels active work and releases the current reader and remote scope.
func (e *Engine) Close() {
	e.Cancel()
	e.gate <- struct{}{}
	defer func() { <-e.gate }()
	e.dropKept()
	e.file = nil
	e.resolve = nil
	e.remote = nil
	e.remoteRef = ""
}
func literal(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
func ident(s string) string   { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }

// Open opens a local Parquet reader and returns its metadata.
func (e *Engine) Open(parent context.Context, path string) (*File, error) {
	return e.OpenScoped(parent, path, nil)
}

// OpenScoped installs a resolver tied to an explicitly opened workspace.
// It is called for every referenced file on every query, including pagination.
func (e *Engine) OpenScoped(parent context.Context, path string, resolve func(string) (string, error)) (*File, error) {
	ctx, done, err := e.start(parent)
	if err != nil {
		return nil, err
	}
	defer done()
	if !filepath.IsAbs(path) {
		return nil, errors.New("choose an absolute local file path")
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		return nil, err
	}
	if strings.ContainsAny(path, "*?[]\x00") {
		return nil, errors.New("file paths containing glob characters are not supported")
	}
	if strings.ToLower(filepath.Ext(path)) != ".parquet" {
		return nil, errors.New("choose a .parquet file")
	}
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if !st.Mode().IsRegular() {
		return nil, errors.New("choose a regular Parquet file")
	}
	db, err := openDatabase(ctx, []string{path}, e.resources)
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			db.Close()
		}
	}()
	if err = createView(ctx, db, "data", path); err != nil {
		return nil, err
	}
	cols, err := describe(ctx, db, "SELECT * FROM data")
	if err != nil {
		return nil, err
	}
	f := &File{Name: filepath.Base(path), Path: path, Bytes: fmt.Sprint(st.Size()), Columns: cols}
	err = db.QueryRowContext(ctx, "SELECT num_rows::VARCHAR, num_row_groups::VARCHAR FROM parquet_file_metadata(?)", path).Scan(&f.Rows, &f.RowGroups)
	if err != nil {
		return nil, err
	}
	e.dropKept()
	e.db = db
	e.file = f
	e.resolve = resolve
	e.remote = nil
	e.remoteRef = ""
	ok = true
	return f, nil
}
func describe(ctx context.Context, db *database, q string) ([]Column, error) {
	rows, err := db.QueryContext(ctx, "DESCRIBE SELECT * FROM ("+q+"\n) AS bamboo_schema")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Column{}
	for rows.Next() {
		var c Column
		var a, b, d, f any
		if err = rows.Scan(&c.Name, &c.Type, &a, &b, &d, &f); err != nil {
			return nil, err
		}
		out = append(out, c)
		if len(out) > MaxColumns {
			return nil, errors.New("this version supports up to 256 columns")
		}
	}
	return out, rows.Err()
}
func query(r Request) (string, []any, error) {
	if r.Limit < 1 || r.Limit > MaxPage || r.Offset < 0 || r.Offset > 1000000000 {
		return "", nil, errors.New("page bounds exceeded (1–500 rows, offset up to 1 billion)")
	}
	if len(r.SQL) > 32768 || len(r.FilterValue) > 4096 {
		return "", nil, errors.New("query or filter is too long")
	}
	q, err := selectSQL(r.SQL)
	if err != nil {
		return "", nil, err
	}
	// The supplied text is always a subquery, never a top-level SQL command.
	// A second statement, COPY, ATTACH, SET, INSTALL, DDL or DML cannot parse here.
	q = "SELECT * FROM (" + q + "\n) AS bamboo_source"
	args := []any{}
	if r.FilterColumn != "" {
		q += " WHERE contains(CAST(" + ident(r.FilterColumn) + " AS VARCHAR), ?)"
		args = append(args, r.FilterValue)
	}
	if r.Sort != "" {
		q += " ORDER BY " + ident(r.Sort)
		if r.Desc {
			q += " DESC"
		}
		q += " NULLS LAST"
	}
	return q, args, nil
}

// Query executes a bounded read-only preview against the current file.
func (e *Engine) Query(parent context.Context, r Request) (*Result, error) {
	ctx, done, err := e.start(parent, true)
	if err != nil {
		return nil, err
	}
	defer done()
	return e.run(ctx, r)
}

// QueryWorkspace queries an explicitly selected folder without opening a document.
func (e *Engine) QueryWorkspace(parent context.Context, r Request, resolve func(string) (string, error)) (*Result, error) {
	ctx, done, err := e.start(parent, true)
	if err != nil {
		return nil, err
	}
	defer done()
	scoped := &Engine{resolve: resolve, resources: e.resources}
	return scoped.run(ctx, r)
}
func (e *Engine) run(ctx context.Context, r Request) (output *Result, failure error) {
	if e.file == nil && e.db == nil && e.resolve == nil && e.remote == nil {
		return nil, errors.New("open a Parquet file first")
	}
	started := time.Now()
	q, args, err := query(r)
	if err != nil {
		return nil, err
	}
	db, cleanup, err := e.queryDatabase(ctx, r.SQL)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	if err := validateSelect(ctx, db, q); err != nil {
		return nil, err
	}
	ctx, stopDisk := db.watchDisk(ctx)
	defer func() {
		if err := stopDisk(); err != nil {
			output = nil
			failure = err
		}
		// Close after rows are released, before deleting spill files. Preserve cloud
		// range caches and file identity; the next query recreates only the database.
		if db == e.db && (db.hasSpill() || failure != nil) {
			db.Close()
			e.db = nil
		}
	}()
	defer func() {
		if e.remoteScope != nil {
			failure = remoteError(e.remoteScope, failure)
		}
	}()
	// Describe the unfiltered source to avoid binding filter values twice.
	base := r
	base.FilterColumn = ""
	base.Sort = ""
	bq, _, _ := query(base)
	cols, err := describe(ctx, db, bq)
	if err != nil {
		return nil, err
	}
	names := map[string]bool{}
	for _, c := range cols {
		names[c.Name] = true
	}
	if (r.Sort != "" && !names[r.Sort]) || (r.FilterColumn != "" && !names[r.FilterColumn]) {
		return nil, errors.New("unknown sort or filter column")
	}
	// DuckDB formats values before IPC: decimals, nested types and nanosecond
	// timestamps never round-trip through float64 or JavaScript numbers.
	rows, err := db.QueryContext(ctx, fmt.Sprintf("SELECT CAST(COLUMNS(*) AS VARCHAR) FROM (%s\n) AS bamboo_page LIMIT %d OFFSET %d", q, r.Limit+1, r.Offset), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &Result{Columns: cols, Rows: [][]*string{}, Offset: r.Offset}
	size := 0
	for rows.Next() {
		if len(out.Rows) == r.Limit {
			out.More = true
			break
		}
		values := make([]sql.NullString, len(cols))
		dest := make([]any, len(cols))
		for i := range values {
			dest[i] = &values[i]
		}
		if err = rows.Scan(dest...); err != nil {
			return nil, err
		}
		row := make([]*string, len(cols))
		for i, v := range values {
			if v.Valid {
				if len(v.String) > MaxCell {
					return nil, errors.New("cell exceeds 64 KiB; select a substring or fewer columns in SQL")
				}
				s := v.String
				row[i] = &s
				size += len(s)
			}
		}
		if size > MaxResult {
			return nil, errors.New("page exceeds 4 MiB; select fewer columns or a smaller page")
		}
		out.Rows = append(out.Rows, row)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	out.ElapsedMS = time.Since(started).Milliseconds()
	return out, nil
}
