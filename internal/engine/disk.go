package engine

import "os"

// DiskLimits describes free space on the volume containing query temporary files.
// All budgets are whole GiB and exclude the safety reserve.
type DiskLimits struct {
	Detected     bool `json:"detected"`
	AvailableGiB int  `json:"availableGiB"`
	ReserveGiB   int  `json:"reserveGiB"`
	MaxTempGiB   int  `json:"maxTempGiB"`
	AutoTempGiB  int  `json:"autoTempGiB"`
}

func diskLimits(available int64, detected bool) DiskLimits {
	limits := DiskLimits{Detected: detected, ReserveGiB: int(diskReserve >> 30)}
	if !detected {
		return limits
	}
	limits.AvailableGiB = int(max(0, available) >> 30)
	limits.MaxTempGiB = int(max(0, available-diskReserve) >> 30)
	limits.AutoTempGiB = limits.MaxTempGiB / 4
	return limits
}

// CurrentDiskLimits measures the temporary volume; detection failure grants no spill budget.
func CurrentDiskLimits() DiskLimits {
	free, err := availableDisk(os.TempDir())
	return diskLimits(free, err == nil)
}

func (r Resources) diskBudget(available int64) int64 {
	requested := r.TempGiB
	if r.TempAuto {
		requested = diskLimits(available, true).AutoTempGiB
	}
	return spillAllowance(int64(requested)<<30, available)
}
