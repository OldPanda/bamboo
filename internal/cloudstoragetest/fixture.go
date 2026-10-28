// Package cloudstoragetest supplies cloud storage fixtures with synthetic keys.
// The current fixture emulates the S3 protocol shared by R2 and AWS S3.
// It is used by tests, performance checks and the cloudsmoke build, never the production app.
package cloudstoragetest

import (
	"bamboo/internal/cloudstorage"
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Endpoint is the synthetic R2 endpoint intercepted by the fixture transport.
const Endpoint = "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"

// Vault keeps test credentials in memory and supplies synthetic defaults.
type Vault struct {
	mu   sync.Mutex
	Data map[string]cloudstorage.Credentials
}

// Get returns stored credentials or deterministic fixture credentials for id.
func (v *Vault) Get(id string) (cloudstorage.Credentials, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if c, ok := v.Data[id]; ok {
		return c, nil
	}
	token := ""
	if strings.HasPrefix(id, "s3://") {
		token = "fixture-session"
	}
	return cloudstorage.Credentials{AccessKey: "fixture-access", SecretKey: "fixture-secret", SessionToken: token}, nil
}

// Set stores test credentials in memory.
func (v *Vault) Set(id string, c cloudstorage.Credentials) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.Data == nil {
		v.Data = map[string]cloudstorage.Credentials{}
	}
	v.Data[id] = c
	return nil
}

// Delete removes stored credentials; subsequent reads use fixture defaults.
func (v *Vault) Delete(id string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	delete(v.Data, id)
	return nil
}

// Transport redirects signed cloud requests to a local fixture server.
type Transport struct {
	Base         *url.URL
	RoundTripper http.RoundTripper
}

// RoundTrip preserves the signed Host while routing the request to the test server.
func (t Transport) RoundTrip(r *http.Request) (*http.Response, error) {
	clone := r.Clone(r.Context())
	u := *r.URL
	clone.Host = r.URL.Host
	u.Host = t.Base.Host
	u.Scheme = t.Base.Scheme
	clone.URL = &u
	return t.RoundTripper.RoundTrip(clone)
}

// Server serves fixture objects and exposes request, byte and fault-injection counters.
type Server struct {
	HTTP      *httptest.Server
	Transport http.RoundTripper
	Bytes     atomic.Int64
	Requests  atomic.Int64
	Failure   atomic.Int64
	Delay     atomic.Int64
}

// New starts a local S3-protocol fixture server backed by files in dir.
func New(dir string) *Server {
	s := &Server{}
	s.HTTP = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.Requests.Add(1)
		if delay := s.Delay.Load(); delay > 0 {
			select {
			case <-r.Context().Done():
				return
			case <-time.After(time.Duration(delay) * time.Millisecond):
			}
		}
		if status := s.Failure.Load(); status != 0 {
			w.WriteHeader(int(status))
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			w.WriteHeader(405)
			return
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=fixture-access/") {
			w.WriteHeader(403)
			return
		}
		if strings.HasPrefix(r.Host, "s3.") && (!strings.Contains(r.Header.Get("Authorization"), "/us-west-2/s3/aws4_request") || r.Header.Get("X-Amz-Security-Token") != "fixture-session") {
			w.WriteHeader(403)
			return
		}
		if r.URL.Query().Get("list-type") == "2" {
			prefix := r.URL.Query().Get("prefix")
			fmt.Fprint(w, `<ListBucketResult><EncodingType>url</EncodingType>`)
			names := []string{"orders.parquet", "special.parquet", "empty.parquet", "million.parquet"}
			if strings.HasSuffix(prefix, "nested/") {
				names = []string{"copy.parquet"}
			} else {
				fmt.Fprintf(w, "<CommonPrefixes><Prefix>%s</Prefix></CommonPrefixes>", url.PathEscape(prefix+"nested/"))
			}
			for _, name := range names {
				fmt.Fprintf(w, "<Contents><Key>%s</Key></Contents>", url.PathEscape(prefix+name))
			}
			fmt.Fprint(w, `</ListBucketResult>`)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/fixture-bucket/data/")
		if name == "nested/copy.parquet" {
			name = "orders.parquet"
		}
		if strings.Contains(name, "/") {
			http.NotFound(w, r)
			return
		}
		b, e := os.ReadFile(filepath.Join(dir, name))
		if e != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("ETag", `"fixture-v1"`)
		if r.Method == "HEAD" {
			w.Header().Set("Content-Length", fmt.Sprint(len(b)))
			return
		}
		var start, end int64
		if _, e = fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); e != nil || start < 0 || end < start || end >= int64(len(b)) || r.Header.Get("If-Match") != `"fixture-v1"` {
			w.WriteHeader(416)
			return
		}
		w.Header().Set("Content-Length", fmt.Sprint(end-start+1))
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(b)))
		w.WriteHeader(206)
		n, _ := bytes.NewReader(b[start : end+1]).WriteTo(w)
		s.Bytes.Add(n)
	}))
	base, _ := url.Parse(s.HTTP.URL)
	s.Transport = Transport{base, &http.Transport{Proxy: nil}}
	return s
}

// Close stops the local fixture HTTP server.
func (s *Server) Close() { s.HTTP.Close() }

// Input returns a connection form populated with synthetic R2 credentials.
func Input() cloudstorage.ConnectInput {
	return cloudstorage.ConnectInput{Name: "R2 analytics", Endpoint: Endpoint, Bucket: "fixture-bucket", Prefix: "data", AccessKey: "fixture-access", SecretKey: "fixture-secret"}
}
