//go:build bamboo_perf

// Command perf exercises the production engine without creating desktop windows.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"bamboo/internal/cloudstorage"
	"bamboo/internal/cloudstoragetest"
	"bamboo/internal/engine"
	"bamboo/internal/workspace"
)

type fixture struct {
	TargetBytes int64  `json:"target_bytes_per_file"`
	Bytes       int64  `json:"bytes"`
	Rows        int64  `json:"rows_per_file"`
	Files       int    `json:"files"`
	RowGroups   int64  `json:"row_groups_per_file"`
	Codec       string `json:"codec"`
}
type counters struct {
	Requests int64 `json:"requests"`
	Bytes    int64 `json:"object_bytes"`
	Heads    int64 `json:"heads"`
	Lists    int64 `json:"lists"`
}
type phase struct {
	Name    string    `json:"name"`
	MS      float64   `json:"ms"`
	Network *counters `json:"network,omitempty"`
	PeakRSS int64     `json:"process_peak_rss_bytes"`
	Error   string    `json:"error,omitempty"`
}
type report struct {
	Mode        string  `json:"mode"`
	DelayMS     int     `json:"delay_per_request_ms"`
	Fixture     fixture `json:"fixture"`
	Phases      []phase `json:"phases"`
	FirstPageMS float64 `json:"open_and_first_page_ms"`
	PeakRSS     int64   `json:"process_peak_rss_bytes"`
	Error       string  `json:"error,omitempty"`
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
func name(i int) string     { return fmt.Sprintf("part-%04d.parquet", i) }
func rss() int64 {
	var r syscall.Rusage
	must(syscall.Getrusage(syscall.RUSAGE_SELF, &r))
	return r.Maxrss
}                // macOS: bytes, includes native allocations.
func emit(v any) { must(json.NewEncoder(os.Stdout).Encode(v)) }

func generate(dir string, target int64, count int) fixture {
	must(os.MkdirAll(dir, 0700))
	entries, err := os.ReadDir(dir)
	must(err)
	if len(entries) != 0 {
		panic("fixture directory must be empty; existing data will not be overwritten")
	}
	db, err := sql.Open("duckdb", "?threads=2&memory_limit=256MB&max_temp_directory_size=0B")
	must(err)
	defer db.Close()
	// Hash-derived binary payload prevents a million repeated values collapsing to a few MB.
	hashes := []string{}
	for j := 0; j < 8; j++ {
		hashes = append(hashes, fmt.Sprintf("sha256(i::VARCHAR || 'bamboo-perf-v1-%d')", j))
	}
	write := func(p string, rows, offset int64) {
		q := fmt.Sprintf(`SELECT i AS id, (i%%100000)::BIGINT AS customer_id, ['view','click','purchase'][1+i%%3] AS event_type, (i%%1000000)::DECIMAL(12,2) AS amount, TIMESTAMP '2026-01-01' + i * INTERVAL 1 SECOND AS event_time, unhex(%s) AS payload FROM range(%d,%d) t(i)`, strings.Join(hashes, " || "), offset, offset+rows)
		_, err = db.Exec("COPY (" + q + ") TO " + quote(p) + " (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 122880)")
		must(err)
	}
	pilot := filepath.Join(dir, "pilot.parquet")
	pilotRows := max(int64(1024), min(int64(122880), target/300))
	write(pilot, pilotRows, 0)
	st, err := os.Stat(pilot)
	must(err)
	rows := max(int64(1024), int64(float64(target)*float64(pilotRows)/float64(st.Size())))
	must(os.Remove(pilot))
	// Calibrate actual compressed bytes, not row count or allocated/sparse file length.
	first := filepath.Join(dir, name(0))
	for attempt := 0; attempt < 3; attempt++ {
		write(first, rows, 0)
		st, err = os.Stat(first)
		must(err)
		ratio := float64(st.Size()) / float64(target)
		if ratio >= 0.9 && ratio <= 1.1 {
			break
		}
		if attempt == 2 {
			panic("fixture size failed +/-10% target")
		}
		rows = int64(float64(rows) * float64(target) / float64(st.Size()))
		must(os.Remove(first))
	}
	total := st.Size()
	for i := 1; i < count; i++ {
		p := filepath.Join(dir, name(i))
		write(p, rows, int64(i)*rows)
		s, e := os.Stat(p)
		must(e)
		if s.Size() < target*9/10 || s.Size() > target*11/10 {
			panic("small fixture size failed +/-10% target")
		}
		total += s.Size()
	}
	var groups, actualRows int64
	must(db.QueryRow("SELECT num_rows,num_row_groups FROM parquet_file_metadata(?)", first).Scan(&actualRows, &groups))
	if actualRows != rows {
		panic("fixture row count mismatch")
	}
	// Validate that every file is real, readable and has the expected row count.
	var allRows int64
	must(db.QueryRow("SELECT sum(num_rows) FROM parquet_file_metadata(?)", filepath.Join(dir, "*.parquet")).Scan(&allRows))
	if allRows != rows*int64(count) {
		panic("fixture total row count mismatch")
	}
	return fixture{target, total, rows, count, groups, "ZSTD; 256-byte deterministic high-entropy BLOB; row group target 122880 rows"}
}

// Disk-backed protocol fixture: never os.ReadFile a multi-GB object. It runs in
// this child process, so RSS includes its small streaming buffers, not fixture generation.
type objectServer struct {
	http                          *httptest.Server
	transport                     *http.Transport
	requests, bytes, heads, lists atomic.Int64
}

func (s *objectServer) stats() counters {
	return counters{s.requests.Load(), s.bytes.Load(), s.heads.Load(), s.lists.Load()}
}
func serve(dir string, count, delay int) (*objectServer, http.RoundTripper) {
	s := &objectServer{transport: &http.Transport{Proxy: nil}}
	s.http = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.requests.Add(1)
		if delay > 0 {
			select {
			case <-r.Context().Done():
				return
			case <-time.After(time.Duration(delay) * time.Millisecond):
			}
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			w.WriteHeader(405)
			return
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=fixture-access/") {
			w.WriteHeader(403)
			return
		}
		if r.URL.Query().Get("list-type") == "2" {
			s.lists.Add(1)
			start := 0
			if token := r.URL.Query().Get("continuation-token"); token != "" {
				var err error
				start, err = strconv.Atoi(token)
				if err != nil || start < 0 || start >= count {
					w.WriteHeader(400)
					return
				}
			}
			end := min(start+200, count)
			fmt.Fprint(w, "<ListBucketResult><EncodingType>url</EncodingType>")
			for i := start; i < end; i++ {
				fmt.Fprintf(w, "<Contents><Key>%s</Key></Contents>", url.PathEscape("data/"+name(i)))
			}
			if end < count {
				fmt.Fprintf(w, "<IsTruncated>true</IsTruncated><NextContinuationToken>%d</NextContinuationToken>", end)
			}
			fmt.Fprint(w, "</ListBucketResult>")
			return
		}
		n := strings.TrimPrefix(r.URL.Path, "/fixture-bucket/data/")
		if strings.Contains(n, "/") || !strings.HasPrefix(n, "part-") || filepath.Ext(n) != ".parquet" {
			http.NotFound(w, r)
			return
		}
		f, err := os.Open(filepath.Join(dir, n))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil {
			w.WriteHeader(500)
			return
		}
		w.Header().Set("ETag", `"perf-v1"`)
		if r.Method == "HEAD" {
			s.heads.Add(1)
			w.Header().Set("Content-Length", fmt.Sprint(st.Size()))
			return
		}
		var start, end int64
		if _, err = fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); err != nil || start < 0 || end < start || end >= st.Size() || r.Header.Get("If-Match") != `"perf-v1"` {
			w.WriteHeader(416)
			return
		}
		w.Header().Set("Content-Length", fmt.Sprint(end-start+1))
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, st.Size()))
		w.WriteHeader(206)
		written, _ := io.Copy(w, io.NewSectionReader(f, start, end-start+1))
		s.bytes.Add(written)
	}))
	base, err := url.Parse(s.http.URL)
	must(err)
	return s, cloudstoragetest.Transport{Base: base, RoundTripper: s.transport}
}
func (s *objectServer) close() { s.transport.CloseIdleConnections(); s.http.Close() }

