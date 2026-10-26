//go:build darwin && cgo

package r2

/*
#cgo LDFLAGS: -framework Security -framework CoreFoundation
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdlib.h>
#include <string.h>
static CFMutableDictionaryRef bquery(const char *id) {
 CFMutableDictionaryRef q=CFDictionaryCreateMutable(NULL,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
 CFStringRef account=CFStringCreateWithCString(NULL,id,kCFStringEncodingUTF8);
 CFDictionarySetValue(q,kSecClass,kSecClassGenericPassword);
 CFDictionarySetValue(q,kSecAttrService,CFSTR("local.bamboo.workbench.r2"));
 CFDictionarySetValue(q,kSecAttrAccount,account);CFRelease(account);return q;
}
static int bset(const char *id,const void *bytes,int n) {
 CFMutableDictionaryRef q=bquery(id);CFDataRef d=CFDataCreate(NULL,bytes,n);
 CFMutableDictionaryRef attrs=CFDictionaryCreateMutable(NULL,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
 CFDictionarySetValue(attrs,kSecValueData,d);
 OSStatus status=SecItemUpdate(q,attrs);
 if(status==errSecItemNotFound){CFDictionarySetValue(q,kSecValueData,d);status=SecItemAdd(q,NULL);}
 CFRelease(attrs);CFRelease(d);CFRelease(q);return status;
}
static int bget(const char *id,void **bytes,int *n) {
 CFMutableDictionaryRef q=bquery(id);CFDictionarySetValue(q,kSecReturnData,kCFBooleanTrue);CFDictionarySetValue(q,kSecMatchLimit,kSecMatchLimitOne);
 CFTypeRef result=NULL;OSStatus status=SecItemCopyMatching(q,&result);CFRelease(q);
 if(status==errSecSuccess){*n=(int)CFDataGetLength((CFDataRef)result);*bytes=malloc(*n);if(*bytes)memcpy(*bytes,CFDataGetBytePtr((CFDataRef)result),*n);else status=errSecAllocate;CFRelease(result);}return status;
}
static int bdelete(const char *id) {CFMutableDictionaryRef q=bquery(id);OSStatus status=SecItemDelete(q);CFRelease(q);return status==errSecItemNotFound?0:status;}
*/
import "C"
import (
	"encoding/json"
	"fmt"
	"unsafe"
)

type keychain struct{}

func NewVault() Vault { return keychain{} }
func (keychain) Set(id string, cred Credentials) error {
	b, _ := json.Marshal(cred)
	defer clear(b)
	cid := C.CString(id)
	defer C.free(unsafe.Pointer(cid))
	status := C.bset(cid, unsafe.Pointer(&b[0]), C.int(len(b)))
	if status != 0 {
		return fmt.Errorf("could not save R2 credentials in Keychain (status %d)", int(status))
	}
	return nil
}
func (keychain) Get(id string) (Credentials, error) {
	cid := C.CString(id)
	defer C.free(unsafe.Pointer(cid))
	var b unsafe.Pointer
	var n C.int
	status := C.bget(cid, &b, &n)
	if status != 0 {
		return Credentials{}, fmt.Errorf("R2 credentials unavailable; reconnect or unlock Keychain (status %d)", int(status))
	}
	defer C.free(b)
	data := C.GoBytes(b, n)
	defer clear(data)
	var c Credentials
	if json.Unmarshal(data, &c) != nil {
		return c, fmt.Errorf("R2 credentials are invalid; reconnect this workspace")
	}
	return c, nil
}
func (keychain) Delete(id string) error {
	cid := C.CString(id)
	defer C.free(unsafe.Pointer(cid))
	if s := C.bdelete(cid); s != 0 {
		return fmt.Errorf("could not remove R2 credentials from Keychain (status %d)", int(s))
	}
	return nil
}
