package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLanguagePreference(t *testing.T) {
	dir := t.TempDir()
	w := &Workbench{configDir: dir}
	if w.Language() != "en" {
		t.Fatal("default")
	}
	for _, bad := range []string{"{", `{"language":"fr"}`, strings.Repeat(" ", 257)} {
		if err := os.WriteFile(filepath.Join(dir, "language.json"), []byte(bad), 0600); err != nil {
			t.Fatal(err)
		}
		if w.Language() != "en" {
			t.Fatal("invalid settings must fall back")
		}
	}
	for _, language := range []string{"zh-CN", "en"} {
		if err := w.SetLanguage(language); err != nil {
			t.Fatal(err)
		}
		fresh := &Workbench{configDir: dir}
		if fresh.Language() != language {
			t.Fatal("not persisted")
		}
		stat, err := os.Stat(filepath.Join(dir, "language.json"))
		if err != nil || stat.Mode().Perm() != 0600 {
			t.Fatal("private preference", stat, err)
		}
		want := "English"
		if language == "zh-CN" {
			want = "中文"
		}
		if fresh.languageText("English", "中文") != want {
			t.Fatal("dialog language")
		}
	}
	if err := w.SetLanguage("fr"); err == nil || w.Language() != "en" {
		t.Fatal("invalid choice changed preference")
	}
	if err := (&Workbench{}).SetLanguage("zh-CN"); err == nil {
		t.Fatal("missing config")
	}
	blocker := filepath.Join(dir, "blocker")
	os.WriteFile(blocker, []byte("keep"), 0600)
	if err := (&Workbench{configDir: blocker}).SetLanguage("en"); err == nil {
		t.Fatal("file as directory")
	}
	// A directory at the destination must not be replaced, and temporary files are cleaned.
	os.Remove(filepath.Join(dir, "language.json"))
	os.Mkdir(filepath.Join(dir, "language.json"), 0700)
	if err := w.SetLanguage("zh-CN"); err == nil {
		t.Fatal("rename failure ignored")
	}
	matches, _ := filepath.Glob(filepath.Join(dir, ".language-*"))
	if len(matches) != 0 {
		t.Fatal("temporary files leaked", matches)
	}
}

func TestLanguageDialogTitles(t *testing.T) {
	w, d, _ := workbench(t)
	w.configDir = t.TempDir()
	if err := w.SetLanguage("zh-CN"); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Open(context.Background()); err != nil {
		t.Fatal(err)
	}
	if d.openOptions.Title != "打开 Parquet 文件" {
		t.Fatal(d.openOptions.Title)
	}
	if _, err := w.OpenWorkspace(context.Background()); err != nil {
		t.Fatal(err)
	}
	if d.openOptions.Title != "打开工作区文件夹" {
		t.Fatal(d.openOptions.Title)
	}
	if _, err := w.OpenPath(context.Background(), w.initial); err != nil {
		t.Fatal(err)
	}
	readPage(t, w, "SELECT * FROM data")
	if _, err := w.ExportPageAs(context.Background(), "csv"); err != nil {
		t.Fatal(err)
	}
	if d.saveOptions.Title != "导出当前页为 CSV" {
		t.Fatal(d.saveOptions.Title)
	}
}
