//go:build windows && cgo

package cloudstorage

/*
#cgo LDFLAGS: -ladvapi32
#include <windows.h>
#include <wincred.h>
#include <stdlib.h>
static DWORD bamboo_set(WCHAR *id, BYTE *data, DWORD size) {
 CREDENTIALW cred = {0};
 cred.Type = CRED_TYPE_GENERIC;
 cred.TargetName = id;
 cred.CredentialBlob = data;
 cred.CredentialBlobSize = size;
 cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
 return CredWriteW(&cred, 0) ? 0 : GetLastError();
}
static DWORD bamboo_get(WCHAR *id, PCREDENTIALW *cred) {
 return CredReadW(id, CRED_TYPE_GENERIC, 0, cred) ? 0 : GetLastError();
}
static DWORD bamboo_delete(WCHAR *id) {
 if (CredDeleteW(id, CRED_TYPE_GENERIC, 0)) return 0;
 DWORD err = GetLastError();
 return err == ERROR_NOT_FOUND ? 0 : err;
}
static void bamboo_free(PCREDENTIALW cred) {
 SecureZeroMemory(cred->CredentialBlob, cred->CredentialBlobSize);
 CredFree(cred);
}
*/
import "C"
import (
	"encoding/json"
	"fmt"
	"golang.org/x/sys/windows"
	"unsafe"
)

type credentialVault struct{}

// NewVault uses the current user's Windows Credential Manager, never a plaintext fallback.
func NewVault() Vault { return credentialVault{} }
func credentialTarget(id string) (*C.WCHAR, error) {
	p, err := windows.UTF16PtrFromString("local.bamboo.workbench.r2/" + id)
	return (*C.WCHAR)(unsafe.Pointer(p)), err
}
func (credentialVault) Set(id string, cred Credentials) error {
	target, err := credentialTarget(id)
	if err != nil {
		return err
	}
	data, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	defer clear(data)
	if status := C.bamboo_set(target, (*C.BYTE)(unsafe.Pointer(&data[0])), C.DWORD(len(data))); status != 0 {
		return fmt.Errorf("could not save cloud credentials in Windows Credential Manager (status %d)", status)
	}
	return nil
}
func (credentialVault) Get(id string) (Credentials, error) {
	target, err := credentialTarget(id)
	if err != nil {
		return Credentials{}, err
	}
	var cred C.PCREDENTIALW
	if status := C.bamboo_get(target, &cred); status != 0 {
		return Credentials{}, fmt.Errorf("cloud credentials unavailable; reconnect or unlock Windows Credential Manager (status %d)", status)
	}
	defer C.bamboo_free(cred)
	data := C.GoBytes(unsafe.Pointer(cred.CredentialBlob), C.int(cred.CredentialBlobSize))
	defer clear(data)
	var result Credentials
	err = json.Unmarshal(data, &result)
	return result, err
}
func (credentialVault) Delete(id string) error {
	target, err := credentialTarget(id)
	if err != nil {
		return err
	}
	if status := C.bamboo_delete(target); status != 0 {
		return fmt.Errorf("could not remove cloud credentials from Windows Credential Manager (status %d)", status)
	}
	return nil
}
