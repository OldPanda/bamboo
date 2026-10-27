package engine

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path"
	"strings"
)

const HTTPFSSHA256 = "c2d72a98ad081bf4d62c908b8d9f60b70ab1b83faa9141fc7e7d53526658761d"

type RemoteScope struct {
	Paths []string
	Sizes []int64
	Close func()
	Error func() error
}
type RemoteResolver func(context.Context, []string) (*RemoteScope, error)

// SetHTTPFS configures a packaged, signed and hash-pinned extension; it grants no
// URL access. Local-only queries do not load this extension.
func (e *Engine) SetHTTPFS(p string) { e.httpfs = p }
func remoteDatabase(ctx context.Context, paths []string, extension string) (*sql.DB, error) {
	b, err := os.ReadFile(extension)
	if err != nil {
		return nil, errors.New("Cloud reader is not installed; rebuild Bamboo with scripts/build.sh")
	}
	if fmt.Sprintf("%x", sha256.Sum256(b)) != HTTPFSSHA256 {
		return nil, errors.New("Cloud reader integrity check failed")
	}
	db, err := sql.Open("duckdb", "?threads=2&memory_limit=256MB&max_temp_directory_size=0B&autoload_known_extensions=false&autoinstall_known_extensions=false")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	quoted := make([]string, len(paths))
	for i, p := range paths {
		quoted[i] = literal(p)
	}
	for _, q := range []string{"LOAD " + literal(extension), "SET allow_persistent_secrets=false", "SET http_timeout=15", "SET http_retries=0", "SET TimeZone='UTC'", "SET allowed_paths=[" + strings.Join(quoted, ",") + "]", "SET enable_external_access=false", "SET lock_configuration=true"} {
		if _, err = db.ExecContext(ctx, q); err != nil {
			db.Close()
			return nil, err
		}
	}
	return db, nil
}
func (e *Engine) OpenRemote(parent context.Context, displayPath, ref string, resolve RemoteResolver) (*File, error) {
	ctx, done, err := e.start(parent)
	if err != nil {
		return nil, err
	}
	defer done()
	scope, err := resolve(ctx, []string{ref})
	if err != nil {
		return nil, err
	}
	defer scope.Close()
	db, err := remoteDatabase(ctx, scope.Paths, e.httpfs)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if err = createView(ctx, db, "data", scope.Paths[0]); err != nil {
		return nil, remoteError(scope, err)
	}
	cols, err := describe(ctx, db, "SELECT * FROM data")
	if err != nil {
		return nil, remoteError(scope, err)
	}
	f := &File{Name: path.Base(ref), Path: displayPath, Bytes: fmt.Sprint(scope.Sizes[0]), Columns: cols}
	err = db.QueryRowContext(ctx, "SELECT num_rows::VARCHAR, num_row_groups::VARCHAR FROM parquet_file_metadata(?)", scope.Paths[0]).Scan(&f.Rows, &f.RowGroups)
	if err != nil {
		return nil, remoteError(scope, err)
	}
	if e.db != nil {
		e.db.Close()
	}
	e.db = nil
	e.resolve = nil
	e.remote = resolve
	e.remoteRef = ref
	e.file = f
	return f, nil
}
func remoteError(scope *RemoteScope, err error) error {
	if e := scope.Error(); e != nil {
		return e
	}
	if err == nil {
		return nil
	}
	s := err.Error()
	for _, p := range scope.Paths {
		s = strings.ReplaceAll(s, p, "[cloud object]")
	}
	return errors.New(s)
}
func (e *Engine) QueryRemoteWorkspace(parent context.Context, r Request, resolve RemoteResolver) (*Result, error) {
	ctx, done, err := e.start(parent)
	if err != nil {
		return nil, err
	}
	defer done()
	scoped := &Engine{remote: resolve, httpfs: e.httpfs}
	return scoped.run(ctx, r)
}
func (e *Engine) remoteDatabaseForQuery(ctx context.Context, refs []string) (*sql.DB, func(), error) {
	all := append([]string{}, refs...)
	offset := 0
	if e.remoteRef != "" {
		all = append([]string{e.remoteRef}, all...)
		offset = 1
	}
	scope, err := e.remote(ctx, all)
	if err != nil {
		return nil, nil, err
	}
	db, err := remoteDatabase(ctx, scope.Paths, e.httpfs)
	if err != nil {
		scope.Close()
		return nil, nil, err
	}
	cleanup := func() { db.Close(); scope.Close() }
	if offset == 1 {
		err = createView(ctx, db, "data", scope.Paths[0])
	}
	if err == nil {
		_, err = db.ExecContext(ctx, "CREATE SCHEMA workspace")
	}
	for i, ref := range refs {
		if err != nil {
			break
		}
		err = createView(ctx, db, "workspace."+ident(ref), scope.Paths[offset+i])
	}
	if err != nil {
		err = remoteError(scope, err)
		cleanup()
		return nil, nil, err
	}
	e.remoteScope = scope
	return db, func() { cleanup(); e.remoteScope = nil }, nil
}
