//go:build cloudsmoke || r2smoke

// This fixture injection is omitted from production builds. It preserves the
// real IPC/UI/engine, replacing only the R2/S3 transport and credential vault.
package main

import (
	"bamboo/internal/cloudstorage"
	"bamboo/internal/cloudstoragetest"
	"os"
)

func init() {
	remoteStoreFactory = func(dir string, _ cloudstorage.Vault) *cloudstorage.Store {
		server := cloudstoragetest.New(cloudFixtureDirectory())
		return cloudstorage.NewWithTransport(dir, &cloudstoragetest.Vault{}, server.Transport)
	}
}

func cloudFixtureDirectory() string {
	if dir := os.Getenv("BAMBOO_CLOUD_FIXTURES"); dir != "" {
		return dir
	}
	// Accept the old test harness variable for existing local workflows.
	return os.Getenv("BAMBOO_R2_FIXTURES")
}
