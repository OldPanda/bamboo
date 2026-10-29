//go:build darwin && cgo

package updater

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -fblocks
#cgo LDFLAGS: -framework Foundation -framework AppKit
#include "native_darwin.h"
#include <stdlib.h>
*/
import "C"

import (
	"encoding/json"
	"errors"
	"unsafe"
)

// Start loads the bundled framework and starts its scheduler on the main thread.
func (c *Controller) Start() error { return nativeError(int(C.bamboo_updater_start())) }

// Status returns native preferences and availability without initiating network access.
func (c *Controller) Status() (Status, error) {
	data := C.bamboo_updater_status()
	if data == nil {
		return Status{}, errors.New("could not read update settings")
	}
	defer C.free(unsafe.Pointer(data))
	var status Status
	err := json.Unmarshal([]byte(C.GoString(data)), &status)
	return status, err
}

// Check asks Sparkle to present a user-initiated check, download and installation flow.
func (c *Controller) Check() error { return nativeError(int(C.bamboo_updater_check())) }

// SetAutomatic persists the user's choice through Sparkle's own preferences.
func (c *Controller) SetAutomatic(enabled bool) error {
	value := 0
	if enabled {
		value = 1
	}
	return nativeError(int(C.bamboo_updater_automatic(C.int(value))))
}
