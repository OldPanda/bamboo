package engine_test

import (
	"bamboo/internal/cloudstorage"
	"bamboo/internal/cloudstoragetest"
	"bamboo/internal/engine"
	"bamboo/internal/workspace"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"math/big"
	"os"
	"path/filepath"
	"testing"
)

// These tiny, independent fixtures use uncompressed PLAIN data and Thrift's
// compact protocol. They deliberately omit legacy scale, unlike modern writers.
// All inputs are synthetic; no third-party data or production parser is needed.
type compact []byte

func vint(v int64) []byte { return binary.AppendUvarint(nil, uint64(v<<1)^uint64(v>>63)) }
func str(v string) []byte { return append(binary.AppendUvarint(nil, uint64(len(v))), v...) }
func list(kind byte, values ...[]byte) []byte {
	b := []byte{byte(len(values))<<4 | kind}
	for _, value := range values {
		b = append(b, value...)
	}
	return b
}
func (b *compact) field(id int64, kind byte, value []byte) {
	*b = append(*b, kind) // Explicit field ID, with no delta from the previous field.
	*b = append(*b, vint(id)...)
	*b = append(*b, value...)
}
func (b compact) end() []byte { return append(b, 0) }
func integer(v int64) *int64  { return &v }

func decimalFile(t *testing.T, dir string, physical int64, width int, precision, scale *int64, values []string) string {
	t.Helper()
	var root, col, page, data, metadata, chunk, group, footer compact
	root.field(4, 8, str("schema"))
	root.field(5, 5, vint(1))
	col.field(1, 5, vint(physical))
	if physical == 7 {
		col.field(2, 5, vint(int64(width)))
	}
	col.field(3, 5, vint(1)) // OPTIONAL
	col.field(4, 8, str("value"))
	col.field(6, 5, vint(5)) // DECIMAL ConvertedType
	if scale != nil {
		col.field(7, 5, vint(*scale))
	}
	if precision != nil {
		col.field(8, 5, vint(*precision))
	}
	// Three logical rows: value, NULL, value. One bit-packed definition group.
	payload := []byte{2, 0, 0, 0, 3, 5}
	for _, value := range values {
		n, ok := new(big.Int).SetString(value, 10)
		if !ok {
			t.Fatal("invalid fixture value")
		}
		switch physical {
		case 1:
			payload = binary.LittleEndian.AppendUint32(payload, uint32(n.Int64()))
		case 2:
			payload = binary.LittleEndian.AppendUint64(payload, uint64(n.Int64()))
		default:
			if n.Sign() < 0 {
				n.Add(n, new(big.Int).Lsh(big.NewInt(1), uint(width*8)))
			}
			if physical == 6 { // BYTE_ARRAY has a little-endian length prefix.
				payload = binary.LittleEndian.AppendUint32(payload, uint32(width))
			}
			payload = append(payload, n.FillBytes(make([]byte, width))...)
		}
	}
	data.field(1, 5, vint(3))
	data.field(2, 5, vint(0)) // PLAIN
	data.field(3, 5, vint(3)) // RLE definition levels
	data.field(4, 5, vint(3)) // RLE repetition levels
	page.field(1, 5, vint(0)) // DATA_PAGE
	page.field(2, 5, vint(int64(len(payload))))
	page.field(3, 5, vint(int64(len(payload))))
	page.field(5, 12, data.end())
	encodedPage := append(page.end(), payload...)
	metadata.field(1, 5, vint(physical))
	metadata.field(2, 9, list(5, vint(0), vint(3)))
	metadata.field(3, 9, list(8, str("value")))
	metadata.field(4, 5, vint(0)) // UNCOMPRESSED
	metadata.field(5, 6, vint(3))
	metadata.field(6, 6, vint(int64(len(encodedPage))))
	metadata.field(7, 6, vint(int64(len(encodedPage))))
	metadata.field(9, 6, vint(4)) // Data page starts immediately after PAR1.
	chunk.field(2, 6, vint(4))
	chunk.field(3, 12, metadata.end())
	group.field(1, 9, list(12, chunk.end()))
	group.field(2, 6, vint(int64(len(encodedPage))))
	group.field(3, 6, vint(3))
	footer.field(1, 5, vint(1))
	footer.field(2, 9, list(12, root.end(), col.end()))
	footer.field(3, 6, vint(3))
	footer.field(4, 9, list(12, group.end()))
	meta := footer.end()
	file := append([]byte("PAR1"), encodedPage...)
	file = append(file, meta...)
	file = binary.LittleEndian.AppendUint32(file, uint32(len(meta)))
	file = append(file, "PAR1"...)
	p := filepath.Join(dir, "decimal.parquet")
	if err := os.WriteFile(p, file, 0600); err != nil {
		t.Fatal(err)
	}
	return p
}

func checkDecimals(t *testing.T, e *engine.Engine, sql, first, last string) {
	t.Helper()
	r, err := e.Query(context.Background(), engine.Request{SQL: sql, Limit: 3})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Rows) != 3 || r.Rows[0][0] == nil || *r.Rows[0][0] != first || r.Rows[1][0] != nil || r.Rows[2][0] == nil || *r.Rows[2][0] != last {
		t.Fatalf("incorrect exact decimals: %+v", r)
	}
}

