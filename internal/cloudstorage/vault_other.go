//go:build (!darwin && !windows && !linux) || !cgo

package cloudstorage

import "errors"

type unavailableVault struct{}

// NewVault returns a vault that reports unsupported credential storage on this platform.
func NewVault() Vault { return unavailableVault{} }
func (unavailableVault) Get(string) (Credentials, error) {
	return Credentials{}, errors.New("Secure credential storage is unavailable on this build")
}
func (unavailableVault) Set(string, Credentials) error {
	return errors.New("Secure credential storage is unavailable on this build")
}
func (unavailableVault) Delete(string) error {
	return errors.New("Secure credential storage is unavailable on this build")
}
