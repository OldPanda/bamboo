package cloudstorage

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func s3Input() ConnectInput {
	return ConnectInput{Provider: "s3", Region: "us-west-2", Bucket: "analytics.bucket", Prefix: "data", AccessKey: "synthetic-access", SecretKey: "synthetic-secret", SessionToken: "synthetic-session"}
}
func TestS3ConfigurationAndIsolation(t *testing.T) {
	for _, region := range []string{"us-east-1", "us-west-2", "ap-southeast-7", "eu-central-1", "cn-north-1", "us-gov-west-1"} {
		in := s3Input()
		in.Region = region
		c, cred, err := normalize(in)
		if err != nil || c.region() != region || c.provider() != "s3" || c.label() != "AWS S3" || cred.SessionToken != in.SessionToken {
			t.Fatal(c, err)
		}
		suffix := "amazonaws.com"
		if strings.HasPrefix(region, "cn-") {
			suffix += ".cn"
		}
		if c.Endpoint != "https://s3."+region+"."+suffix {
			t.Fatal(c.Endpoint)
		}
		in.Endpoint = c.Endpoint
		if _, _, err = normalize(in); err != nil {
			t.Fatal(err)
		}
	}
	for _, change := range []func(*ConnectInput){
		func(i *ConnectInput) { i.Provider = "other" }, func(i *ConnectInput) { i.Region = "" }, func(i *ConnectInput) { i.Region = "us-east-1.evil.example" }, func(i *ConnectInput) { i.Region = "us-iso-east-1" },
		func(i *ConnectInput) { i.Endpoint = "http://localhost" }, func(i *ConnectInput) { i.Endpoint = "https://s3.us-east-1.amazonaws.com" },
		func(i *ConnectInput) { i.Bucket = "192.168.1.1" }, func(i *ConnectInput) { i.Bucket = "test--x-s3" }, func(i *ConnectInput) { i.Bucket = "test-s3alias" }, func(i *ConnectInput) { i.Bucket = "test.mrap" }, func(i *ConnectInput) { i.Bucket = "test--ol-s3" }, func(i *ConnectInput) { i.Bucket = "test--table-s3" }, func(i *ConnectInput) { i.Bucket = "xn--test" },
		func(i *ConnectInput) { i.SessionToken = "bad\ntoken" }, func(i *ConnectInput) { i.SessionToken = strings.Repeat("x", 16385) },
	} {
		in := s3Input()
		change(&in)
		if _, _, err := normalize(in); err == nil {
			t.Fatal("invalid S3 configuration accepted")
		}
	}
}

type signingTransport func(*http.Request) (*http.Response, error)

func (f signingTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestS3SignedRequestAndErrors(t *testing.T) {
	c, cred, _ := normalize(s3Input())
	client := newClient(c, cred)
	var status = 200
	client.http.Transport = signingTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "s3.us-west-2.amazonaws.com" || r.URL.Path != "/analytics.bucket/data/竹 +#.parquet" || !strings.Contains(r.Header.Get("Authorization"), "/us-west-2/s3/aws4_request") || r.Header.Get("X-Amz-Security-Token") != cred.SessionToken {
			t.Error("wrong region, token, host or object path")
		}
		if !strings.Contains(r.URL.EscapedPath(), "%23") || r.Header.Get("Range") != "bytes=0-9" {
			t.Error("lost encoding/range")
		}
		return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("secret provider response must not leak"))}, nil
	})
	for _, n := range []int{200, 301, 307, 400, 401, 403, 404, 412, 429, 500} {
		status = n
		r, err := client.request(context.Background(), "GET", "data/竹 +#.parquet", url.Values{}, map[string]string{"Range": "bytes=0-9"})
		if n == 200 {
			if err != nil {
				t.Fatal(err)
			}
			r.Body.Close()
		} else if err == nil || strings.Contains(err.Error(), cred.SessionToken) || strings.Contains(err.Error(), "secret provider response") {
			t.Fatal("unsafe error", err)
		}
	}
}
func TestS3SavedCredentialsAndLegacyR2(t *testing.T) {
	s, _, v := testStore(t, func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, listingXML("data/")) })
	ctx := context.Background()
	r2info, err := s.SaveConnection(ctx, "", input())
	if err != nil {
		t.Fatal(err)
	}
	// Recreate pre-provider metadata; its identity and R2 defaults must survive.
	legacy := s.profiles[r2info.Root]
	legacy.Config.Provider = ""
	legacy.Config.Region = ""
	s.profiles[r2info.Root] = legacy
	if err = s.persist(s.profiles); err != nil {
		t.Fatal(err)
	}
	s3info, err := s.SaveConnection(ctx, "", s3Input())
	if err != nil || !strings.HasPrefix(s3info.Root, "s3://") {
		t.Fatal(s3info, err)
	}
	list, err := s.Connections()
	if err != nil || len(list) != 2 {
		t.Fatal(list, err)
	}
	raw, _ := os.ReadFile(s.filename)
	public, _ := json.Marshal(list)
	if strings.Contains(string(raw)+string(public), "synthetic-session") || strings.Contains(string(raw), "sessionToken") {
		t.Fatal("token leaked outside vault")
	}
	reloaded := New(filepath.Dir(s.filename), v)
	got, err := reloaded.Connections()
	if err != nil || len(got) != 2 || got[0].Provider != "r2" || got[1].Provider != "s3" {
		t.Fatal(got, err)
	}
	edit := s3Input()
	edit.Name = "Renamed"
	edit.AccessKey = ""
	edit.SecretKey = ""
	edit.SessionToken = ""
	if _, err = s.SaveConnection(ctx, s3info.Root, edit); err != nil || v.data[s3info.Root].SessionToken != "synthetic-session" {
		t.Fatal("blank edit lost session", err)
	}
	edit.SessionToken = "token-only"
	if _, err = s.SaveConnection(ctx, s3info.Root, edit); err == nil {
		t.Fatal("partial rotation accepted")
	}
	if _, err = s.SaveConnection(ctx, s3info.Root, input()); err == nil {
		t.Fatal("provider changed in-place")
	}
	if _, err = s.OpenConnection(ctx, s3info.Root); err != nil {
		t.Fatal(err)
	}
	edit = s3Input()
	edit.Region = "eu-west-1"
	if _, err = s.SaveConnection(ctx, s3info.Root, edit); err == nil {
		t.Fatal("active region changed")
	}
	if err = s.Close(s3info.Root); err != nil {
		t.Fatal(err)
	}
	edit = s3Input()
	edit.SessionToken = ""
	if _, err = s.SaveConnection(ctx, s3info.Root, edit); err != nil || v.data[s3info.Root].SessionToken != "" {
		t.Fatal("rotation retained stale token", err)
	}
	if err = s.DeleteConnection(s3info.Root); err != nil || len(v.data) != 1 {
		t.Fatal("deleting S3 affected R2", err)
	}
}