func TestDecimalMetadataCompatibility(t *testing.T) {
	cases := []struct {
		name      string
		physical  int64
		width     int
		precision *int64
		scale     *int64
		first     string
		last      string
		wantFirst string
		wantLast  string
		reject    bool
	}{
		{"int32 omitted scale", 1, 4, integer(9), nil, "-123", "456", "-123", "456", false},
		{"int64 omitted scale", 2, 8, integer(18), nil, "-999999999999999999", "999999999999999999", "-999999999999999999", "999999999999999999", false},
		{"SAP fixed16 omitted scale", 7, 16, integer(9), nil, "-123", "456", "-123", "456", false},
		{"explicit scale", 7, 16, integer(9), integer(5), "-123456", "70720", "-1.23456", "0.70720", false},
		{"precision38", 7, 16, integer(38), nil, "-99999999999999999999999999999999999999", "99999999999999999999999999999999999999", "-99999999999999999999999999999999999999", "99999999999999999999999999999999999999", false},
		{"byte array", 6, 16, integer(38), nil, "-123", "456", "-123", "456", false},
		{"missing precision", 1, 4, nil, nil, "1", "2", "", "", true},
		{"zero precision", 1, 4, integer(0), nil, "1", "2", "", "", true},
		{"negative precision", 1, 4, integer(-1), nil, "1", "2", "", "", true},
		{"negative scale", 1, 4, integer(9), integer(-1), "1", "2", "", "", true},
		{"scale exceeds precision", 1, 4, integer(9), integer(10), "1", "2", "", "", true},
		{"int32 precision overflow", 1, 4, integer(10), nil, "1", "2", "", "", true},
		{"int64 precision overflow", 2, 8, integer(19), nil, "1", "2", "", "", true},
		{"fixed precision overflow", 7, 1, integer(3), nil, "1", "2", "", "", true},
		{"precision39 stays exact or rejects", 7, 17, integer(39), nil, "1", "2", "", "", true},
		{"explicit precision39 never floats", 7, 17, integer(39), integer(0), "1", "2", "", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := decimalFile(t, t.TempDir(), tc.physical, tc.width, tc.precision, tc.scale, []string{tc.first, tc.last})
			before, _ := os.ReadFile(p)
			e := engine.New()
			defer e.Close()
			f, err := e.Open(context.Background(), p)
			if tc.reject {
				if err == nil {
					t.Fatal("invalid or inexact decimal accepted", f)
				}
			} else {
				if err != nil || f.Rows != "3" {
					t.Fatal(f, err)
				}
				checkDecimals(t, e, "SELECT * FROM data", tc.wantFirst, tc.wantLast)
			}
			after, _ := os.ReadFile(p)
			if sha256.Sum256(before) != sha256.Sum256(after) {
				t.Fatal("source changed")
			}
		})
	}
}

func TestDecimalWorkspaceAndCloudRanges(t *testing.T) {
	dir := t.TempDir()
	p := decimalFile(t, dir, 7, 16, integer(9), nil, []string{"-123", "456"})
	before, _ := os.ReadFile(p)
	ctx := context.Background()
	e := engine.New()
	defer e.Close()
	ws := workspace.New(t.TempDir())
	info, err := ws.Use(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.OpenScoped(ctx, p, func(ref string) (string, error) { return ws.Resolve(info.Root, ref) }); err != nil {
		t.Fatal(err)
	}
	checkDecimals(t, e, `SELECT * FROM workspace."decimal.parquet"`, "-123", "456")
	server := cloudstoragetest.New(dir)
	defer server.Close()
	extension, err := filepath.Abs("../../build/extensions/httpfs.duckdb_extension")
	if err != nil {
		t.Fatal(err)
	}
	e.SetHTTPFS(extension)
	for _, provider := range []string{"r2", "s3"} {
		t.Run(provider, func(t *testing.T) {
			store := cloudstorage.NewWithTransport(t.TempDir(), &cloudstoragetest.Vault{}, server.Transport)
			input := cloudstoragetest.Input()
			if provider == "s3" {
				input.Provider, input.Endpoint, input.Region = "s3", "", "us-west-2"
				input.SessionToken = "fixture-session"
			}
			info, err := store.Connect(ctx, input)
			if err != nil {
				t.Fatal(err)
			}
			resolve := store.Resolver(info.Root)
			if _, err = e.OpenRemote(ctx, info.Root+"/decimal.parquet", "decimal.parquet", resolve); err != nil {
				t.Fatal(err)
			}
			checkDecimals(t, e, "SELECT * FROM data", "-123", "456")
			transferred := server.Bytes.Load()
			checkDecimals(t, e, "SELECT * FROM data", "-123", "456")
			if server.Bytes.Load() != transferred {
				t.Fatal("repeated preview downloaded data again")
			}
			checkDecimals(t, e, `SELECT * FROM workspace."decimal.parquet"`, "-123", "456")
			e.Close()
		})
	}
	after, _ := os.ReadFile(p)
	if sha256.Sum256(before) != sha256.Sum256(after) {
		t.Fatal("source changed")
	}
}
