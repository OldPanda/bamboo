package main

import (
	"bamboo/internal/engine"
	"bamboo/internal/r2"
	"bamboo/internal/workspace"
	"context"
	"errors"
	"strings"
)

func isR2(root string) bool { return strings.HasPrefix(root, "r2://") }
func (w *Workbench) remoteOperation(parent context.Context) (context.Context, func()) {
	ctx, cancel := context.WithTimeout(parent, engine.Timeout)
	w.mu.Lock()
	w.remoteCancel = cancel
	w.mu.Unlock()
	return ctx, func() { cancel(); w.mu.Lock(); w.remoteCancel = nil; w.mu.Unlock() }
}
func (w *Workbench) ConnectR2(ctx context.Context, input r2.ConnectInput) (*workspace.Info, error) {
	if !w.opMu.TryLock() {
		return nil, errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	ctx, done := w.remoteOperation(ctx)
	defer done()
	return w.remote.Connect(ctx, input)
}
func (w *Workbench) openRemoteFile(ctx context.Context, root, relative string) (*WorkspaceFile, error) {
	q, err := w.remote.Saved(root, relative)
	if err != nil {
		return nil, err
	}
	f, err := w.engine.OpenRemote(ctx, root+"/"+relative, relative, w.remote.Resolver(root))
	if err != nil {
		return nil, err
	}
	w.mu.Lock()
	w.last = nil
	w.mu.Unlock()
	r := &WorkspaceFile{File: f, Query: q}
	if err = w.remote.Select(root, relative); err != nil {
		r.Warning = "File opened, but its recent-file state could not be saved: " + err.Error()
	}
	return r, nil
}
