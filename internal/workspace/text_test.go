package workspace

import (
	"bamboo/internal/datafile"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestTextPreferencesAndSession(t *testing.T) {
	dir := t.TempDir()
	s := New(dir)
	file := filepath.Join(dir, "data.tsv")
	want := datafile.TextOptions{Delimiter: ";", InferTypes: true}
	if got, err := s.TextOptions(file); err != nil || got.Delimiter != "\t" || !got.Header {
		t.Fatal(got, err)
	}
	if err := s.SetTextOptions(file, want); err != nil {
		t.Fatal(err)
	}
	if err := s.Remember(file, true); err != nil {
		t.Fatal(err)
	}
	restored := New(dir)
	if got, err := restored.TextOptions(file); err != nil || got != want {
		t.Fatal(got, err)
	}
	if got := restored.MigrateSession(nil); len(got.Files) != 1 || got.Active != file {
		t.Fatal(got)
	}
	for _, path := range []string{"relative.csv", filepath.Join(dir, "no.json")} {
		if err := s.SetTextOptions(path, want); err == nil {
			t.Fatal(path)
		}
	}
	if err := s.SetTextOptions(file, datafile.TextOptions{Delimiter: "'"}); err == nil {
		t.Fatal("invalid delimiter")
	}
	for len(s.data.TextOptions) < 256 {
		s.data.TextOptions[filepath.Join(dir, fmt.Sprintf("%d.csv", len(s.data.TextOptions)))] = want
	}
	if err := s.SetTextOptions(filepath.Join(dir, "full.csv"), want); err == nil {
		t.Fatal("unbounded settings")
	}
	if err := s.SetTextOptions(file, want); err != nil {
		t.Fatal("existing option update", err)
	}
	if validSession(&Session{Files: []string{"s3://bucket/data.csv"}}) {
		t.Fatal("cloud CSV is not supported")
	}
}

func TestInvalidTextPreferencesPreserved(t *testing.T) {
	for _, kind := range []string{"delimiter", "path", "count"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			s := New(dir)
			options := datafile.DefaultTextOptions("a.csv")
			path := filepath.Join(dir, "a.csv")
			if kind == "delimiter" {
				options.Delimiter = "xx"
			} else if kind == "path" {
				path = "relative.csv"
			}
			s.data.TextOptions = map[string]datafile.TextOptions{path: options}
			if kind == "count" {
				for i := 0; i < 257; i++ {
					s.data.TextOptions[filepath.Join(dir, fmt.Sprintf("%d.csv", i))] = options
				}
			}
			before, err := json.Marshal(s.data)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(s.path, before, 0600); err != nil {
				t.Fatal(err)
			}
			s = New(dir)
			if _, err = s.TextOptions(path); err == nil {
				t.Fatal("unreadable interpretation defaulted")
			}
			if err = s.SetTextOptions(filepath.Join(dir, "new.csv"), datafile.DefaultTextOptions("new.csv")); err == nil {
				t.Fatal("unreadable state overwritten")
			}
			after, err := os.ReadFile(s.path)
			if err != nil || string(before) != string(after) {
				t.Fatal("state changed", err)
			}
		})
	}
}
