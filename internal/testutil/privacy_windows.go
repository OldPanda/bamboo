package testutil

import (
	"os"
	"strings"
	"testing"
	"unsafe"

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
	// Elevated runners may carry an enabled backup privilege, which bypasses
	// directory read ACLs. Test normal desktop access, then restore the token.
	var token windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_ADJUST_PRIVILEGES|windows.TOKEN_QUERY, &token); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { token.Close() })
	name, _ := windows.UTF16PtrFromString("SeBackupPrivilege")
	var next, previous windows.Tokenprivileges
	next.PrivilegeCount = 1
	if err := windows.LookupPrivilegeValue(nil, name, &next.Privileges[0].Luid); err != nil {
		t.Fatal(err)
	}
	var size uint32
	if err := windows.AdjustTokenPrivileges(token, false, &next, uint32(unsafe.Sizeof(previous)), &previous, &size); err != nil && err != windows.ERROR_NOT_ALL_ASSIGNED {
		t.Fatal(err)
	}
	t.Logf("backup privilege previous count=%d attributes=%#x", previous.PrivilegeCount, previous.Privileges[0].Attributes)
	t.Cleanup(func() {
		if previous.PrivilegeCount != 0 {
			if err := windows.AdjustTokenPrivileges(token, false, &previous, 0, nil, nil); err != nil {
				t.Error(err)
			}
		}
	})
	denyAccess(t, path, "FR")
	if f, err := os.Open(path); err == nil {
		f.Close()
		t.Fatal("test directory ACL failed to deny read access")
	}
}

// DenyWrite blocks file creation in a generated directory using a native ACL.
func DenyWrite(t *testing.T, path string) {
	t.Helper()
	denyAccess(t, path, "FW")
}

func denyAccess(t *testing.T, path, access string) {
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
	deny, err := windows.SecurityDescriptorFromString(old[:index] + "(D;;" + access + ";;;" + user.User.Sid.String() + ")" + old[index:])
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
