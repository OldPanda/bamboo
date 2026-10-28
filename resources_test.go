package main

import (
	"bamboo/internal/engine"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestResourcePreferences(t *testing.T) {
	w, _, _ := workbench(t)
	w.configDir = t.TempDir()
	want := engine.Resources{MemoryMiB: 512, TempGiB: 2, TimeoutSeconds: 600}
	if w.Resources() != engine.DefaultResources() {
		t.Fatal("defaults")
	}
	if err := w.SetResources(want); err != nil {
		t.Fatal(err)
	}
	fresh := &Workbench{configDir: w.configDir}
	if fresh.Resources() != want {
		t.Fatal("not persisted")
	}
	st, err := os.Stat(filepath.Join(w.configDir, "resources.json"))
	if err != nil || st.Mode().Perm() != 0600 {
		t.Fatal("permissions", err)
	}
	invalid := want
	invalid.MemoryMiB = 0
	if err = w.SetResources(invalid); err == nil || w.Resources() != want {
		t.Fatal("invalid value saved")
	}
	w.opMu.Lock()
	err = w.SetResources(engine.DefaultResources())
	w.opMu.Unlock()
	if err == nil || w.Resources() != want {
		t.Fatal("busy update")
	}
	os.Remove(filepath.Join(w.configDir, "resources.json"))
	os.Mkdir(filepath.Join(w.configDir, "resources.json"), 0700)
	if err = w.SetResources(want); err == nil {
		t.Fatal("rename failure")
	}
	matches, _ := filepath.Glob(filepath.Join(w.configDir, ".resources-*"))
	if len(matches) > 0 {
		t.Fatal("partial settings", matches)
	}
	if _, err = w.engine.Open(context.Background(), w.initial); err != nil {
		t.Fatal("engine after failed save", err)
	}
	if _, err = w.engine.Query(context.Background(), engine.Request{SQL: "SELECT 42", Limit: 1}); err != nil {
		t.Fatal(err)
	}
}
func TestInvalidResourcePreferences(t *testing.T) {
	dir := t.TempDir()
	for _, body := range []string{"{", `{"memoryMiB":-1,"tempGiB":4,"timeoutSeconds":300}`, `{}`} {
		os.WriteFile(filepath.Join(dir, "resources.json"), []byte(body), 0600)
		if loadResources(dir) != engine.DefaultResources() {
			t.Fatal("invalid settings did not fall back")
		}
	}
	if err := (&Workbench{}).SetResources(engine.DefaultResources()); err == nil {
		t.Fatal("missing configuration")
	}
}

func TestMemoryPreferenceMigration(t *testing.T) {
	w, _, _ := workbench(t)
	w.configDir = t.TempDir()
	// Absence of the new flag means an existing explicit preference.
	if err := os.WriteFile(filepath.Join(w.configDir, "resources.json"), []byte(`{"memoryMiB":512,"tempGiB":2,"timeoutSeconds":600}`), 0600); err != nil {
		t.Fatal(err)
	}
	old := w.Resources()
	if old.MemoryAuto || old.MemoryMiB != 512 || old.TempGiB != 2 {
		t.Fatal("legacy preference changed", old)
	}
	old.MemoryAuto = true
	if err := w.SetResources(old); err != nil {
		t.Fatal(err)
	}
	fresh := &Workbench{configDir: w.configDir}
	if fresh.Resources() != old {
		t.Fatal("auto preference not persisted")
	}
	if w.ResourceLimits() != engine.CurrentMemoryLimits() {
		t.Fatal("IPC limits mismatch")
	}
	limits := w.ResourceLimits()
	manual := old
	manual.MemoryAuto = false
	manual.MemoryMiB = limits.MaxMemoryMiB
	if err := w.SetResources(manual); err != nil {
		t.Fatal("maximum rejected", err)
	}
	manual.MemoryMiB++
	if err := w.SetResources(manual); err == nil {
		t.Fatal("above maximum saved")
	}
	if w.Resources().MemoryMiB != limits.MaxMemoryMiB {
		t.Fatal("invalid save changed settings")
	}
}

func TestDiskPreferenceMigration(t *testing.T) {
	w, _, _ := workbench(t)
	w.configDir = t.TempDir()
	for _, budget := range []int{0, 2, 512} {
		body := fmt.Sprintf(`{"memoryMiB":512,"tempGiB":%d,"timeoutSeconds":300}`, budget)
		if err := os.WriteFile(filepath.Join(w.configDir, "resources.json"), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		saved := w.Resources()
		if saved.TempAuto || saved.TempGiB != budget {
			t.Fatal("legacy budget lost", saved)
		}
	}
	saved := w.Resources()
	saved.TempAuto = true
	if err := w.SetResources(saved); err != nil {
		t.Fatal(err)
	}
	if got := (&Workbench{configDir: w.configDir}).Resources(); got != saved {
		t.Fatal("auto not persisted", got)
	}
	invalid := saved
	invalid.TempAuto = false
	invalid.TempGiB = engine.CurrentDiskLimits().MaxTempGiB + 1
	if err := w.SetResources(invalid); err == nil {
		t.Fatal("saved above current available space")
	}
	if w.Resources() != saved {
		t.Fatal("failed save overwrote preference")
	}
	limits := w.DiskLimits()
	if limits.MaxTempGiB < 0 || limits.AutoTempGiB > limits.MaxTempGiB || limits.ReserveGiB != 1 {
		t.Fatal(limits)
	}
}
