//go:build windows || linux

package engine

import "testing"

func TestNativeResourceDetection(t *testing.T) {
	if physicalMemoryMiB() < 128 {
		t.Fatal("physical memory detection failed")
	}
	free, err := availableDisk(t.TempDir())
	if err != nil || free <= 0 {
		t.Fatalf("disk detection: %d, %v", free, err)
	}
	if _, err := availableDisk("bamboo-nonexistent-volume/path"); err == nil {
		t.Fatal("missing path accepted")
	}
	if spillAllowance(1<<30, diskReserve) != 0 {
		t.Fatal("reserve consumed")
	}
}
