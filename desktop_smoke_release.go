//go:build bamboo_release

package main

import "github.com/egoist/mygo"

// Developer screenshot/script automation is not shipped in the release binary.
func smoke(*mygo.Window) {}
