package engine

import (
	"context"
	"testing"
)

func TestDiskCapacityBudgets(t *testing.T) {
	for _, tc := range []struct {
		free          int64
		maximum, auto int
	}{
		{-1, 0, 0}, {0, 0, 0}, {512 << 20, 0, 0}, {1 << 30, 0, 0}, {3 << 30, 2, 0},
		{5 << 30, 4, 1}, {257 << 30, 256, 64}, {1025 << 30, 1024, 256},
	} {
		limits := diskLimits(tc.free, true)
		if limits.MaxTempGiB != tc.maximum || limits.AutoTempGiB != tc.auto || !limits.Detected {
			t.Fatal(tc, limits)
		}
		r := DefaultResources()
		if !r.TempAuto || r.diskBudget(tc.free) != int64(tc.auto)<<30 {
			t.Fatal("automatic budget", tc)
		}
		r.TempAuto = false
		r.TempGiB = 512
		if got := r.diskBudget(tc.free); got < 0 || got > max(0, tc.free-diskReserve) || got > 512<<30 {
			t.Fatal("unsafe custom budget", tc, got)
		}
		r.TempGiB = 0
		if r.diskBudget(tc.free) != 0 {
			t.Fatal("custom zero must disable spill")
		}
	}
	if limits := diskLimits(257<<30, false); limits.Detected || limits.MaxTempGiB != 0 || limits.AutoTempGiB != 0 {
		t.Fatal("unsafe detection fallback", limits)
	}
	// A saved custom budget is a preference, not a reservation of current free space.
	r := DefaultResources()
	r.TempAuto = false
	r.TempGiB = 512
	if err := r.Validate(); err != nil {
		t.Fatal("old fixed ceiling retained", err)
	}
	if r.diskBudget(10<<30) != 9<<30 || r.diskBudget(100<<30) != 99<<30 {
		t.Fatal("budget did not adapt to reduced free space")
	}
}

func TestAutomaticDiskQuotaApplied(t *testing.T) {
	for _, auto := range []bool{false, true} {
		r := DefaultResources()
		r.TempAuto = auto
		r.TempGiB = 0
		db, err := newDatabase(context.Background(), r)
		if err != nil {
			t.Fatal(err)
		}
		var quota string
		if err = db.QueryRow("SELECT current_setting('max_temp_directory_size')").Scan(&quota); err != nil {
			db.Close()
			t.Fatal(err)
		}
		if auto {
			if db.tempDir == "" || db.tempBytes < 0 {
				db.Close()
				t.Fatal("auto scratch missing")
			}
			var equal bool
			if err = db.QueryRow("SELECT current_setting('max_temp_directory_size') = format_bytes(?)", db.tempBytes).Scan(&equal); err != nil || !equal {
				db.Close()
				t.Fatal("quota not applied", quota, db.tempBytes, err)
			}
		} else if db.tempDir != "" || db.tempBytes != 0 || quota != "0 bytes" {
			db.Close()
			t.Fatal("manual zero", quota)
		}
		if err = db.Close(); err != nil {
			t.Fatal(err)
		}
	}
}
