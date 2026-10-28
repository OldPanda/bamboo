package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/egoist/mygo"
)

func parseAppearance(source string) (mygo.ThemeSource, error) {
	switch mygo.ThemeSource(source) {
	case "", mygo.ThemeSystem:
		return mygo.ThemeSystem, nil
	case mygo.ThemeLight, mygo.ThemeDark:
		return mygo.ThemeSource(source), nil
	default:
		return "", errors.New("appearance must be system, light, or dark")
	}
}

func appearancePath(dir string) string { return filepath.Join(dir, "appearance.json") }

func loadAppearance(dir string) mygo.ThemeSource {
	b, err := os.ReadFile(appearancePath(dir))
	if err != nil || len(b) > 256 {
		return mygo.ThemeSystem
	}
	var saved struct {
		Source string `json:"source"`
	}
	if json.Unmarshal(b, &saved) != nil {
		return mygo.ThemeSystem
	}
	source, err := parseAppearance(saved.Source)
	if err != nil {
		return mygo.ThemeSystem
	}
	return source
}

func saveAppearance(dir string, source mygo.ThemeSource) error {
	parsed, err := parseAppearance(string(source))
	if err != nil {
		return err
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return errors.New("could not save appearance")
	}
	body, err := json.Marshal(struct {
		Source string `json:"source"`
	}{string(parsed)})
	if err != nil {
		return errors.New("could not save appearance")
	}
	f, err := os.CreateTemp(dir, ".appearance-*")
	if err != nil {
		return errors.New("could not save appearance")
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err != nil {
		f.Close()
		return errors.New("could not save appearance")
	}
	if _, err = f.Write(body); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return errors.New("could not save appearance")
	}
	if closeErr != nil {
		return errors.New("could not save appearance")
	}
	if err = os.Rename(f.Name(), appearancePath(dir)); err != nil {
		return errors.New("could not save appearance")
	}
	return nil
}

// Appearance returns the saved system, light, or dark appearance.
func (w *Workbench) Appearance() string { return string(loadAppearance(w.configDir)) }

// SetAppearance saves and applies a system, light, or dark appearance.
func (w *Workbench) SetAppearance(source string) error {
	parsed, err := parseAppearance(source)
	if err != nil {
		return err
	}
	if w.configDir == "" {
		return errors.New("could not save appearance")
	}
	if err = saveAppearance(w.configDir, parsed); err != nil {
		return err
	}
	mygo.Theme.SetSource(parsed)
	return nil
}
