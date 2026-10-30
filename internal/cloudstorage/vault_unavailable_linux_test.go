//go:build linux && cgo

package cloudstorage

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestSecretServiceUnavailable(t *testing.T) {
	if os.Getenv("BAMBOO_VAULT_MISSING_PROBE") == "1" {
		vault := NewVault()
		if _, err := vault.Get("synthetic-missing-service"); err == nil {
			t.Fatal("missing service returned credentials")
		}
		if err := vault.Set("synthetic-missing-service", Credentials{AccessKey: "synthetic", SecretKey: "synthetic"}); err == nil {
			t.Fatal("missing service accepted credentials")
		}
		if err := vault.Delete("synthetic-missing-service"); err == nil {
			t.Fatal("missing service reported deletion")
		}
		return
	}
	// Isolate libsecret's cached session connection and all possible storage paths.
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestSecretServiceUnavailable$", "-test.count=1")
	cmd.Env = append(os.Environ(), "BAMBOO_VAULT_MISSING_PROBE=1", "DBUS_SESSION_BUS_ADDRESS=unix:path="+filepath.Join(dir, "missing-bus"), "XDG_DATA_HOME="+dir, "XDG_CONFIG_HOME="+dir)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("missing service probe: %v\n%s", err, output)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 0 {
		t.Fatal("missing service created local storage", err)
	}
}
