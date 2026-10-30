//go:build !windows

// Package privatefs creates app-owned settings, exports and spill files with
// owner-only permissions on Unix and protected user/System ACLs on Windows.
package privatefs

import "os"

// Create exclusively creates a private file; it never replaces an existing path.
func Create(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
}

// CreateTemp creates an empty private temporary file in dir.
func CreateTemp(dir, pattern string) (*os.File, error) { return os.CreateTemp(dir, pattern) }

// MkdirTemp creates a private directory for one query's spill files.
func MkdirTemp(dir, pattern string) (string, error) { return os.MkdirTemp(dir, pattern) }
