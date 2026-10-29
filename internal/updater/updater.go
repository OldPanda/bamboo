// Package updater bridges Sparkle's signed macOS update lifecycle.
package updater

// Status is a snapshot of the native updater and the running bundle version.
type Status struct {
	UpdateVersion string `json:"updateVersion"`
	Version       string `json:"version"`
	Available     bool   `json:"available"`
	Automatic     bool   `json:"automatic"`
	CanCheck      bool   `json:"canCheck"`
}

// Controller uses Sparkle's settings and installer without maintaining a second cache.
type Controller struct{}

// New creates a controller; Start must be called after the app's main loop is ready.
func New() *Controller { return &Controller{} }
