package engine

import "golang.org/x/sys/unix"

func physicalMemoryMiB() int {
	var info unix.Sysinfo_t
	if unix.Sysinfo(&info) != nil {
		return 0
	}
	return int(uint64(info.Totalram) * uint64(info.Unit) >> 20)
}
