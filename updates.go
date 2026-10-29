package main

import (
	"bamboo/internal/updater"
	"errors"
)

type updateService interface {
	Status() (updater.Status, error)
	Check() error
	SetAutomatic(bool) error
}

// UpdateStatus returns update preferences and the currently installed version.
func (w *Workbench) UpdateStatus() (updater.Status, error) {
	if w.updates == nil {
		return updater.Status{Version: "development"}, nil
	}
	return w.updates.Status()
}

// CheckForUpdates opens the native signed-update flow, preserving work until consent.
func (w *Workbench) CheckForUpdates() error {
	if w.updates == nil {
		return errors.New("updates are unavailable in this build")
	}
	return w.updates.Check()
}

// SetAutomaticUpdates changes only Sparkle's automatic-check preference.
func (w *Workbench) SetAutomaticUpdates(enabled bool) error {
	if w.updates == nil {
		return errors.New("updates are unavailable in this build")
	}
	return w.updates.SetAutomatic(enabled)
}
