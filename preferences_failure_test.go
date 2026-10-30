package main

import (
	"bamboo/internal/testutil"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/egoist/mygo"
)

func TestInvalidAppearanceFallsBackToSystem(t *testing.T) {
	for _, body := range []string{`{"source":"unknown"}`, `{}`, strings.Repeat(" ", 257)} {
		dir := t.TempDir()
		if err := os.WriteFile(appearancePath(dir), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		if got := loadAppearance(dir); got != mygo.ThemeSystem {
			t.Fatal(got)
		}
	}
	if got, err := parseAppearance(""); err != nil || got != mygo.ThemeSystem {
		t.Fatal(got, err)
	}
	for _, choice := range []string{"dark", "unknown"} {
		if err := (&Workbench{}).SetAppearance(choice); err == nil {
			t.Fatal("missing configuration accepted")
		}
	}
}

func TestPreferencePersistenceFailureIsAtomic(t *testing.T) {
	for _, kind := range []string{"appearance", "language"} {
		for _, failure := range []string{"parent-file", "read-only", "destination-directory"} {
			t.Run(kind+"/"+failure, func(t *testing.T) {
				dir := t.TempDir()
				w := &Workbench{configDir: dir}
				name := kind + ".json"
				if failure == "parent-file" {
					dir = filepath.Join(dir, "not-a-directory")
					if err := os.WriteFile(dir, []byte("preserve"), 0600); err != nil {
						t.Fatal(err)
					}
					w.configDir = dir
				} else if failure == "read-only" {
					if os.Geteuid() == 0 {
						t.Skip("root bypasses directory permissions")
					}
					if err := os.WriteFile(filepath.Join(dir, name), []byte("preserve"), 0600); err != nil {
						t.Fatal(err)
					}
					testutil.DenyWrite(t, dir)
				} else {
					if err := os.Mkdir(filepath.Join(dir, name), 0700); err != nil {
						t.Fatal(err)
					}
				}
				var err error
				if kind == "appearance" {
					err = w.SetAppearance("dark")
				} else {
					err = w.SetLanguage("zh-CN")
				}
				if err == nil {
					t.Fatal("failed preference save succeeded")
				}
				if failure == "parent-file" {
					body, err := os.ReadFile(dir)
					if err != nil || string(body) != "preserve" {
						t.Fatal("parent file changed", err)
					}
					return
				}
				matches, err := filepath.Glob(filepath.Join(dir, "."+kind+"-*"))
				if err != nil || len(matches) != 0 {
					t.Fatal("temporary preference leaked", matches, err)
				}
				if failure == "read-only" {
					body, err := os.ReadFile(filepath.Join(dir, name))
					if err != nil || string(body) != "preserve" {
						t.Fatal("old preference changed", err)
					}
				}
			})
		}
	}
}
