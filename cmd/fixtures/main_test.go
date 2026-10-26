package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFixtureCommand(t *testing.T) {
	old := os.Args
	t.Cleanup(func() { os.Args = old })
	t.Chdir(t.TempDir())
	for _, args := range [][]string{{"fixtures"}, {"fixtures", "custom"}} {
		os.Args = args
		main()
		dir := "fixtures"
		if len(args) > 1 {
			dir = args[1]
		}
		for _, name := range []string{"orders", "empty", "special", "million", "malformed"} {
			st, err := os.Stat(filepath.Join(dir, name+".parquet"))
			if err != nil || st.Size() == 0 {
				t.Fatal("missing fixture", name, err)
			}
		}
	}
}
