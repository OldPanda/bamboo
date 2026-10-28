//go:build !darwin || !cgo

package cloudstorage

import "errors"

type unavailableVault struct{}

// NewVault returns a vault that reports unsupported credential storage on this platform.
func NewVault() Vault { return unavailableVault{} }
func (unavailableVault) Get(string) (Credentials, error) {
	return Credentials{}, errors.New("Cloud credential storage requires macOS Keychain")
}
func (unavailableVault) Set(string, Credentials) error {
	return errors.New("Cloud credential storage requires macOS Keychain")
}
func (unavailableVault) Delete(string) error {
	return errors.New("Cloud credential storage requires macOS Keychain")
}
