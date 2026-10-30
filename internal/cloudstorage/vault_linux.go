//go:build linux && cgo

package cloudstorage

/*
#cgo pkg-config: libsecret-1
#include <libsecret/secret.h>
#include <stdlib.h>
static const SecretSchema bamboo_schema = {
 "local.bamboo.workbench.r2", SECRET_SCHEMA_NONE,
 {{"account", SECRET_SCHEMA_ATTRIBUTE_STRING}, {NULL, 0}}
};
static gboolean bamboo_set(const char *id, const char *data, GError **error) {
 return secret_password_store_sync(&bamboo_schema, SECRET_COLLECTION_DEFAULT,
  "Bamboo cloud workspace", data, NULL, error, "account", id, NULL);
}
static char *bamboo_get(const char *id, GError **error) {
 return secret_password_lookup_sync(&bamboo_schema, NULL, error, "account", id, NULL);
}
static void bamboo_delete(const char *id, GError **error) {
 secret_password_clear_sync(&bamboo_schema, NULL, error, "account", id, NULL);
}
*/
import "C"
import (
	"encoding/json"
	"errors"
	"unsafe"
)

type secretVault struct{}

// NewVault stores credentials through the desktop's Secret Service via libsecret.
// A missing or locked service is an error; no file-based fallback is used.
func NewVault() Vault { return secretVault{} }
func secretError(e *C.GError) error {
	if e == nil {
		return nil
	}
	C.g_error_free(e)
	return errors.New("cloud credentials unavailable; install or unlock a Secret Service such as GNOME Keyring")
}
func (secretVault) Set(id string, cred Credentials) error {
	data, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	defer clear(data)
	account, value := C.CString(id), C.CString(string(data))
	defer C.free(unsafe.Pointer(account))
	defer C.secret_password_free(value)
	var failure *C.GError
	ok := C.bamboo_set(account, value, &failure)
	if err := secretError(failure); err != nil {
		return err
	}
	if ok == 0 {
		return errors.New("could not save cloud credentials in Secret Service")
	}
	return nil
}
func (secretVault) Get(id string) (Credentials, error) {
	account := C.CString(id)
	defer C.free(unsafe.Pointer(account))
	var failure *C.GError
	value := C.bamboo_get(account, &failure)
	if err := secretError(failure); err != nil {
		return Credentials{}, err
	}
	if value == nil {
		return Credentials{}, errors.New("cloud credentials not found; reconnect this workspace")
	}
	defer C.secret_password_free(value)
	data := []byte(C.GoString(value))
	defer clear(data)
	var result Credentials
	err := json.Unmarshal(data, &result)
	return result, err
}
func (secretVault) Delete(id string) error {
	account := C.CString(id)
	defer C.free(unsafe.Pointer(account))
	var failure *C.GError
	C.bamboo_delete(account, &failure)
	return secretError(failure)
}
