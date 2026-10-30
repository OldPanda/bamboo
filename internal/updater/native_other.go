//go:build !darwin || !cgo

package updater

import "github.com/egoist/mygo"

var buildVersion = "development"
var openReleasePage = func() error { return mygo.Shell.OpenExternal("https://github.com/OldPanda/bamboo/releases") }

// Start performs no background network access or installation on these platforms.
func (c *Controller) Start() error { return nil }

// Status exposes manual release browsing and the stamped application version.
func (c *Controller) Status() (Status, error) {
	return Status{Version: buildVersion, CanCheck: true}, nil
}

// Check opens the fixed release page only after an explicit user action.
func (c *Controller) Check() error { return openReleasePage() }

// SetAutomatic refuses to save a preference the platform cannot honor.
func (c *Controller) SetAutomatic(bool) error { return nativeError(1) }
