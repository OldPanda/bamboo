package engine

import (
	"fmt"
	"os"
	"syscall"
)

func localIdentity(_ *os.File, st os.FileInfo) (string, bool) {
	if st == nil {
		return "", false
	}
	s, ok := st.Sys().(*syscall.Stat_t)
	if !ok {
		return "", false
	}
	return fmt.Sprintf("%d/%d/%d/%d", s.Dev, s.Ino, s.Ctim.Sec, s.Ctim.Nsec), true
}
