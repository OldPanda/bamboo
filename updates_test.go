package main

import (
	"bamboo/internal/updater"
	"errors"
	"testing"
)

type fakeUpdates struct {
	state  updater.Status
	err    error
	checks int
}

func (f *fakeUpdates) Status() (updater.Status, error) { return f.state, f.err }
func (f *fakeUpdates) Check() error                    { f.checks++; return f.err }
func (f *fakeUpdates) SetAutomatic(v bool) error {
	if f.err == nil {
		f.state.Automatic = v
	}
	return f.err
}

func TestUpdateControls(t *testing.T) {
	w := &Workbench{}
	state, err := w.UpdateStatus()
	if err != nil || state.Available || state.Version != "development" {
		t.Fatalf("unsupported status: %+v %v", state, err)
	}
	if w.CheckForUpdates() == nil || w.SetAutomaticUpdates(true) == nil {
		t.Fatal("missing updater must fail closed")
	}
	f := &fakeUpdates{state: updater.Status{Version: "1.2.3", Available: true, Automatic: true, CanCheck: true}}
	w.updates = f
	state, err = w.UpdateStatus()
	if err != nil || state != f.state {
		t.Fatal("lost native status")
	}
	if err = w.SetAutomaticUpdates(false); err != nil || f.state.Automatic {
		t.Fatal("did not save disabled preference")
	}
	if err = w.SetAutomaticUpdates(true); err != nil || !f.state.Automatic {
		t.Fatal("did not save enabled preference")
	}
	if err = w.CheckForUpdates(); err != nil || f.checks != 1 {
		t.Fatal("check not delegated")
	}
	f.err = errors.New("native unavailable")
	if _, err = w.UpdateStatus(); !errors.Is(err, f.err) {
		t.Fatal("lost status error")
	}
	if !errors.Is(w.CheckForUpdates(), f.err) || !errors.Is(w.SetAutomaticUpdates(false), f.err) {
		t.Fatal("lost native failure")
	}
	if !f.state.Automatic {
		t.Fatal("failed preference write changed value")
	}
}