func measure(dir, mode, httpfs string, delay int, meta fixture) (out report) {
	out = report{Mode: mode, DelayMS: delay, Fixture: meta, Phases: []phase{}}
	defer func() {
		out.PeakRSS = rss()
		if r := recover(); r != nil {
			out.Error = fmt.Sprint(r)
		}
	}()
	ctx := context.Background()
	e := engine.New()
	defer e.Close()
	config, err := os.MkdirTemp("", "bamboo-perf-config-")
	must(err)
	defer os.RemoveAll(config)
	var server *objectServer
	step := func(label string, fn func() error) {
		before := counters{}
		if server != nil {
			before = server.stats()
		}
		p := phase{Name: label}
		t := time.Now()
		err := fn()
		p.MS = float64(time.Since(t).Microseconds()) / 1000
		p.PeakRSS = rss()
		if server != nil {
			a := server.stats()
			p.Network = &counters{a.Requests - before.Requests, a.Bytes - before.Bytes, a.Heads - before.Heads, a.Lists - before.Lists}
		}
		if err != nil {
			p.Error = err.Error()
		}
		out.Phases = append(out.Phases, p)
		must(err)
	}
	var localResolve func(string) (string, error)
	var remoteResolve engine.RemoteResolver
	if mode == "remote" {
		var tr http.RoundTripper
		server, tr = serve(dir, meta.Files, delay)
		defer server.close()
		store := cloudstorage.NewWithTransport(config, &cloudstoragetest.Vault{}, tr)
		var info *workspace.Info
		step("connect_workspace", func() error { info, err = store.Connect(ctx, cloudstoragetest.Input()); return err })
		defer store.Close(info.Root)
		remoteResolve = store.Resolver(info.Root)
		e.SetHTTPFS(httpfs)
		step("list_first_page", func() error {
			p, err := store.List(ctx, info.Root, ".", 0)
			if err == nil && len(p.Entries) != min(200, meta.Files) {
				return errors.New("listing count mismatch")
			}
			return err
		})
		if meta.Files > 1 {
			step("list_all", func() error {
				offset, total := 0, 0
				for {
					p, err := store.List(ctx, info.Root, ".", offset)
					if err != nil {
						return err
					}
					total += len(p.Entries)
					if !p.More {
						break
					}
					offset = p.Next
				}
				if total != meta.Files {
					return errors.New("listing total mismatch")
				}
				return nil
			})
		}
	} else {
		store := workspace.New(config)
		var info *workspace.Info
		step("connect_workspace", func() error { info, err = store.Use(dir); return err })
		localResolve = func(ref string) (string, error) { return store.Resolve(info.Root, ref) }
		step("list_first_page", func() error {
			p, err := store.List(info.Root, ".", 0)
			if err == nil && len(p.Entries) != min(200, meta.Files) {
				return errors.New("listing count mismatch")
			}
			return err
		})
		if meta.Files > 1 {
			step("list_all", func() error {
				offset, total := 0, 0
				for {
					p, err := store.List(info.Root, ".", offset)
					if err != nil {
						return err
					}
					total += len(p.Entries)
					if !p.More {
						break
					}
					offset = p.Next
				}
				if total != meta.Files {
					return errors.New("listing total mismatch")
				}
				return nil
			})
		}
	}
	beforeOpen := counters{}
	if server != nil {
		beforeOpen = server.stats()
	}
	t := time.Now()
	step("open_metadata", func() error {
		var f *engine.File
		if mode == "remote" {
			f, err = e.OpenRemote(ctx, "r2://fixture-bucket/data/"+name(0), name(0), remoteResolve)
		} else {
			f, err = e.OpenScoped(ctx, filepath.Join(dir, name(0)), localResolve)
		}
		if err == nil && f.Rows != strconv.FormatInt(meta.Rows, 10) {
			return errors.New("metadata rows mismatch")
		}
		return err
	})
	query := func(label, sql string, offset, expected int, check func(*engine.Result) error) {
		step(label, func() error {
			before := counters{}
			if server != nil {
				before = server.stats()
			}
			r, err := e.Query(ctx, engine.Request{SQL: sql, Limit: 100, Offset: offset})
			if err != nil {
				return err
			}
			if server != nil && (label == "repeat_page" || label == "next_page") && server.stats().Bytes != before.Bytes {
				return errors.New("warm preview unexpectedly downloaded object bytes")
			}
			if len(r.Rows) != expected {
				return fmt.Errorf("expected %d rows, got %d", expected, len(r.Rows))
			}
			if check != nil {
				return check(r)
			}
			return nil
		})
	}
	pageCheck := func(start int) func(*engine.Result) error {
		return func(r *engine.Result) error {
			if !r.More {
				return errors.New("missing more rows")
			}
			for i, row := range r.Rows {
				if row[0] == nil || *row[0] != strconv.Itoa(start+i) {
					return errors.New("page id mismatch")
				}
			}
			return nil
		}
	}
	query("first_page", "SELECT * FROM data", 0, 100, pageCheck(0))
	out.FirstPageMS = float64(time.Since(t).Microseconds()) / 1000
	// Structural regression gate: opening a large object must stay a partial read.
	if server != nil && meta.TargetBytes >= 128<<20 && server.stats().Bytes-beforeOpen.Bytes > meta.Bytes/int64(meta.Files)/2 {
		panic("first page fetched more than half of the large object")
	}
	query("repeat_page", "SELECT * FROM data", 0, 100, pageCheck(0))
	query("next_page", "SELECT * FROM data", 100, 100, pageCheck(100))
	query("projection", "SELECT id, amount FROM data", 0, 100, pageCheck(0))
	query("last_row_filter", fmt.Sprintf("SELECT id FROM data WHERE id = %d", meta.Rows-1), 0, 1, func(r *engine.Result) error {
		if r.Rows[0][0] == nil || *r.Rows[0][0] != fmt.Sprint(meta.Rows-1) {
			return errors.New("filter mismatch")
		}
		return nil
	})
	query("aggregate", "SELECT sum(amount)::BIGINT FROM data", 0, 1, func(r *engine.Result) error {
		n := meta.Rows
		whole, rem := n/1000000, n%1000000
		expected := whole*999999*1000000/2 + rem*(rem-1)/2
		if r.Rows[0][0] == nil || *r.Rows[0][0] != fmt.Sprint(expected) {
			return errors.New("aggregate mismatch")
		}
		return nil
	})
	if meta.Files > 1 {
		refs := min(32, meta.Files)
		terms := []string{}
		for i := 0; i < refs; i++ {
			terms = append(terms, fmt.Sprintf(`SELECT count(*) AS n FROM workspace."%s"`, name(i)))
		}
		step("cross_file_count", func() error {
			req := engine.Request{SQL: "SELECT sum(n)::BIGINT FROM (" + strings.Join(terms, " UNION ALL ") + ")", Limit: 100}
			var r *engine.Result
			if mode == "remote" {
				r, err = e.QueryRemoteWorkspace(ctx, req, remoteResolve)
			} else {
				r, err = e.QueryWorkspace(ctx, req, localResolve)
			}
			if err != nil {
				return err
			}
			if len(r.Rows) != 1 || r.Rows[0][0] == nil || *r.Rows[0][0] != fmt.Sprint(meta.Rows*int64(refs)) {
				return errors.New("cross-file count mismatch")
			}
			return nil
		})
	}
	return
}
func main() {
	action := flag.String("action", "measure", "generate or measure")
	dir := flag.String("dir", "", "isolated fixture directory")
	target := flag.Int64("target", 128<<20, "actual compressed target bytes per file")
	count := flag.Int("files", 1, "fixture file count")
	mode := flag.String("mode", "local", "local or remote")
	delay := flag.Int("delay-ms", 20, "synthetic remote per-request delay")
	extension := flag.String("httpfs", "build/extensions/httpfs.duckdb_extension", "pinned extension")
	manifest := flag.String("manifest", "", "fixture JSON metadata")
	flag.Parse()
	if *dir == "" || *manifest == "" || *target < 1<<20 || *count < 1 || *count > 10000 || (*mode != "local" && *mode != "remote") || *delay < 0 {
		panic("invalid performance arguments")
	}
	p, err := filepath.Abs(*dir)
	must(err)
	if *action == "generate" {
		m := generate(p, *target, *count)
		b, err := json.MarshalIndent(m, "", "  ")
		must(err)
		must(os.WriteFile(*manifest, b, 0600))
		emit(m)
		return
	}
	if *action != "measure" {
		panic("unknown action")
	}
	var m fixture
	b, err := os.ReadFile(*manifest)
	must(err)
	must(json.Unmarshal(b, &m))
	out := measure(p, *mode, *extension, *delay, m)
	emit(out)
	if out.Error != "" {
		os.Exit(1)
	}
}
