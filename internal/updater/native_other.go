//go:build !darwin || !cgo

package updater

// Start leaves unsupported development platforms offline.
func (c *Controller) Start() error { return nativeError(1) }

// Status reports that signed macOS updates are unavailable on this platform.
func (c *Controller) Status() (Status, error) { return Status{Version: "development"}, nil }

// Check refuses updates outside the supported native application.
func (c *Controller) Check() error { return nativeError(1) }

// SetAutomatic refuses to save a preference the platform cannot honor.
func (c *Controller) SetAutomatic(bool) error { return nativeError(1) }
