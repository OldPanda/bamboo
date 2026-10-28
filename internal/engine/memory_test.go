package engine

import (
	"context"
	"testing"
)

func TestMemoryCapacityBudgets(t *testing.T) {
	for _, total := range []int{8192, 32768, 65536, 131072} {
		limits := memoryLimits(total)
		auto := DefaultResources()
		if auto.memoryBudget(limits) != total/4 || !auto.MemoryAuto {
			t.Fatalf("auto %d: %+v", total, limits)
		}
		manual := auto
		manual.MemoryAuto = false
		manual.MemoryMiB = total
		if err := manual.validateMemory(limits); err != nil {
			t.Fatalf("physical maximum %d: %v", total, err)
		}
		if manual.memoryBudget(limits) != total {
			t.Fatal("custom budget changed")
		}
		manual.MemoryMiB++
		if manual.validateMemory(limits) == nil {
			t.Fatal("accepted above physical RAM")
		}
		manual.MemoryMiB = 127
		if manual.validateMemory(limits) == nil {
			t.Fatal("accepted below minimum")
		}
	}
	fallback := memoryLimits(0)
	if fallback.PhysicalMiB != 0 || fallback.AutoMemoryMiB != 256 || fallback.MaxMemoryMiB != 16384 {
		t.Fatal(fallback)
	}
	if memoryLimits(-1) != fallback || memoryLimits(64) != fallback {
		t.Fatal("invalid physical RAM")
	}
	if memoryLimits(128).AutoMemoryMiB != 128 {
		t.Fatal("minimum automatic budget")
	}
}

func TestAutomaticMemoryApplied(t *testing.T) {
	auto := DefaultResources()
	auto.TempGiB = 0
	auto.TempAuto = false
	manual := auto
	manual.MemoryAuto = false
	manual.MemoryMiB = CurrentMemoryLimits().AutoMemoryMiB
	var observed []string
	for _, config := range []Resources{auto, manual} {
		db, err := newDatabase(context.Background(), config)
		if err != nil {
			t.Fatal(err)
		}
		var limit string
		err = db.QueryRow("SELECT current_setting('memory_limit')").Scan(&limit)
		db.Close()
		if err != nil {
			t.Fatal(err)
		}
		observed = append(observed, limit)
	}
	if observed[0] != observed[1] {
		t.Fatalf("automatic budget not applied: %v", observed)
	}
	// Validate before creating DuckDB, even for callers outside Configure.
	manual.MemoryMiB = CurrentMemoryLimits().MaxMemoryMiB + 1
	if db, err := newDatabase(context.Background(), manual); err == nil {
		db.Close()
		t.Fatal("over-budget connection created")
	}
}
