package main

import (
	"bamboo/internal/engine"
	"bamboo/internal/privatefs"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

func loadResources(dir string) engine.Resources {
	b, err := os.ReadFile(filepath.Join(dir, "resources.json"))
	var r engine.Resources
	if err != nil || len(b) > 1024 || json.Unmarshal(b, &r) != nil || r.Validate() != nil {
		return engine.DefaultResources()
	}
	return r
}

// ResourceLimits returns memory budgets derived from the current machine.
func (w *Workbench) ResourceLimits() engine.MemoryLimits { return engine.CurrentMemoryLimits() }

// DiskLimits reports current free space and budgets on the temporary volume.
func (w *Workbench) DiskLimits() engine.DiskLimits { return engine.CurrentDiskLimits() }

// Resources loads the persisted query resource settings, falling back to defaults.
func (w *Workbench) Resources() engine.Resources { return loadResources(w.configDir) }

// SetResources validates and atomically saves limits before applying them to future queries.
func (w *Workbench) SetResources(r engine.Resources) error {
	if err := r.Validate(); err != nil {
		return err
	}
	if !r.TempAuto && r.TempGiB > engine.CurrentDiskLimits().MaxTempGiB {
		return errors.New("temporary disk limit exceeds currently available space")
	}
	if !w.opMu.TryLock() {
		return errors.New("another operation is running")
	}
	defer w.opMu.Unlock()
	if w.engine == nil || w.configDir == "" {
		return errors.New("could not save resource settings")
	}
	return w.engine.Configure(r, func() error {
		fail := errors.New("could not save resource settings")
		if err := os.MkdirAll(w.configDir, 0700); err != nil {
			return fail
		}
		f, err := privatefs.CreateTemp(w.configDir, ".resources-*")
		if err != nil {
			return fail
		}
		defer os.Remove(f.Name())
		err = json.NewEncoder(f).Encode(r)
		if err == nil {
			err = f.Sync()
		}
		closeErr := f.Close()
		if err != nil || closeErr != nil {
			return fail
		}
		if err = os.Rename(f.Name(), filepath.Join(w.configDir, "resources.json")); err != nil {
			return fail
		}
		return nil
	})
}
