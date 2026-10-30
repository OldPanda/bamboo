package cloudstorage

import (
	"bamboo/internal/engine"
	"bamboo/internal/fixtures"
	"bamboo/internal/testutil"
	"bamboo/internal/workspace"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type memoryVault struct {
	data map[string]Credentials
	fail bool
}

func (v *memoryVault) Get(k string) (Credentials, error) {
	c, ok := v.data[k]
	if !ok {
		return c, fmt.Errorf("missing test credentials")
	}
	return c, nil
}
func (v *memoryVault) Set(k string, c Credentials) error {
	if v.fail {
		return fmt.Errorf("test vault unavailable")
	}
	v.data[k] = c
	return nil
}
func (v *memoryVault) Delete(k string) error { delete(v.data, k); return nil }
func input() ConnectInput {
	return ConnectInput{Name: "R2 test", Endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", Bucket: "test-bucket", Prefix: "data", AccessKey: "synthetic-access", SecretKey: "synthetic-secret"}
}
func req(q string) engine.Request { return engine.Request{SQL: q, Limit: 100} }
func testStore(t *testing.T, handler http.HandlerFunc) (*Store, *httptest.Server, *memoryVault) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	v := &memoryVault{data: map[string]Credentials{}}
	s := New(t.TempDir(), v)
	s.clientFactory = func(c Config, cred Credentials) *Client { c.Endpoint = server.URL; return newClient(c, cred) }
	return s, server, v
}
func listingXML(prefix string) string {
	return `<ListBucketResult><EncodingType>url</EncodingType><Contents><Key>` + prefix + `orders.parquet</Key></Contents><Contents><Key>` + prefix + `notes.txt</Key></Contents><CommonPrefixes><Prefix>` + prefix + `nested/</Prefix></CommonPrefixes></ListBucketResult>`
}
func TestNormalize(t *testing.T) {
	for _, f := range []func(*ConnectInput){func(i *ConnectInput) { i.Endpoint = "http://localhost" }, func(i *ConnectInput) { i.Endpoint += "?token=x" }, func(i *ConnectInput) { i.Endpoint = "https://evil.example" }, func(i *ConnectInput) {
		i.Endpoint = "https://user@0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"
	}, func(i *ConnectInput) { i.Bucket = "../escape" }, func(i *ConnectInput) { i.Prefix = "../private" }, func(i *ConnectInput) { i.AccessKey = "" }, func(i *ConnectInput) { i.SecretKey = "x\ny" }, func(i *ConnectInput) { i.Name = strings.Repeat("x", 201) }} {
		i := input()
		f(&i)
		if _, _, e := normalize(i); e == nil {
			t.Fatalf("accepted %#v", i)
		}
	}
	i := input()
	i.Name = ""
	i.Endpoint += "/"
	i.Prefix = "/data/"
	c, _, e := normalize(i)
	if e != nil || c.Name != "test-bucket / data" || c.Prefix != "data" {
		t.Fatal(c, e)
	}
	for _, s := range []string{"../x", "/x", "a//b", "a/../b", "x\\y", "a*", ".", ""} {
		if validRelative(s) {
			t.Fatal(s)
		}
	}
}
func TestStoreLifecycle(t *testing.T) {
	s, _, v := testStore(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Query().Get("list-type") != "2" {
			t.Error("unexpected request")
		}
		if !strings.Contains(r.Header.Get("Authorization"), "Credential=synthetic-access/") || !strings.Contains(r.Header.Get("Authorization"), "/auto/s3/aws4_request") {
			t.Error("missing SigV4")
		}
		fmt.Fprint(w, listingXML("data/"))
	})
	ctx := context.Background()
	info, e := s.Connect(ctx, input())
	if e != nil {
		t.Fatal(e)
	}
	root := info.Root
	b, _ := os.ReadFile(s.filename)
	if bytes.Contains(b, []byte("synthetic")) {
		t.Fatal("credentials persisted in settings")
	}
	testutil.Private(t, s.filename, 0600)
	page, e := s.List(ctx, root, ".", 0)
	if e != nil || len(page.Entries) != 2 || page.Entries[0].Path != "nested" {
		t.Fatal(page, e)
	}
	if _, e = s.List(ctx, root, ".", 8); e == nil {
		t.Fatal("invalid cursor")
	}
	if _, e = s.List(ctx, root, ".", -1); e == nil {
		t.Fatal("invalid page")
	}
	q, e := s.Saved(root, ".")
	if e != nil || q.Draft != "" {
		t.Fatal(q, e)
	}
	q, e = s.Saved(root, "orders.parquet")
	if e != nil || q.Applied != workspace.DefaultSQL {
		t.Fatal(q, e)
	}
	q = workspace.Query{Draft: "SELECT draft", Applied: "SELECT 1"}
	if e = s.Save(root, ".", q); e != nil {
		t.Fatal(e)
	}
	s.Select(root, "orders.parquet")
	s.CloseFile(root, "orders.parquet")
	renamed, e := s.Rename(root, "Research")
	if e != nil || renamed.Name != "Research" {
		t.Fatal(e)
	}
	restored := New(filepath.Dir(s.filename), v)
	infos, e := restored.Restore()
	if e != nil || len(infos) != 1 || infos[0].Active != "." {
		t.Fatal(infos, e)
	}
	saved, _ := restored.Saved(root, ".")
	if saved != q {
		t.Fatal(saved)
	}
	same, e := s.Connect(ctx, input())
	if e != nil || same.Root != root || len(s.profiles) != 1 {
		t.Fatal(same, e)
	}
	if e = s.DeleteConnection(root); e != nil {
		t.Fatal(e)
	}
	if len(v.data) != 0 {
		t.Fatal("credential remains")
	}
	if _, e = s.client(root); e == nil {
		t.Fatal("closed root readable")
	}
}
func TestPagedAndEncodedListing(t *testing.T) {
	s, _, _ := testStore(t, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("continuation-token") == "" {
			io.WriteString(w, `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>opaque+cursor</NextContinuationToken><Contents><Key>data/%E7%AB%B9%20%2B%23.parquet</Key></Contents><Contents><Key>outside/escape.parquet</Key></Contents></ListBucketResult>`)
		} else {
			if q.Get("continuation-token") != "opaque+cursor" {
				t.Error(q)
			}
			fmt.Fprint(w, `<ListBucketResult><Contents><Key>data/second.parquet</Key></Contents></ListBucketResult>`)
		}
	})
	info, e := s.Connect(context.Background(), input())
	if e != nil {
		t.Fatal(e)
	}
	p, e := s.List(context.Background(), info.Root, ".", 0)
	if e != nil || !p.More || len(p.Entries) != 1 || p.Entries[0].Name != "竹 +#.parquet" {
		t.Fatal(p, e)
	}
	p, e = s.List(context.Background(), info.Root, ".", p.Next)
	if e != nil || p.More || p.Entries[0].Name != "second.parquet" {
		t.Fatal(p, e)
	}
}
func TestRemoteParquetEndToEnd(t *testing.T) {
	dir := t.TempDir()
	if e := fixtures.Generate(dir, true); e != nil {
		t.Fatal(e)
	}
	var mu sync.Mutex
	var transferred int64
	var requests []string
	s, server, _ := testStore(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("list-type") == "2" {
			fmt.Fprint(w, listingXML("data/"))
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/test-bucket/data/")
		if name == "nested/copy.parquet" {
			name = "orders.parquet"
		}
		if name == "竹 +#.parquet" {
			name = "special.parquet"
		}
		b, e := os.ReadFile(filepath.Join(dir, name))
		if e != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("ETag", `"v1"`)
		if r.Method == "HEAD" {
			w.Header().Set("Content-Length", fmt.Sprint(len(b)))
			return
		}
		if r.Header.Get("If-Match") != `"v1"` || r.Header.Get("Range") == "" {
			t.Error("unconditional/full GET")
		}
		var start, end int64
		if _, e = fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); e != nil || start < 0 || end >= int64(len(b)) {
			w.WriteHeader(416)
			return
		}
		mu.Lock()
		transferred += end - start + 1
		requests = append(requests, name)
		mu.Unlock()
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(b)))
		w.Header().Set("Content-Length", fmt.Sprint(end-start+1))
		w.WriteHeader(206)
		w.Write(b[start : end+1])
	})
	info, e := s.Connect(context.Background(), input())
	if e != nil {
		t.Fatal(e)
	}
	engineInstance := engine.New()
	defer engineInstance.Close()
	extension, _ := filepath.Abs("../../build/extensions/httpfs.duckdb_extension")
	engineInstance.SetHTTPFS(extension)
	f, e := engineInstance.OpenRemote(context.Background(), info.Root+"/orders.parquet", "orders.parquet", s.Resolver(info.Root))
	if e != nil || f.Rows != "240" {
		t.Fatal(f, e)
	}
	result, e := engineInstance.Query(context.Background(), req(`SELECT a.order_id,b.city FROM data a JOIN workspace."nested/copy.parquet" b USING(order_id) ORDER BY a.order_id`))
	if e != nil || len(result.Rows) != 100 || *result.Rows[0][0] != "1001" || !result.More {
		t.Fatal(result, e)
	}
	q := req(`SELECT * FROM workspace."orders.parquet"`)
	q.Offset = 200
	result, e = engineInstance.QueryRemoteWorkspace(context.Background(), q, s.Resolver(info.Root))
	if e != nil || len(result.Rows) != 40 || result.More {
		t.Fatal(result, e)
	}
	result, e = engineInstance.QueryRemoteWorkspace(context.Background(), req(`SELECT big_id,exact_decimal FROM workspace."竹 +#.parquet"`), s.Resolver(info.Root))
	if e != nil || *result.Rows[0][0] != "9223372036854775807" || *result.Rows[0][1] != "12345678901234567890.123456789" {
		t.Fatal(result, e)
	}
	result, e = engineInstance.QueryRemoteWorkspace(context.Background(), req(`SELECT * FROM workspace."empty.parquet"`), s.Resolver(info.Root))
	if e != nil || len(result.Rows) != 0 {
		t.Fatal(result, e)
	}
	for _, q := range []string{`SELECT * FROM workspace."../escape.parquet"`, `SELECT * FROM workspace."malformed.parquet"`, `SELECT * FROM workspace."missing.parquet"`, `SELECT * FROM read_parquet('` + server.URL + `/test-bucket/data/orders.parquet')`, `SELECT * FROM read_parquet('` + filepath.Join(dir, "orders.parquet") + `')`, `SELECT * FROM workspace."*.parquet"`, `SELECT * FROM data`, `SELECT 1; SELECT 2`, `COPY (SELECT 1) TO '/tmp/bamboo-never'`} {
		if _, e = engineInstance.QueryRemoteWorkspace(context.Background(), req(q), s.Resolver(info.Root)); e == nil {
			t.Fatalf("accepted %s", q)
		}
	}
	engineInstance.Close()
	mu.Lock()
	transferred = 0
	mu.Unlock()
	result, e = engineInstance.QueryRemoteWorkspace(context.Background(), req(`SELECT id FROM workspace."million.parquet" LIMIT 10`), s.Resolver(info.Root))
	if e != nil || len(result.Rows) != 10 {
		t.Fatal(result, e)
	}
	st, _ := os.Stat(filepath.Join(dir, "million.parquet"))
	mu.Lock()
	read := transferred
	mu.Unlock()
	if read >= st.Size() {
		t.Fatalf("selective preview read whole file: %d >= %d", read, st.Size())
	}
	t.Logf("million-row selective preview: %d bytes read of %d", read, st.Size())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = engineInstance.QueryRemoteWorkspace(ctx, req(`SELECT * FROM workspace."orders.parquet"`), s.Resolver(info.Root)); e == nil {
		t.Fatal("canceled query")
	}
	if _, e = engineInstance.Open(context.Background(), filepath.Join(dir, "orders.parquet")); e != nil {
		t.Fatal(e)
	}
	if _, e = engineInstance.Query(context.Background(), req(`SELECT * FROM workspace."orders.parquet"`)); e == nil {
		t.Fatal("remote scope leaked into local file")
	}
}
func TestRemotePreviewDoesNotRepeatRanges(t *testing.T) {
	dir := t.TempDir()
	if e := fixtures.Generate(dir, false); e != nil {
		t.Fatal(e)
	}
	var mu sync.Mutex
	heads := 0
	gets := map[string]int{}
	s, _, _ := testStore(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("list-type") == "2" {
			fmt.Fprint(w, listingXML("data/"))
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/test-bucket/data/")
		b, e := os.ReadFile(filepath.Join(dir, name))
		if e != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("ETag", `"v1"`)
		if r.Method == "HEAD" {
			mu.Lock()
			heads++
			mu.Unlock()
			w.Header().Set("Content-Length", fmt.Sprint(len(b)))
			return
		}
		if r.Header.Get("If-Match") != `"v1"` || r.Header.Get("Range") == "" {
			t.Error("unconditional/full GET")
		}
		var start, end int64
		if _, e = fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); e != nil || start < 0 || end >= int64(len(b)) {
			w.WriteHeader(416)
			return
		}
		mu.Lock()
		gets[r.Header.Get("Range")]++
		mu.Unlock()
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(b)))
		w.Header().Set("Content-Length", fmt.Sprint(end-start+1))
		w.WriteHeader(206)
		w.Write(b[start : end+1])
	})
	info, e := s.Connect(context.Background(), input())
	if e != nil {
		t.Fatal(e)
	}
	eng := engine.New()
	defer eng.Close()
	extension, _ := filepath.Abs("../../build/extensions/httpfs.duckdb_extension")
	eng.SetHTTPFS(extension)
	if _, e = eng.OpenRemote(context.Background(), info.Root+"/orders.parquet", "orders.parquet", s.Resolver(info.Root)); e != nil {
		t.Fatal(e)
	}
	for offset := 0; offset < 200; offset += 100 {
		q := req(`SELECT * FROM data`)
		q.Offset = offset
		result, e := eng.Query(context.Background(), q)
		if e != nil || len(result.Rows) != 100 {
			t.Fatal(result, e)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if heads != 1 {
		t.Fatalf("opened file issued %d cloud HEAD requests, want 1", heads)
	}
	if len(gets) == 0 {
		t.Fatal("preview did not read the object")
	}
	for rng, n := range gets {
		if n != 1 {
			t.Fatalf("range %s fetched %d times", rng, n)
		}
	}
}
func TestGatewayAndFailures(t *testing.T) {
	var failure atomic.Int64
	s, _, v := testStore(t, func(w http.ResponseWriter, r *http.Request) {
		if status := failure.Load(); status != 0 {
			w.Header().Set("Location", "https://evil.example/")
			w.WriteHeader(int(status))
			fmt.Fprint(w, "secret-access in error body")
			return
		}
		if r.URL.Query().Get("list-type") == "2" {
			fmt.Fprint(w, listingXML("data/"))
			return
		}
		w.Header().Set("Content-Length", "100")
		w.Header().Set("ETag", `"v1"`)
		if r.Method == "GET" {
			w.WriteHeader(412)
		}
	})
	info, e := s.Connect(context.Background(), input())
	if e != nil {
		t.Fatal(e)
	}
	client, _ := s.client(info.Root)
	ctx, cancel := context.WithCancel(context.Background())
	scope, e := client.scope(ctx, []string{"orders.parquet"})
	if e != nil {
		t.Fatal(e)
	}
	defer scope.Close()
	defer cancel()
	for _, method := range []string{"POST", "PUT", "DELETE"} {
		r, _ := http.NewRequest(method, scope.URLs[0], nil)
		resp, e := http.DefaultClient.Do(r)
		if e != nil || resp.StatusCode != 405 {
			t.Fatal(e)
		}
		resp.Body.Close()
	}
	for _, suffix := range []string{"?url=evil", "/other"} {
		resp, e := http.Get(scope.URLs[0] + suffix)
		if e != nil || resp.StatusCode != 404 {
			t.Fatal(e)
		}
		resp.Body.Close()
	}
	resp, e := http.Get(scope.URLs[0])
	if e != nil || resp.StatusCode != 416 {
		t.Fatal(e)
	}
	resp.Body.Close()
	r, _ := http.NewRequest("GET", scope.URLs[0], nil)
	r.Header.Set("Range", "bytes=0-9")
	resp, e = http.DefaultClient.Do(r)
	if e == nil {
		io.ReadAll(resp.Body)
		resp.Body.Close()
	}
	if e = scope.Error(); e == nil || !strings.Contains(e.Error(), "changed") {
		t.Fatal(e)
	}
	cancel()
	time.Sleep(10 * time.Millisecond)
	if _, e = http.Get(scope.URLs[0]); e == nil {
		t.Fatal("gateway remained open")
	}
	v.fail = true
	if _, e = s.Connect(context.Background(), input()); e == nil {
		t.Fatal("vault failure hidden")
	}
	v.fail = false
	for _, status := range []int{401, 403, 404, 412, 429, 500, 301} {
		failure.Store(int64(status))
		_, e = s.Connect(context.Background(), input())
		if e == nil || strings.Contains(e.Error(), "secret-access") {
			t.Fatal(status, e)
		}
	}
}

func TestCorruptStateAndAtomicPersistence(t *testing.T) {
	v := &memoryVault{data: map[string]Credentials{}}
	dir := t.TempDir()
	filename := filepath.Join(dir, "r2-workspaces.json")
	for _, body := range []string{"not json", "null", `{"r2://bad":{"info":{"root":"r2://bad"},"config":{},"queries":{}}}`, strings.Repeat("x", (8<<20)+1)} {
		os.WriteFile(filename, []byte(body), 0600)
		s := New(dir, v)
		infos, e := s.Restore()
		if e == nil || len(infos) != 0 {
			t.Fatal("corrupt state accepted", e)
		}
	}
	cfg, _, _ := normalize(input())
	p := profile{Info: workspace.Info{Root: "r2://test", Active: "."}, Config: cfg, Queries: map[string]workspace.Query{"../escape": {}}}
	b, _ := json.Marshal(map[string]profile{"r2://test": p})
	os.WriteFile(filename, b, 0600)
	if _, e := New(dir, v).Restore(); e == nil {
		t.Fatal("escaped saved query")
	}
	os.Remove(filename)
	os.Mkdir(filename, 0700)
	if _, e := New(dir, v).Restore(); e == nil {
		t.Fatal("directory settings")
	}
	badParent := filepath.Join(t.TempDir(), "file")
	os.WriteFile(badParent, []byte("x"), 0600)
	if _, e := New(badParent, v).Restore(); e == nil {
		t.Fatal("non-directory settings parent")
	}
	s, _, vault := testStore(t, func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, listingXML("data/")) })
	info, e := s.Connect(context.Background(), input())
	if e != nil {
		t.Fatal(e)
	}
	root := info.Root
	original := s.filename
	// A failed atomic rename must retain the old profile and credential.
	s.filename = filename
	next := input()
	next.Name = "Changed"
	next.SecretKey = "replacement-secret"
	if _, e = s.Connect(context.Background(), next); e == nil {
		t.Fatal("save failure ignored")
	}
	if vault.data[root].SecretKey != input().SecretKey || s.profiles[root].Info.Name != input().Name {
		t.Fatal("failed save mutated state")
	}
	if e = s.DeleteConnection(root); e == nil || vault.data[root].SecretKey != input().SecretKey {
		t.Fatal("failed close lost credentials", e)
	}
	s.filename = filepath.Join(badParent, "child")
	newInput := input()
	newInput.Bucket = "other-bucket"
	if _, e = s.Connect(context.Background(), newInput); e == nil || len(vault.data) != 1 {
		t.Fatal("failed new connection retained key", e)
	}
	s.filename = original
	if e = s.DeleteConnection(root); e != nil {
		t.Fatal(e)
	}
}
func TestStoreBoundsAndMissingCredentials(t *testing.T) {
	s, _, vault := testStore(t, func(w http.ResponseWriter, r *http.Request) {
		prefix := r.URL.Query().Get("prefix")
		fmt.Fprint(w, listingXML(prefix))
	})
	ctx := context.Background()
	info, e := s.Connect(ctx, input())
	if e != nil {
		t.Fatal(e)
	}
	root := info.Root
	if _, e = s.Saved(root, "../x"); e == nil {
		t.Fatal("invalid saved path")
	}
	if e = s.Save(root, "../x", workspace.Query{}); e == nil {
		t.Fatal("invalid save path")
	}
	if e = s.Save(root, ".", workspace.Query{Draft: strings.Repeat("x", 32769)}); e == nil {
		t.Fatal("oversize draft")
	}
	if e = s.Select(root, "../x"); e == nil {
		t.Fatal("invalid active path")
	}
	if _, e = s.Rename(root, ""); e == nil {
		t.Fatal("blank name")
	}
	if e = s.Select("r2://closed", "."); e == nil {
		t.Fatal("closed profile")
	}
	if e = s.DeleteConnection("r2://closed"); e == nil {
		t.Fatal("closed removal")
	}
	if _, e = s.List(ctx, root, "../x", 0); e == nil {
		t.Fatal("escaped directory")
	}
	if _, e = s.List(ctx, root, "nested", 0); e != nil {
		t.Fatal(e)
	}
	p := s.profiles[root]
	for i := 0; i < 256; i++ {
		p.Queries[fmt.Sprintf("q%d.parquet", i)] = workspace.Query{}
	}
	s.profiles[root] = p
	if e = s.Save(root, "extra.parquet", workspace.Query{}); e == nil {
		t.Fatal("query count unbounded")
	}
	for i := 0; i < 32; i++ {
		s.profiles[fmt.Sprint("r2://fixture/", i)] = profile{Queries: map[string]workspace.Query{}}
	}
	next := input()
	next.Bucket = "new-bucket"
	if _, e = s.Connect(ctx, next); e == nil {
		t.Fatal("profile count unbounded")
	}
	if _, e = s.Connect(ctx, input()); e != nil {
		t.Fatal("existing profile reconnect", e)
	}
	if infos, e := s.Restore(); e != nil || len(infos) != 33 {
		t.Fatal(e)
	}
	vault.Delete(root)
	if _, e = s.List(ctx, root, ".", 0); e == nil {
		t.Fatal("missing credentials ignored")
	}
	if _, e = s.Resolver(root)(ctx, []string{"orders.parquet"}); e == nil {
		t.Fatal("missing query credentials")
	}
	next = input()
	next.Endpoint = "http://evil"
	if _, e = s.Connect(ctx, next); e == nil {
		t.Fatal("invalid connection")
	}
}
func TestMalformedProtocolAndRangeResponses(t *testing.T) {
	var mode atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		switch mode.Load() {
		case 0:
			fmt.Fprint(w, "not XML")
		case 1:
			fmt.Fprint(w, strings.Repeat("x", (2<<20)+1))
		case 2:
			fmt.Fprint(w, `<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>`)
		case 3:
			w.Header().Set("Content-Length", "10")
		case 4:
			w.Header().Set("Content-Length", "10")
			w.Header().Set("ETag", `"v1"`)
			fmt.Fprint(w, "0123456789")
		case 5:
			w.Header().Set("Content-Length", "10")
			w.Header().Set("ETag", `"v1"`)
			w.Header().Set("Content-Range", "bytes 0-9/10")
			w.WriteHeader(206)
			fmt.Fprint(w, "short")
		default:
			io.WriteString(w, `<ListBucketResult><Contents><Key>data/../escape.parquet</Key></Contents><Contents><Key>data/nested/deeper/x.parquet</Key></Contents><Contents><Key>%XX</Key></Contents></ListBucketResult>`)
		}
	}))
	defer server.Close()
	cfg, cred, _ := normalize(input())
	cfg.Endpoint = server.URL
	c := newClient(cfg, cred)
	ctx := context.Background()
	for i := int32(0); i < 3; i++ {
		mode.Store(i)
		if _, e := c.list(ctx, ".", ""); e == nil {
			t.Fatal("malformed listing", i)
		}
	}
	mode.Store(3)
	if _, e := c.head(ctx, "orders.parquet"); e == nil {
		t.Fatal("missing ETag")
	}
	if _, e := c.scope(ctx, []string{"notes.txt"}); e == nil {
		t.Fatal("non-Parquet object")
	}
	for _, i := range []int32{4, 5} {
		mode.Store(i)
		if e := c.copyRange(ctx, io.Discard, Object{Key: "data/x", Size: 10, ETag: `"v1"`}, 0, 9); e == nil {
			t.Fatal("invalid range accepted", i)
		}
	}
	c.config.Prefix = ""
	if key, e := c.key("a.parquet"); e != nil || key != "a.parquet" {
		t.Fatal(key, e)
	}
	server.Close()
	if _, e := c.list(ctx, ".", ""); e == nil || strings.Contains(e.Error(), server.URL) {
		t.Fatal("transport failure redaction", e)
	}
}
