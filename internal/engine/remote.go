package engine

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path"
	"strings"
	"sync"
)

// HTTPFSSHA256 pins the packaged HTTPFS extension used for remote reads.
const HTTPFSSHA256 = "c2d72a98ad081bf4d62c908b8d9f60b70ab1b83faa9141fc7e7d53526658761d"

// RemoteScope owns allowlisted loopback URLs and their sizes; callers must invoke Close.
type RemoteScope struct {
	Paths []string
	Sizes []int64
	Close func()
	Error func() error
}

// RemoteResolver resolves workspace-relative references into a scoped read gateway.
type RemoteResolver func(context.Context, []string) (*RemoteScope, error)

// SetHTTPFS configures a packaged, signed and hash-pinned extension; it grants no
// URL access. Local-only queries do not load this extension.
func (e *Engine) SetHTTPFS(p string) { e.httpfs = p }

var (
	httpfsMu sync.Mutex
	httpfsOK = map[string]struct{}{}
)

func verifyHTTPFS(extension string) error {
	httpfsMu.Lock()
	_, ok := httpfsOK[extension]
	httpfsMu.Unlock()
	if ok {
		return nil
	}
	b, err := os.ReadFile(extension)
	if err != nil {
		return errors.New("Cloud reader is not installed; rebuild Bamboo with scripts/build.sh")
	}
	if fmt.Sprintf("%x", sha256.Sum256(b)) != HTTPFSSHA256 {
		return errors.New("Cloud reader integrity check failed")
	}
	httpfsMu.Lock()
	httpfsOK[extension] = struct{}{}
	httpfsMu.Unlock()
	return nil
}
func remoteDatabase(ctx context.Context, paths []string, extension string, configs ...Resources) (*database, error) {
	if err := verifyHTTPFS(extension); err != nil {
		return nil, err
	}
	db, err := newDatabase(ctx, configs...)
	if err != nil {
		return nil, err
	}
	quoted := make([]string, len(paths))
	for i, p := range paths {
		quoted[i] = literal(p)
	}
	for _, q := range []string{"LOAD " + literal(extension), "SET allow_persistent_secrets=false", "SET http_timeout=15", "SET http_retries=0", "SET enable_object_cache=true", "SET TimeZone='UTC'", "SET allowed_paths=[" + strings.Join(quoted, ",") + "]", "SET allowed_directories=[]", "SET enable_external_access=false", "SET lock_configuration=true"} {
		if _, err = db.ExecContext(ctx, q); err != nil {
			db.Close()
			return nil, err
		}
	}
	return db, nil
}

// OpenRemote opens a remote Parquet reader and retains its scope for subsequent previews.
func (e *Engine) OpenRemote(parent context.Context, displayPath, ref string, resolve RemoteResolver) (*File, error) {
	ctx, done, err := e.start(parent)
	if err != nil {
		return nil, err
	}
	defer done()
	// The preview and later pages reuse this reader. Its gateway must outlive
	// the open call, and closes when another file is opened or the engine closes.
	keepCtx, keepCancel := context.WithCancel(context.Background())
	scope, err := resolve(keepCtx, []string{ref})
	if err != nil {
		keepCancel()
		return nil, err
	}
	db, err := remoteDatabase(ctx, scope.Paths, e.httpfs, e.resources)
	if err != nil {
		scope.Close()
		keepCancel()
		return nil, err
	}
	fail := func(err error) (*File, error) {
		db.Close()
		scope.Close()
		keepCancel()
		return nil, remoteError(scope, err)
	}
	if err = createView(ctx, db, "data", scope.Paths[0]); err != nil {
		return fail(err)
	}
	cols, err := describe(ctx, db, "SELECT * FROM data")
	if err != nil {
		return fail(err)
	}
	f := &File{Name: path.Base(ref), Path: displayPath, Bytes: fmt.Sprint(scope.Sizes[0]), Columns: cols}
	err = db.QueryRowContext(ctx, "SELECT num_rows::VARCHAR, num_row_groups::VARCHAR FROM parquet_file_metadata(?)", scope.Paths[0]).Scan(&f.Rows, &f.RowGroups)
	if err != nil {
		return fail(err)
	}
	if ctx.Err() != nil {
		return fail(ctx.Err())
	}
	e.dropKept()
	e.db = db
	e.remoteKeep = scope
	e.remoteCancel = keepCancel
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

// QueryRemoteWorkspace runs a read-only query with access limited to resolved workspace objects.
func (e *Engine) QueryRemoteWorkspace(parent context.Context, r Request, resolve RemoteResolver) (*Result, error) {
	ctx, done, err := e.start(parent, true)
	if err != nil {
		return nil, err
	}
	defer done()
	scoped := &Engine{remote: resolve, httpfs: e.httpfs, resources: e.resources}
	return scoped.run(ctx, r)
}
func (e *Engine) remoteDatabaseForQuery(ctx context.Context, refs []string) (*database, func(), error) {
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
	db, err := remoteDatabase(ctx, scope.Paths, e.httpfs, e.resources)
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
