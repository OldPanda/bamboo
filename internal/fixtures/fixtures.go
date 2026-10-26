package fixtures

import (
	"database/sql"
	"fmt"
	_ "github.com/duckdb/duckdb-go/v2"
	"os"
	"path/filepath"
	"strings"
)

func Generate(dir string, large bool) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	db, err := sql.Open("duckdb", "")
	if err != nil {
		return err
	}
	defer db.Close()
	queries := map[string]string{
		"orders.parquet":  `SELECT i+1001 AS order_id, ['Kyoto','Portland','Taipei','Copenhagen'][1+i%4] AS city, 'Customer ' || lpad(i::VARCHAR,3,'0') AS customer, ((i*137%90000)::DECIMAL(12,2)/100)::DECIMAL(12,2) AS amount, DATE '2026-01-01'+(i%90)::INTEGER AS ordered_on, i%3 != 0 AS fulfilled, CASE WHEN i%7=0 THEN NULL ELSE 'Standard' END AS note FROM range(240) t(i)`,
		"special.parquet": `SELECT 9223372036854775807::BIGINT AS big_id, 18446744073709551615::UBIGINT AS unsigned_id, 12345678901234567890.123456789::DECIMAL(38,9) AS exact_decimal, TIMESTAMP_NS '2026-01-02 03:04:05.123456789' AS precise_time, TIMESTAMPTZ '2026-01-02 03:04:05+00' AS utc_time, {'label':'竹子', 'items':[1,NULL,3]} AS nested, [1,NULL,3] AS numbers, '\x00\xFF'::BLOB AS bytes, NULL::VARCHAR AS missing, ''::VARCHAR AS empty_text, '<img src=x onerror=alert(1)>' AS html, '=1+1' AS formula`,
		"empty.parquet":   `SELECT 1::BIGINT AS id, ''::VARCHAR AS label WHERE false`,
	}
	if large {
		queries["million.parquet"] = `SELECT i AS id, 'segment_' || (i%100)::VARCHAR AS segment, (i*17%100000)::DECIMAL(12,2) AS amount, TIMESTAMP '2026-01-01' + i * INTERVAL 1 SECOND AS event_time FROM range(1000000) t(i)`
	}
	for name, q := range queries {
		path := filepath.Join(dir, name)
		literal := "'" + strings.ReplaceAll(path, "'", "''") + "'"
		if _, err = db.Exec("COPY (" + q + ") TO " + literal + " (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 122880)"); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	return os.WriteFile(filepath.Join(dir, "malformed.parquet"), []byte("PAR1not a valid parquet footer"), 0644)
}
