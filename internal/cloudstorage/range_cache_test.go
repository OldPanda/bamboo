package cloudstorage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRangeCacheLargeOverlapAndIsolation(t *testing.T) {
	c := newRangeCache(context.Background())
	defer c.close()
	o := Object{Key: "data/a.parquet", Size: 100 << 20, ETag: "v1"}
	var fetched [][2]int64
	fetch := func(_ context.Context, a, b int64) ([]byte, error) {
		fetched = append(fetched, [2]int64{a, b})
		return bytes.Repeat([]byte{byte(a % 251)}, int(b-a+1)), nil
	}
	read := func(o Object, a, b int64) []byte {
		t.Helper()
		body, e := c.read(context.Background(), o, a, b, fetch)
		if e != nil {
			t.Fatal(e)
		}
		return body
	}
	if len(read(o, 0, 12<<20)) != int(rangeBlockSize) {
		t.Fatal("unbounded block")
	}
	if len(read(o, 100, 199)) != 100 || len(fetched) != 1 {
		t.Fatal("contained read fetched again")
	}
	// An overlapping range returns its cached prefix, then only fetches the missing tail.
	if len(read(o, rangeBlockSize-10, rangeBlockSize+9)) != 10 {
		t.Fatal("cached prefix lost")
	}
	read(o, rangeBlockSize, rangeBlockSize+9)
	if len(fetched) != 2 || fetched[1] != [2]int64{rangeBlockSize, rangeBlockSize + 9} {
		t.Fatal(fetched)
	}
	changed := o
	changed.ETag = "v2"
	read(changed, 0, 99)
	other := o
	other.Key = "data/b.parquet"
	read(other, 0, 99)
	resized := o
	resized.Size++
	read(resized, 0, 99)
	if len(fetched) != 5 {
		t.Fatal("cache crossed object/version/size boundary", fetched)
	}
}

func TestRangeCacheBoundsAndLRUEviction(t *testing.T) {
	c := newRangeCache(context.Background())
	defer c.close()
	o := Object{Key: "big", Size: 200 << 20, ETag: "v1"}
	calls := 0
	fetch := func(_ context.Context, a, b int64) ([]byte, error) { calls++; return make([]byte, b-a+1), nil }
	read := func(i int) {
		t.Helper()
		_, e := c.read(context.Background(), o, int64(i)*rangeBlockSize, int64(i+1)*rangeBlockSize-1, fetch)
		if e != nil {
			t.Fatal(e)
		}
	}
	for i := 0; i < 8; i++ {
		read(i)
	}
	read(0)
	read(8)
	read(0)
	if calls != 9 || c.size > rangeCacheBytes {
		t.Fatal("recent block was evicted or cache exceeded budget", calls, c.size)
	}
	read(1)
	if calls != 10 {
		t.Fatal("least recent block was not evicted")
	}
	c.close()
	if c.size != 0 || c.lru.Len() != 0 {
		t.Fatal("close retained buffers")
	}
	if _, e := c.read(context.Background(), o, 0, 0, fetch); !errors.Is(e, context.Canceled) {
		t.Fatal("closed cache read", e)
	}
	d := newRangeCache(context.Background())
	defer d.close()
	for i := 0; i < 300; i++ {
		if _, e := d.read(context.Background(), o, int64(i), int64(i), fetch); e != nil {
			t.Fatal(e)
		}
	}
	if d.lru.Len() > rangeCacheEntries || d.size > rangeCacheEntries {
		t.Fatal("tiny entries exceeded bound")
	}
}

func TestRangeCacheFailedLoadsAreNotRetained(t *testing.T) {
	for _, kind := range []string{"truncated", "failure", "canceled"} {
		t.Run(kind, func(t *testing.T) {
			c := newRangeCache(context.Background())
			defer c.close()
			calls := 0
			fetch := func(_ context.Context, _, _ int64) ([]byte, error) {
				calls++
				if calls == 1 {
					switch kind {
					case "truncated":
						return []byte{1}, nil
					case "failure":
						return []byte{1}, io.ErrUnexpectedEOF
					default:
						return nil, context.Canceled
					}
				}
				return bytes.Repeat([]byte{2}, 10), nil
			}
			o := Object{Key: "a", Size: 100, ETag: "v1"}
			if _, e := c.read(context.Background(), o, 0, 9, fetch); e == nil {
				t.Fatal("failure hidden")
			}
			b, e := c.read(context.Background(), o, 0, 9, fetch)
			if e != nil || len(b) != 10 || b[0] != 2 || calls != 2 {
				t.Fatal("failed data reused", b, e, calls)
			}
		})
	}
}

func TestRangeCacheConcurrentReadersAndCancellation(t *testing.T) {
	c := newRangeCache(context.Background())
	defer c.close()
	var calls atomic.Int64
	started := make(chan struct{})
	release := make(chan struct{})
	o := Object{Key: "a", Size: 100, ETag: "v1"}
	fetch := func(ctx context.Context, _, _ int64) ([]byte, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		select {
		case <-release:
			return bytes.Repeat([]byte{7}, 10), nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			b, e := c.read(context.Background(), o, 0, 9, fetch)
			if e != nil || len(b) != 10 || b[0] != 7 {
				t.Errorf("shared load: %v %v", b, e)
			}
		}()
	}
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := c.read(ctx, o, 0, 9, fetch); !errors.Is(e, context.Canceled) {
		t.Fatal("canceled reader waited", e)
	}
	close(release)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatal("duplicate concurrent fetch", calls.Load())
	}
	// Closing the scope cancels in-flight work and cannot repopulate the cache.
	started = make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, e := c.read(context.Background(), o, 20, 29, func(ctx context.Context, _, _ int64) ([]byte, error) {
			close(started)
			<-ctx.Done()
			return nil, ctx.Err()
		})
		done <- e
	}()
	<-started
	c.close()
	if e := <-done; !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	if c.size != 0 {
		t.Fatal("closed cache repopulated")
	}
}

