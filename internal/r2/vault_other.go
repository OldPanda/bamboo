//go:build !darwin || !cgo

package r2

import "errors"

type unavailableVault struct{}

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
