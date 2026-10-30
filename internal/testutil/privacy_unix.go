//go:build !windows

// Package testutil verifies native filesystem protections in platform regressions.
package testutil

import (
	"os"
	"testing"
)

// Private verifies the Unix mode of an app-created file or directory.
func Private(t *testing.T, path string, mode os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != mode {
		t.Fatalf("private permissions: %v, want %v", info.Mode().Perm(), mode)
	}
}

// DenyRead makes a generated directory inaccessible until test cleanup.
func DenyRead(t *testing.T, path string) {
	t.Helper()
	if err := os.Chmod(path, 0000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chmod(path, 0700); err != nil {
			t.Error(err)
		}
	})
}
