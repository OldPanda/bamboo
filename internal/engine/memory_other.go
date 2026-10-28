//go:build !darwin

package engine

// Bamboo currently ships on macOS; other platforms use conservative budgets.
func physicalMemoryMiB() int { return 0 }
