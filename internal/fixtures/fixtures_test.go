package fixtures

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

func TestGenerateAndReadFixtures(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "fixtures")
	if err := Generate(dir, true); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("duckdb", "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for name, want := range map[string]int{"orders": 240, "empty": 0, "special": 1, "million": 1000000} {
		var count int
		if err := db.QueryRow("SELECT count(*) FROM read_parquet(?)", filepath.Join(dir, name+".parquet")).Scan(&count); err != nil || count != want {
			t.Fatalf("%s rows=%d want %d: %v", name, count, want, err)
		}
	}
	if _, err := db.Exec("SELECT * FROM read_parquet(?)", filepath.Join(dir, "malformed.parquet")); err == nil {
		t.Fatal("malformed fixture is valid")
	}
}
func TestGenerateFailures(t *testing.T) {
	dir := t.TempDir()
	occupied := filepath.Join(dir, "occupied")
	if err := os.WriteFile(occupied, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := Generate(occupied, false); err == nil {
		t.Fatal("accepted file as directory")
	}
	blocked := filepath.Join(dir, "orders.parquet")
	if err := os.Mkdir(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	if err := Generate(dir, false); err == nil {
		t.Fatal("copy to directory succeeded")
	}
	dir = t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "malformed.parquet"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := Generate(dir, false); err == nil {
		t.Fatal("failed malformed fixture write was ignored")
	}
}
