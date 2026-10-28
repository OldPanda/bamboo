package cloudstoragetest

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestProtocolFixtureGuards(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "orders.parquet"), []byte("fixture bytes"), 0600)
	s := New(dir)
	defer s.Close()
	send := func(method, p, auth, rng string) int {
		t.Helper()
		req, _ := http.NewRequestWithContext(context.Background(), method, s.HTTP.URL+p, nil)
		req.Header.Set("Authorization", auth)
		req.Header.Set("Range", rng)
		resp, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		return resp.StatusCode
	}
	auth := "AWS4-HMAC-SHA256 Credential=fixture-access/test"
	if send("POST", "/", auth, "") != 405 {
		t.Fatal("method guard")
	}
	if send("GET", "/", "", "") != 403 {
		t.Fatal("auth guard")
	}
	if send("GET", "/fixture-bucket/data/other/deep.parquet", auth, "") != 404 {
		t.Fatal("path guard")
	}
	if send("GET", "/fixture-bucket/data/missing.parquet", auth, "") != 404 {
		t.Fatal("missing object")
	}
	if send("GET", "/fixture-bucket/data/orders.parquet", auth, "") != 416 {
		t.Fatal("range guard")
	}
	if send("GET", "/fixture-bucket?list-type=2&prefix=data%2Fnested%2F", auth, "") != 200 {
		t.Fatal("nested listing")
	}
}
