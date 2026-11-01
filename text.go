package main

import (
	"bamboo/internal/datafile"
	"errors"
	"os"
	"path/filepath"
)

func (w *Workbench) textOptions(path string) (datafile.TextOptions, error) {
	if w.folders == nil {
		return datafile.DefaultTextOptions(path), nil
	}
	return w.folders.TextOptions(path)
}

// SetTextOptions saves explicit UTF-8 parsing preferences for a local file.
// It invalidates the reader and export eligibility; reopen to preview the change.
// Source bytes are never modified, even when preferences cannot be saved.
func (w *Workbench) SetTextOptions(path string, options datafile.TextOptions) error {
	if !w.opMu.TryLock() {
		return errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	if w.folders == nil || !filepath.IsAbs(path) || !datafile.IsText(path) {
		return errors.New("choose a local CSV or TSV file")
	}
	path, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	st, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() {
		return errors.New("choose a regular CSV or TSV file")
	}
	if err = w.folders.SetTextOptions(path, options); err != nil {
		return err
	}
	w.engine.Close()
	w.mu.Lock()
	w.last = nil
	w.mu.Unlock()
	return nil
}
