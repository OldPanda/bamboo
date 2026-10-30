package privatefs

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

func attributes(directory bool) (*windows.SecurityAttributes, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, err
	}
	flags := ""
	if directory {
		flags = "OICI"
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;" + flags + ";FA;;;" + user.User.Sid.String() + ")(A;" + flags + ";FA;;;SY)")
	if err != nil {
		return nil, err
	}
	return &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}, nil
}

// Create exclusively creates a file with a protected current-user/System ACL.
func Create(path string) (*os.File, error) {
	attr, err := attributes(false)
	if err != nil {
		return nil, err
	}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(name, windows.GENERIC_WRITE, windows.FILE_SHARE_READ, attr, windows.CREATE_NEW, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, &os.PathError{Op: "create", Path: path, Err: err}
	}
	return os.NewFile(uintptr(h), path), nil
}
func temporaryName(dir, pattern string) string {
	if dir == "" {
		dir = os.TempDir()
	}
	var nonce [16]byte
	_, _ = rand.Read(nonce[:])
	value := hex.EncodeToString(nonce[:])
	if strings.Contains(pattern, "*") {
		pattern = strings.Replace(pattern, "*", value, 1)
	} else {
		pattern += value
	}
	return filepath.Join(dir, pattern)
}

// CreateTemp creates an empty private file without inheriting permissive parent ACLs.
func CreateTemp(dir, pattern string) (*os.File, error) {
	return Create(temporaryName(dir, pattern))
}

// MkdirTemp atomically creates a private spill directory with inheritable ACLs.
func MkdirTemp(dir, pattern string) (string, error) {
	path := temporaryName(dir, pattern)
	attr, err := attributes(true)
	if err != nil {
		return "", err
	}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return "", err
	}
	if err := windows.CreateDirectory(name, attr); err != nil {
		return "", err
	}
	return path, nil
}
