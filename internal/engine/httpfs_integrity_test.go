package engine

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHTTPFSRechecksBytesAtLoadBoundary(t *testing.T) {
	data, err := os.ReadFile("../../build/extensions/httpfs.duckdb_extension")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "httpfs.duckdb_extension")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifyHTTPFS(path); err != nil {
		t.Fatal(err)
	}
	data[len(data)/2] ^= 1
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifyHTTPFS(path); err == nil {
		t.Fatal("accepted modified bytes at previously verified path")
	}
}
