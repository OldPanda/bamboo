package testutil

import (
	"os"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

// Private verifies a protected ACL granting access only to the current user/System.
// Windows POSIX mode bits do not express these protections.
func Private(t *testing.T, path string, _ os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatal(err)
	}
	flags := ""
	if info.IsDir() {
		flags = "OICI"
	}
	expected, err := windows.SecurityDescriptorFromString("D:P(A;" + flags + ";FA;;;" + user.User.Sid.String() + ")(A;" + flags + ";FA;;;SY)")
	if err != nil {
		t.Fatal(err)
	}
	if sd.String() != expected.String() {
		t.Fatalf("unexpected privacy ACL: %s", sd.String())
	}
}

// DenyRead denies directory listing to this user and restores its original ACL.
func DenyRead(t *testing.T, path string) {
	t.Helper()
	original, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatal(err)
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	old := original.String()
	index := strings.Index(old, "(")
	if index < 0 {
		t.Fatal("directory has no ACL")
	}
	deny, err := windows.SecurityDescriptorFromString(old[:index] + "(D;;FR;;;" + user.User.Sid.String() + ")" + old[index:])
	if err != nil {
		t.Fatal(err)
	}
	set := func(sd *windows.SECURITY_DESCRIPTOR) error {
		acl, _, err := sd.DACL()
		if err != nil {
			return err
		}
		return windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil)
	}
	if err := set(deny); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := set(original); err != nil {
			t.Error(err)
		}
	})
}
