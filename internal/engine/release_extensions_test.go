//go:build bamboo_release && duckdb_use_static_lib

package engine

import (
	"database/sql"
	"testing"
)

// Exercise the actual release link: absent benchmarks must not remove formats,
// time-zone support or the capability used to load the signed cloud extension.
func TestReleaseExtensions(t *testing.T) {
	db, err := sql.Open("duckdb", "?autoinstall_known_extensions=false&autoload_known_extensions=false")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rows, err := db.Query("SELECT extension_name, installed FROM duckdb_extensions()")
	if err != nil {
		t.Fatal(err)
	}
	installed := map[string]bool{}
	for rows.Next() {
		var name string
		var present bool
		if err = rows.Scan(&name, &present); err != nil {
			t.Fatal(err)
		}
		installed[name] = present
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	for _, name := range []string{"core_functions", "icu", "json", "parquet"} {
		if !installed[name] {
			t.Fatal("required extension missing", name)
		}
	}
	for _, name := range []string{"autocomplete", "tpch", "tpcds"} {
		if installed[name] {
			t.Fatal("unused extension retained", name)
		}
	}
	var hour int
	var jsonValue string
	if err = db.QueryRow(`SELECT date_part('hour',timezone('Asia/Tokyo', TIMESTAMPTZ '2026-01-01 00:00:00+00')),json_extract('{"name":"竹"}', '$.name')::VARCHAR`).Scan(&hour, &jsonValue); err != nil {
		t.Fatal(err)
	}
	if hour != 9 || jsonValue != `"竹"` {
		t.Fatal(hour, jsonValue)
	}
}
