//go:build !darwin && !linux && !windows

package engine

// Unsupported platforms use conservative budgets.
func physicalMemoryMiB() int { return 0 }
