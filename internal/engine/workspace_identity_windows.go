package engine

import (
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

func localIdentity(f *os.File, st os.FileInfo) (string, bool) {
	if st == nil {
		return "", false
	}
	var id windows.ByHandleFileInformation
	if windows.GetFileInformationByHandle(windows.Handle(f.Fd()), &id) != nil {
		return "", false
	}
	// FILE_BASIC_INFO includes ChangeTime, unlike os.FileInfo.ModTime. Some
	// filesystems do not supply it; those paths always get a fresh connection.
	var basic struct {
		CreationTime, LastAccessTime, LastWriteTime, ChangeTime int64
		FileAttributes                                          uint32
	}
	if windows.GetFileInformationByHandleEx(windows.Handle(f.Fd()), windows.FileBasicInfo, (*byte)(unsafe.Pointer(&basic)), uint32(unsafe.Sizeof(basic))) != nil || basic.ChangeTime == 0 {
		return "", false
	}
	return fmt.Sprintf("%d/%d/%d/%d", id.VolumeSerialNumber, id.FileIndexHigh, id.FileIndexLow, basic.ChangeTime), true
}
