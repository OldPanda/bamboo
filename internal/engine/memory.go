package engine

// MemoryLimits reports detected physical RAM, not transient free memory.
type MemoryLimits struct {
	PhysicalMiB   int `json:"physicalMiB"`
	MaxMemoryMiB  int `json:"maxMemoryMiB"`
	AutoMemoryMiB int `json:"autoMemoryMiB"`
}

func memoryLimits(physicalMiB int) MemoryLimits {
	// Detection failure keeps the previous conservative defaults. The UI names
	// this fallback instead of claiming a physical memory measurement.
	if physicalMiB < 128 {
		return MemoryLimits{MaxMemoryMiB: 16384, AutoMemoryMiB: 256}
	}
	return MemoryLimits{PhysicalMiB: physicalMiB, MaxMemoryMiB: physicalMiB, AutoMemoryMiB: max(128, physicalMiB/4)}
}

// CurrentMemoryLimits derives automatic and maximum query budgets from physical memory.
func CurrentMemoryLimits() MemoryLimits { return memoryLimits(physicalMemoryMiB()) }
func (r Resources) memoryBudget(limits MemoryLimits) int {
	if r.MemoryAuto {
		return limits.AutoMemoryMiB
	}
	return r.MemoryMiB
}
