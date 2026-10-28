package main

import (
	"bamboo/internal/cloudstorage"
	"bamboo/internal/engine"
	"bamboo/internal/workspace"
	"context"
	"errors"
	"strings"
)

func isRemoteWorkspace(root string) bool {
	return strings.HasPrefix(root, "r2://") || strings.HasPrefix(root, "s3://")
}
func (w *Workbench) remoteOperation(parent context.Context) (context.Context, func()) {
	ctx, cancel := context.WithTimeout(parent, engine.Timeout)
	w.mu.Lock()
	w.remoteCancel = cancel
	w.mu.Unlock()
	return ctx, func() { cancel(); w.mu.Lock(); w.remoteCancel = nil; w.mu.Unlock() }
}

// ConnectR2 opens a cloud connection; provider selects R2 or AWS S3.
// The legacy IPC name is retained for compatibility.
func (w *Workbench) ConnectR2(ctx context.Context, input cloudstorage.ConnectInput) (*workspace.Info, error) {
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

// ListConnections returns saved connection summaries without credentials.
func (w *Workbench) ListConnections() ([]cloudstorage.Connection, error) {
	return w.remote.Connections()
}

// SaveR2Connection saves an R2 or S3 connection; the legacy IPC name is preserved.
func (w *Workbench) SaveR2Connection(ctx context.Context, root string, input cloudstorage.ConnectInput) (*workspace.Info, error) {
	if !w.opMu.TryLock() {
		return nil, errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	ctx, done := w.remoteOperation(ctx)
	defer done()
	return w.remote.SaveConnection(ctx, root, input)
}

// TestR2Connection checks access to a saved R2 or S3 connection.
func (w *Workbench) TestR2Connection(ctx context.Context, root string) error {
	if !w.opMu.TryLock() {
		return errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	ctx, done := w.remoteOperation(ctx)
	defer done()
	return w.remote.TestConnection(ctx, root)
}

// OpenR2Connection verifies and opens a saved R2 or S3 workspace.
func (w *Workbench) OpenR2Connection(ctx context.Context, root string) (*workspace.Info, error) {
	if !w.opMu.TryLock() {
		return nil, errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	ctx, done := w.remoteOperation(ctx)
	defer done()
	return w.remote.OpenConnection(ctx, root)
}

// DeleteR2Connection removes a saved cloud connection and its credentials.
func (w *Workbench) DeleteR2Connection(root string) error {
	if !w.opMu.TryLock() {
		return errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	return w.remote.DeleteConnection(root)
}
