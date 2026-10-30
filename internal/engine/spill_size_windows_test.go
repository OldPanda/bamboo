package engine

import "golang.org/x/sys/windows"

// spillFileSize reads live handle metadata. NTFS directory enumeration can
// report zero for an actively written file until the writer closes its handle.
// Metadata-only access and full sharing avoid interfering with DuckDB cleanup.
func spillFileSize(path string) (int64, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	handle, err := windows.CreateFile(name, 0, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return 0, err
	}
	defer windows.CloseHandle(handle)
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &info); err != nil {
		return 0, err
	}
	return int64(info.FileSizeHigh)<<32 | int64(info.FileSizeLow), nil
}
