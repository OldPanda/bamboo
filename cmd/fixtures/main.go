package main

import (
	"bamboo/internal/fixtures"
	"log"
	"os"
	"path/filepath"
)

func main() {
	dir := "fixtures"
	if len(os.Args) > 1 {
		dir = os.Args[1]
	}
	dir, _ = filepath.Abs(dir)
	if err := fixtures.Generate(dir, true); err != nil {
		log.Fatal(err)
	}
	log.Print(dir)
}