func TestGatewayCachesLargeRangesAndReopenChecksVersion(t *testing.T) {
	const size = 40 << 20
	var gets atomic.Int64
	var version atomic.Int64
	version.Store(1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		v := version.Load()
		tag := fmt.Sprintf(`"v%d"`, v)
		w.Header().Set("ETag", tag)
		if r.Method == "HEAD" {
			w.Header().Set("Content-Length", fmt.Sprint(size))
			return
		}
		gets.Add(1)
		if r.Header.Get("If-Match") != tag {
			w.WriteHeader(412)
			return
		}
		var a, b int64
		if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &a, &b); err != nil || b-a+1 > rangeBlockSize {
			t.Error("unbounded/invalid fetch")
			w.WriteHeader(416)
			return
		}
		w.Header().Set("Content-Length", fmt.Sprint(b-a+1))
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", a, b, size))
		w.WriteHeader(206)
		chunk := bytes.Repeat([]byte{byte(v)}, 64<<10)
		for remaining := b - a + 1; remaining > 0; {
			n := min(remaining, int64(len(chunk)))
			if _, e := w.Write(chunk[:n]); e != nil {
				return
			}
			remaining -= n
		}
	}))
	defer server.Close()
	c := newClient(Config{Endpoint: server.URL, Bucket: "fixture", Prefix: "data"}, Credentials{AccessKey: "synthetic", SecretKey: "synthetic"})
	scope, err := c.scope(context.Background(), []string{"large.parquet"})
	if err != nil {
		t.Fatal(err)
	}
	defer scope.Close()
	get := func(url string, a, b int64) ([]byte, int, error) {
		r, _ := http.NewRequest("GET", url, nil)
		r.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", a, b))
		resp, e := http.DefaultClient.Do(r)
		if e != nil {
			return nil, 0, e
		}
		defer resp.Body.Close()
		body, e := io.ReadAll(resp.Body)
		return body, resp.StatusCode, e
	}
	for i := 0; i < 2; i++ {
		b, status, e := get(scope.URLs[0], 0, 12<<20-1)
		if e != nil || status != 206 || len(b) != 12<<20 || !bytes.Equal(b, bytes.Repeat([]byte{1}, len(b))) {
			t.Fatal("bad large range", status, e)
		}
	}
	b, _, e := get(scope.URLs[0], 4<<20, 10<<20-1)
	if e != nil || len(b) != 6<<20 || gets.Load() != 2 {
		t.Fatal("overlap downloaded again", len(b), gets.Load(), e)
	}
	version.Store(2)
	// Existing reader is a pinned snapshot. An uncached range must reject a newer object.
	_, status, e := get(scope.URLs[0], 20<<20, 21<<20-1)
	if e != nil || status != 502 || scope.Error() == nil {
		t.Fatal("version mismatch accepted", status, e)
	}
	scope.Close()
	reopened, e := c.scope(context.Background(), []string{"large.parquet"})
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.Close()
	b, status, e = get(reopened.URLs[0], 0, 99)
	if e != nil || status != 206 || !bytes.Equal(b, bytes.Repeat([]byte{2}, 100)) {
		t.Fatal("stale data survived reopen", status, e)
	}
}

func TestRangeCacheFetchBudgetAllowsSmallParallelReads(t *testing.T) {
	for _, block := range []int64{2 << 20, 8 << 20} {
		t.Run(fmt.Sprint(block), func(t *testing.T) {
			c := newRangeCache(context.Background())
			defer c.close()
			count := int(rangeFetchBytes / block)
			started := make(chan struct{}, count)
			release := make(chan struct{})
			var wg sync.WaitGroup
			defer func() { close(release); wg.Wait() }()
			o := Object{Key: "a", ETag: "v1", Size: 128 << 20}
			for i := 0; i < count; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					_, err := c.read(context.Background(), o, int64(i)*block, int64(i+1)*block-1, func(ctx context.Context, a, b int64) ([]byte, error) {
						started <- struct{}{}
						select {
						case <-release:
							return make([]byte, b-a+1), nil
						case <-ctx.Done():
							return nil, ctx.Err()
						}
					})
					if err != nil {
						t.Error(err)
					}
				}(i)
			}
			deadline := time.NewTimer(5 * time.Second)
			defer deadline.Stop()
			for i := 0; i < count; i++ {
				select {
				case <-started:
				case <-deadline.C:
					t.Fatal("small requests serialized despite free byte budget")
				}
			}
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
			defer cancel()
			_, err := c.read(ctx, o, 64<<20, 64<<20+block-1, func(context.Context, int64, int64) ([]byte, error) {
				t.Error("fetch exceeded in-flight byte budget")
				return nil, fmt.Errorf("budget exceeded")
			})
			if !errors.Is(err, context.DeadlineExceeded) {
				t.Fatal("budget wait ignored cancellation", err)
			}
		})
	}
}
