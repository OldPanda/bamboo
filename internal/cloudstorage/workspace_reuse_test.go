package cloudstorage

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestWorkspaceRetainedRangesConcurrentBudgets(t *testing.T) {
	baseline := appRangeBytes.Load()
	clients := make([]*Client, 12)
	var wg sync.WaitGroup
	for i := range clients {
		clients[i] = &Client{}
		c := clients[i]
		t.Cleanup(c.closeRetainedRanges)
		wg.Add(1)
		go func() {
			defer wg.Done()
			o := Object{Key: "same", Size: rangeBlockSize, ETag: "same"}
			cache, release := c.queryRangeCache(context.Background(), []Object{o})
			defer release()
			body, err := cache.read(context.Background(), o, 0, o.Size-1, func(_ context.Context, first, last int64) ([]byte, error) { return make([]byte, last-first+1), nil })
			if err != nil || int64(len(body)) != rangeBlockSize {
				t.Error("concurrent read", len(body), err)
			}
			if appRangeBytes.Load() > rangeCacheBytes {
				t.Error("app cache budget exceeded")
			}
		}()
	}
	wg.Wait()
	if appRangeBytes.Load()-baseline > rangeCacheBytes {
		t.Fatal("per-client caches multiplied budget")
	}
	for _, c := range clients {
		c.closeRetainedRanges()
	}
	if appRangeBytes.Load() != baseline {
		t.Fatal("closing clients leaked global retention")
	}
	c := &Client{}
	defer c.closeRetainedRanges()
	o := []Object{{Key: "same", Size: 1, ETag: "v1"}}
	first, release := c.queryRangeCache(context.Background(), o)
	other, releaseOther := c.queryRangeCache(context.Background(), o)
	if first == other {
		t.Fatal("concurrent leases share scope cancellation")
	}
	c.discardRangeCache(other)
	if first.closed {
		t.Fatal("failed concurrent fallback canceled primary reader")
	}
	releaseOther()
	if !other.closed || first.closed {
		t.Fatal("independent lease cleanup")
	}
	release()
	again, releaseAgain := c.queryRangeCache(context.Background(), o)
	if again != first {
		t.Fatal("serialized scope failed to reuse")
	}
	releaseAgain()
	c.discardRangeCache(first)
	if c.reuseCache != nil || !first.closed {
		t.Fatal("invalid retained lease survived")
	}
}

func TestWorkspaceRetainedRangesRevalidate(t *testing.T) {
	var version, heads, gets, denied atomic.Int64
	version.Store(1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") {
			w.WriteHeader(403)
			return
		}
		if denied.Load() != 0 {
			w.WriteHeader(403)
			return
		}
		v := version.Load()
		tag := fmt.Sprintf(`"v%d"`, v)
		w.Header().Set("ETag", tag)
		if r.Method == "HEAD" {
			heads.Add(1)
			w.Header().Set("Content-Length", "100")
			return
		}
		gets.Add(1)
		if r.Header.Get("If-Match") != tag {
			w.WriteHeader(412)
			return
		}
		var a, b int
		if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &a, &b); err != nil || a < 0 || b >= 100 {
			w.WriteHeader(416)
			return
		}
		w.Header().Set("Content-Length", fmt.Sprint(b-a+1))
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/100", a, b))
		w.WriteHeader(206)
		fmt.Fprint(w, strings.Repeat(fmt.Sprint(v), b-a+1))
	}))
	defer server.Close()
	c := newClient(Config{Endpoint: server.URL, Bucket: "fixture", Prefix: "data"}, Credentials{AccessKey: "synthetic", SecretKey: "synthetic"})
	defer c.closeRetainedRanges()
	read := func(refs []string, want string) *Scope {
		t.Helper()
		s, err := c.scope(context.Background(), refs)
		if err != nil {
			t.Fatal(err)
		}
		request, _ := http.NewRequest("GET", s.URLs[0], nil)
		request.Header.Set("Range", "bytes=0-9")
		r, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(r.Body)
		r.Body.Close()
		if err != nil || string(body) != strings.Repeat(want, 10) {
			t.Fatal(string(body), err)
		}
		return s
	}
	s := read([]string{"a.parquet"}, "1")
	old := s.URLs[0]
	s.Close()
	retained := c.reuseCache.cache
	s = read([]string{"a.parquet"}, "1")
	if s.URLs[0] == old || heads.Load() != 2 || gets.Load() != 1 || c.reuseCache.cache != retained {
		t.Fatal("repeat bypassed HEAD or did not reuse bytes")
	}
	s.Close()
	if _, err := http.Get(old); err == nil {
		t.Fatal("closed gateway still reachable")
	}
	s = read([]string{"a.parquet", "b.parquet"}, "1")
	s.Close()
	if c.reuseCache.cache == retained {
		t.Fatal("changed object set reused")
	}
	retained = c.reuseCache.cache
	s = read([]string{"b.parquet", "a.parquet"}, "1")
	s.Close()
	if c.reuseCache.cache != retained {
		t.Fatal("ordering changed cache key")
	}
	version.Store(2)
	s = read([]string{"a.parquet"}, "2")
	s.Close()
	if c.reuseCache.cache == retained {
		t.Fatal("ETag changed but cache retained")
	}
	denied.Store(1)
	if _, err := c.scope(context.Background(), []string{"a.parquet"}); err == nil {
		t.Fatal("denied HEAD bypassed")
	}
	denied.Store(0)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.scope(ctx, []string{"a.parquet"}); err == nil {
		t.Fatal("canceled HEAD bypassed")
	}
	s = read([]string{"a.parquet"}, "2")
	s.Close()
	c.closeRetainedRanges()
	if c.reuseCache != nil {
		t.Fatal("client close retained cache")
	}
	t.Log("HEAD per execution, random closed gateways, object set/order, ETag, permission, cancel/recovery and cache cleanup passed")
}

