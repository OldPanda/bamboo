package main

import (
	"bamboo/internal/testutil"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDisplayPersistenceAndBounds(t *testing.T) {
	w := &Workbench{configDir: t.TempDir()}
	if w.Display() != defaultDisplay() {
		t.Fatal("defaults")
	}
	for _, want := range []DisplayPreferences{{75, 12}, {125, 16}, {200, 20}, defaultDisplay()} {
		if err := w.SetDisplay(context.Background(), want); err != nil {
			t.Fatal(err)
		}
		fresh := &Workbench{configDir: w.configDir}
		if fresh.Display() != want {
			t.Fatal("restart", fresh.Display(), want)
		}
	}
	testutil.Private(t, filepath.Join(w.configDir, "display.json"), 0600)
	for _, invalid := range []DisplayPreferences{{0, 13}, {201, 13}, {100, 11}, {100, 21}} {
		if err := w.SetDisplay(context.Background(), invalid); err == nil || w.Display() != defaultDisplay() {
			t.Fatal("invalid preference persisted", invalid, err)
		}
	}
	for _, bad := range []string{"{", "{}", `{"zoomPercent":900,"dataFontSize":13}`, strings.Repeat(" ", 513)} {
		if err := os.WriteFile(filepath.Join(w.configDir, "display.json"), []byte(bad), 0600); err != nil {
			t.Fatal(err)
		}
		if w.Display() != defaultDisplay() {
			t.Fatal("invalid settings did not restore readable defaults")
		}
	}
}

func TestDisplaySaveFailure(t *testing.T) {
	ctx := context.Background()
	if err := (&Workbench{}).SetDisplay(ctx, defaultDisplay()); err == nil {
		t.Fatal("missing config directory")
	}
	dir := t.TempDir()
	file := filepath.Join(dir, "file")
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err := (&Workbench{configDir: file}).SetDisplay(ctx, defaultDisplay()); err == nil {
		t.Fatal("invalid parent")
	}
	if err := os.Mkdir(filepath.Join(dir, "display.json"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := (&Workbench{configDir: dir}).SetDisplay(ctx, defaultDisplay()); err == nil {
		t.Fatal("rename failure")
	}
	partials, err := filepath.Glob(filepath.Join(dir, ".display-*"))
	if err != nil || len(partials) != 0 {
		t.Fatal("partial settings left behind", partials, err)
	}
}
