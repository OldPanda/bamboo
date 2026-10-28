package cloudstorage

import (
	"container/list"
	"context"
	"errors"
	"sync"

	"golang.org/x/sync/semaphore"
)

const rangeBlockSize int64 = 8 << 20
const rangeCacheBytes = 64 << 20
const rangeCacheEntries = 256
const rangeFetchBytes int64 = 32 << 20

type rangeKey struct {
	Object     Object
	Start, End int64
}
type rangeEntry struct {
	key  rangeKey
	body []byte
}
type rangeFlight struct {
	done chan struct{}
	body []byte
	err  error
}

// A cache belongs to one scoped reader, never to saved credentials or disk.
// Payload retention is bounded independently of concurrent fetch buffers.
type rangeCache struct {
	mu      sync.Mutex
	lru     *list.List
	size    int
	pending map[rangeKey]*rangeFlight
	budget  *semaphore.Weighted
	ctx     context.Context
	cancel  context.CancelFunc
	closed  bool
}

func newRangeCache(ctx context.Context) *rangeCache {
	ctx, cancel := context.WithCancel(ctx)
	return &rangeCache{lru: list.New(), pending: make(map[rangeKey]*rangeFlight), budget: semaphore.NewWeighted(rangeFetchBytes), ctx: ctx, cancel: cancel}
}
func (c *rangeCache) close() {
	c.cancel()
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
	c.lru.Init()
	c.size = 0
}

// read returns a cached prefix or fetches at most one block, without prefetching
// bytes outside the requested interval. Contained/overlapping reads reuse bytes.
// Bodies are immutable and ownership of successful fetch buffers passes here.
func (c *rangeCache) read(ctx context.Context, o Object, start, end int64, fetch func(context.Context, int64, int64) ([]byte, error)) ([]byte, error) {
	end = min(end, start+rangeBlockSize-1)
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		c.mu.Lock()
		if c.closed || c.ctx.Err() != nil {
			c.mu.Unlock()
			return nil, context.Canceled
		}
		for el := c.lru.Front(); el != nil; el = el.Next() {
			entry := el.Value.(rangeEntry)
			if entry.key.Object != o {
				continue
			}
			if entry.key.Start <= start && entry.key.End >= start {
				last := min(end, entry.key.End)
				c.lru.MoveToFront(el)
				c.mu.Unlock()
				return entry.body[start-entry.key.Start : last-entry.key.Start+1], nil
			}
			// Stop a miss at the next cached segment instead of downloading it again.
			if entry.key.Start > start && entry.key.Start <= end {
				end = entry.key.Start - 1
			}
		}
		key := rangeKey{o, start, end}
		if f, ok := c.pending[key]; ok {
			c.mu.Unlock()
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-c.ctx.Done():
				return nil, context.Canceled
			case <-f.done:
				if ctx.Err() != nil {
					return nil, ctx.Err()
				}
				if c.ctx.Err() != nil {
					return nil, context.Canceled
				}
				// A canceled first caller must not poison another caller's read.
				if errors.Is(f.err, context.Canceled) || errors.Is(f.err, context.DeadlineExceeded) {
					continue
				}
				return f.body, f.err
			}
		}
		f := &rangeFlight{done: make(chan struct{})}
		c.pending[key] = f
		c.mu.Unlock()
		fetchCtx, cancel := context.WithCancel(ctx)
		stop := context.AfterFunc(c.ctx, cancel)
		var body []byte
		var err error
		// Budget bytes, not request count: sixteen 2 MiB column requests can
		// run together without allowing sixteen 8 MiB buffers.
		weight := end - start + 1
		err = c.budget.Acquire(fetchCtx, weight)
		if err == nil {
			body, err = fetch(fetchCtx, start, end)
			c.budget.Release(weight)
		}
		if fetchCtx.Err() != nil {
			err = fetchCtx.Err()
		}
		stop()
		cancel()
		if err == nil && int64(len(body)) != end-start+1 {
			err = errors.New("Cloud storage range transfer was interrupted")
		}
		c.mu.Lock()
		if c.closed || c.ctx.Err() != nil {
			err = context.Canceled
		}
		if err == nil {
			for c.size+len(body) > rangeCacheBytes || c.lru.Len() >= rangeCacheEntries {
				el := c.lru.Back()
				c.size -= len(el.Value.(rangeEntry).body)
				c.lru.Remove(el)
			}
			c.lru.PushFront(rangeEntry{key, body})
			c.size += len(body)
		} else {
			body = nil
		}
		f.body, f.err = body, err
		delete(c.pending, key)
		close(f.done)
		c.mu.Unlock()
		return body, err
	}
}
