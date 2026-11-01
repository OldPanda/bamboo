package cloudstorage

import (
	"context"
	"encoding/json"
	"sort"
	"time"
)

// retainedRanges is a 30-second idle cache for one exact object
// set per client. All caches share the app-wide payload and fetch budgets.
// Every lease follows fresh signed HEADs; gateways and native databases stay new.
type retainedRanges struct {
	key         string
	cache       *rangeCache
	timer       *time.Timer
	users       int
	epoch       uint64
	invalidated bool
}

// A failed new scope must not revoke the cache leased by an existing reader.
// Prevent that cache from being retained again once its active reader closes.
func (c *Client) invalidateRangeRetention() {
	c.reuseMu.Lock()
	defer c.reuseMu.Unlock()
	if r := c.reuseCache; r != nil && r.users != 0 {
		r.invalidated = true
	} else {
		c.clearRetainedRanges()
	}
}

func (c *Client) closeRetainedRanges() {
	c.reuseMu.Lock()
	defer c.reuseMu.Unlock()
	c.clearRetainedRanges()
}

func (c *Client) discardRangeCache(cache *rangeCache) {
	c.reuseMu.Lock()
	defer c.reuseMu.Unlock()
	if c.reuseCache != nil && c.reuseCache.cache == cache {
		c.clearRetainedRanges()
	} else {
		// Concurrent fallback scopes own their cache. Their cancellation must
		// not close another scope's active lease on the retained cache.
		cache.close()
	}
}
func (c *Client) clearRetainedRanges() {
	if r := c.reuseCache; r != nil {
		if r.timer != nil {
			r.timer.Stop()
		}
		r.cache.close()
		c.reuseCache = nil
	}
}
func (c *Client) queryRangeCache(ctx context.Context, objects []Object) (*rangeCache, func()) {
	keys := []string{}
	for _, o := range objects {
		b, _ := json.Marshal(o)
		keys = append(keys, string(b))
	}
	sort.Strings(keys)
	b, _ := json.Marshal(keys)
	key := string(b)
	c.reuseMu.Lock()
	if c.reuseCache != nil && (c.reuseCache.key != key || c.reuseCache.users != 0) {
		// Concurrent independent scopes keep their existing lifetime and never evict
		// an active lease; this optimization only applies to serialized queries.
		if c.reuseCache.users != 0 {
			c.reuseMu.Unlock()
			r := newRangeCache(ctx)
			return r, r.close
		}
		c.clearRetainedRanges()
	}
	if c.reuseCache == nil {
		c.reuseCache = &retainedRanges{key: key, cache: newRangeCache(context.Background())}
	}
	r := c.reuseCache
	if r.timer != nil {
		r.timer.Stop()
		r.timer = nil
	}
	r.epoch++
	r.users++
	c.reuseMu.Unlock()
	return r.cache, func() {
		c.reuseMu.Lock()
		defer c.reuseMu.Unlock()
		r.users--
		if c.reuseCache == r && r.users == 0 {
			if r.invalidated {
				c.clearRetainedRanges()
				return
			}
			epoch := r.epoch
			r.timer = time.AfterFunc(30*time.Second, func() {
				c.reuseMu.Lock()
				defer c.reuseMu.Unlock()
				if c.reuseCache == r && r.epoch == epoch && r.users == 0 {
					c.clearRetainedRanges()
				}
			})
		}
	}
}