func TestWorkspaceRetainedRangesIdleExpiry(t *testing.T) {
	c := &Client{}
	_, release := c.queryRangeCache(context.Background(), []Object{{Key: "synthetic", Size: 1, ETag: "v1"}})
	release()
	time.Sleep(31 * time.Second)
	c.reuseMu.Lock()
	defer c.reuseMu.Unlock()
	if c.reuseCache != nil {
		t.Fatal("idle range cache was not released")
	}
}

func TestWorkspaceHeadFailurePreservesActiveScope(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusForbidden} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var gets atomic.Int64
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/unavailable.parquet") {
					w.WriteHeader(status)
					return
				}
				w.Header().Set("ETag", `"same-version"`)
				if r.Method == http.MethodHead {
					w.Header().Set("Content-Length", "10")
					return
				}
				gets.Add(1)
				w.Header().Set("Content-Length", "10")
				w.Header().Set("Content-Range", "bytes 0-9/10")
				w.WriteHeader(http.StatusPartialContent)
				fmt.Fprint(w, "0123456789")
			}))
			defer server.Close()
			c := newClient(Config{Endpoint: server.URL, Bucket: "fixture"}, Credentials{AccessKey: "synthetic", SecretKey: "synthetic"})
			defer c.closeRetainedRanges()
			open := func() *Scope {
				t.Helper()
				s, err := c.scope(context.Background(), []string{"open.parquet"})
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(s.Close)
				return s
			}
			read := func(s *Scope) {
				t.Helper()
				req, _ := http.NewRequest(http.MethodGet, s.URLs[0], nil)
				req.Header.Set("Range", "bytes=0-9")
				r, err := http.DefaultClient.Do(req)
				if err != nil {
					t.Fatal(err)
				}
				body, err := io.ReadAll(r.Body)
				r.Body.Close()
				if err != nil || r.StatusCode != http.StatusPartialContent || string(body) != "0123456789" {
					t.Fatalf("open document lost its readable scope: status=%d body=%q error=%v", r.StatusCode, body, err)
				}
			}
			s := open()
			read(s)
			if _, err := c.scope(context.Background(), []string{"open.parquet", "unavailable.parquet"}); err == nil {
				t.Fatal("failed HEAD was accepted")
			}
			read(s)
			if gets.Load() != 1 {
				t.Fatal("active lease lost its cached range")
			}
			s.Close()
			fresh := open()
			read(fresh)
			if gets.Load() != 2 {
				t.Fatal("failed HEAD did not prevent retention after the active lease closed")
			}
			fresh.Close()
		})
	}
}
