package engine

import "golang.org/x/sys/unix"

func physicalMemoryMiB() int {
	bytes, err := unix.SysctlUint64("hw.memsize")
	if err != nil {
		return 0
	}
	return int(bytes >> 20)
}
