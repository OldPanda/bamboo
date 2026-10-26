//go:build r2smoke

// This fixture injection is omitted from production builds. It preserves the
// real IPC/UI/engine, replacing only R2 transport and the credential vault.
package main

import (
	"bamboo/internal/r2"
	"bamboo/internal/r2test"
	"os"
)

func init() {
	remoteStoreFactory = func(dir string, _ r2.Vault) *r2.Store {
		server := r2test.New(os.Getenv("BAMBOO_R2_FIXTURES"))
		return r2.NewWithTransport(dir, &r2test.Vault{}, server.Transport)
	}
}
