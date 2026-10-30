//go:build (windows || linux) && cgo

package cloudstorage

import (
	"fmt"
	"os"
	"testing"
	"time"
)

func TestNativeCredentialVault(t *testing.T) {
	if os.Getenv("BAMBOO_VAULT_TEST") != "1" {
		t.Skip("synthetic native vault test is opt-in")
	}
	vault := NewVault()
	id := fmt.Sprintf("bamboo-synthetic-test-%d", time.Now().UnixNano())
	t.Cleanup(func() {
		if err := vault.Delete(id); err != nil {
			t.Error(err)
		}
	})
	if _, err := vault.Get(id); err == nil {
		t.Fatal("missing credential succeeded")
	}
	value := Credentials{AccessKey: "synthetic-key", SecretKey: "synthetic-secret", SessionToken: "synthetic-token"}
	if err := vault.Set(id, value); err != nil {
		t.Fatal(err)
	}
	got, err := vault.Get(id)
	if err != nil || got != value {
		t.Fatal("credential round trip failed", err)
	}
	value.SecretKey = "synthetic-replacement"
	if err := vault.Set(id, value); err != nil {
		t.Fatal(err)
	}
	got, err = vault.Get(id)
	if err != nil || got != value {
		t.Fatal("credential replacement failed", err)
	}
	if err := vault.Delete(id); err != nil {
		t.Fatal(err)
	}
	if _, err := vault.Get(id); err == nil {
		t.Fatal("deleted credential remains")
	}
}
