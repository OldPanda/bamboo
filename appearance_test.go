package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/egoist/mygo"
)

func TestAppearancePreference(t *testing.T) {
	dir := t.TempDir()
	if loadAppearance(dir) != mygo.ThemeSystem {
		t.Fatal("missing preference")
	}
	if _, err := parseAppearance("blue"); err == nil {
		t.Fatal("accepted unknown appearance")
	}
	os.WriteFile(filepath.Join(dir, "appearance.json"), []byte("{"), 0600)
	if loadAppearance(dir) != mygo.ThemeSystem {
		t.Fatal("corrupt preference")
	}
	if err := saveAppearance(dir, mygo.ThemeDark); err != nil {
		t.Fatal(err)
	}
	if loadAppearance(dir) != mygo.ThemeDark {
		t.Fatal("dark preference was not saved")
	}
	info, err := os.Stat(filepath.Join(dir, "appearance.json"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal(info, err)
	}
	w := &Workbench{configDir: dir}
	if w.Appearance() != "dark" {
		t.Fatal(w.Appearance())
	}
	if err = saveAppearance(dir, mygo.ThemeLight); err != nil || w.Appearance() != "light" {
		t.Fatal(w.Appearance(), err)
	}
	if err = saveAppearance(dir, mygo.ThemeSource("nope")); err == nil || w.Appearance() != "light" {
		t.Fatal("invalid appearance replaced the saved choice")
	}
}
