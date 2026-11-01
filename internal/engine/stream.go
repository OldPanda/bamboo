package engine

import (
	"context"
	"errors"
)

// RowSink receives bounded metadata once with a nil row, then each exact row.
// It must consume each row synchronously. An error aborts and releases the query.
type RowSink func(columns []Column, row []*string) error

// Stream executes the captured query/filter/sort without preview pagination.
// It retains schema, cell, per-row, timeout, memory and spill limits; no full
// result is accumulated. Sources are read again and may have changed externally.
func (e *Engine) Stream(parent context.Context, r Request, sink RowSink) error {
	return e.stream(parent, e, r, sink)
}

// StreamWorkspace streams only files resolved within the selected local root.
func (e *Engine) StreamWorkspace(parent context.Context, r Request, resolve func(string) (string, error), sink RowSink) error {
	return e.stream(parent, &Engine{resolve: resolve}, r, sink)
}

// StreamRemoteWorkspace streams through the existing scoped cloud range reader.
func (e *Engine) StreamRemoteWorkspace(parent context.Context, r Request, resolve RemoteResolver, sink RowSink) error {
	return e.stream(parent, &Engine{remote: resolve}, r, sink)
}

func (e *Engine) stream(parent context.Context, scoped *Engine, r Request, sink RowSink) error {
	if sink == nil {
		return errors.New("export requires a row consumer")
	}
	ctx, done, err := e.start(parent, true)
	if err != nil {
		return err
	}
	defer done()
	if scoped != e {
		scoped.resources, scoped.httpfs = e.resources, e.httpfs
	}
	_, err = scoped.run(ctx, r, sink)
	return err
}
