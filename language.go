package main

import (
	"bamboo/internal/privatefs"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

func loadLanguage(dir string) string {
	b, err := os.ReadFile(filepath.Join(dir, "language.json"))
	var saved struct {
		Language string `json:"language"`
	}
	if err != nil || len(b) > 256 || json.Unmarshal(b, &saved) != nil || saved.Language != "zh-CN" {
		return "en"
	}
	return saved.Language
}

// Language returns the saved interface language, defaulting to English.
func (w *Workbench) Language() string { return loadLanguage(w.configDir) }

// SetLanguage saves the interface language independently of data and appearance.
func (w *Workbench) SetLanguage(language string) error {
	if language != "en" && language != "zh-CN" {
		return errors.New("unsupported interface language")
	}
	if w.configDir == "" {
		return errors.New("could not save language")
	}
	if err := os.MkdirAll(w.configDir, 0700); err != nil {
		return errors.New("could not save language")
	}
	f, err := privatefs.CreateTemp(w.configDir, ".language-*")
	if err != nil {
		return errors.New("could not save language")
	}
	defer os.Remove(f.Name())
	_, err = f.WriteString(`{"language":"` + language + `"}`)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		return errors.New("could not save language")
	}
	if err = os.Rename(f.Name(), filepath.Join(w.configDir, "language.json")); err != nil {
		return errors.New("could not save language")
	}
	return nil
}

func (w *Workbench) languageText(english, chinese string) string {
	if w.Language() == "zh-CN" {
		return chinese
	}
	return english
}
