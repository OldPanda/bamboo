// Package r2 provides explicitly configured, read-only R2 and AWS S3 access.
// The package name and credential service are retained for existing installations. Credentials
// never enter DuckDB: a short-lived loopback gateway exposes exact object ranges.
package r2

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
)

type Config struct {
	Provider string `json:"provider,omitempty"`
	Region   string `json:"region,omitempty"`
	Name     string `json:"name"`
	Endpoint string `json:"endpoint"`
	Bucket   string `json:"bucket"`
	Prefix   string `json:"prefix"`
}
type Credentials struct {
	SessionToken string `json:"sessionToken,omitempty"`
	AccessKey    string `json:"accessKey"`
	SecretKey    string `json:"secretKey"`
}
type ConnectInput struct {
	Provider     string `json:"provider"`
	Region       string `json:"region"`
	SessionToken string `json:"sessionToken"`
	Name         string `json:"name"`
	Endpoint     string `json:"endpoint"`
	Bucket       string `json:"bucket"`
	Prefix       string `json:"prefix"`
	AccessKey    string `json:"accessKey"`
	SecretKey    string `json:"secretKey"`
}

var endpointPattern = regexp.MustCompile(`^[a-f0-9]{32}(\.(eu|us|fedramp))?\.r2\.cloudflarestorage\.com$`)
var regionPattern = regexp.MustCompile(`^((af|ap|ca|eu|il|me|mx|sa|us)-(central|east|west|north|south|northeast|northwest|southeast|southwest)-[1-9][0-9]?|us-gov-(east|west)-1|cn-(north|northwest)-1)$`)

func (c Config) provider() string {
	if c.Provider == "" {
		return "r2"
	}
	return c.Provider
}
func (c Config) label() string {
	if c.provider() == "s3" {
		return "AWS S3"
	}
	return "R2"
}
func (c Config) region() string {
	if c.provider() == "s3" {
		return c.Region
	}
	return "auto"
}

var bucketPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)

func validRelative(s string) bool {
	return s != "" && s != "." && !strings.HasPrefix(s, "/") && path.Clean(s) == s && !strings.ContainsAny(s, "\\\x00*?[]") && s != ".." && !strings.HasPrefix(s, "../") && len(s) <= 1024
}
func normalize(in ConnectInput) (Config, Credentials, error) {
	c := Config{Provider: strings.TrimSpace(in.Provider), Region: strings.TrimSpace(in.Region), Name: strings.TrimSpace(in.Name), Endpoint: strings.TrimRight(strings.TrimSpace(in.Endpoint), "/"), Bucket: strings.TrimSpace(in.Bucket), Prefix: strings.Trim(strings.TrimSpace(in.Prefix), "/")}
	if c.Provider == "" {
		c.Provider = "r2"
	}
	switch c.Provider {
	case "r2":
		c.Region = "auto"
		u, e := url.Parse(c.Endpoint)
		if e != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || !endpointPattern.MatchString(u.Host) {
			return c, Credentials{}, errors.New("enter the HTTPS R2 S3 endpoint shown in your Cloudflare account")
		}
	case "s3":
		if !regionPattern.MatchString(c.Region) {
			return c, Credentials{}, errors.New("enter the AWS region where the bucket is located, such as us-west-2")
		}
		suffix := "amazonaws.com"
		if strings.HasPrefix(c.Region, "cn-") {
			suffix += ".cn"
		}
		endpoint := "https://s3." + c.Region + "." + suffix
		if c.Endpoint != "" && c.Endpoint != endpoint {
			return c, Credentials{}, errors.New("AWS S3 endpoint must match the selected region")
		}
		c.Endpoint = endpoint
	default:
		return c, Credentials{}, errors.New("unsupported cloud provider")
	}
	if !bucketPattern.MatchString(c.Bucket) || strings.Contains(c.Bucket, "..") {
		return c, Credentials{}, errors.New("enter a valid bucket name")
	}
	if c.Provider == "s3" && (net.ParseIP(c.Bucket) != nil || strings.HasSuffix(c.Bucket, "--x-s3") || strings.HasSuffix(c.Bucket, "-s3alias") || strings.HasSuffix(c.Bucket, ".mrap") || strings.HasSuffix(c.Bucket, "--ol-s3") || strings.HasSuffix(c.Bucket, "--table-s3") || strings.HasPrefix(c.Bucket, "xn--")) {
		return c, Credentials{}, errors.New("use an S3 general purpose bucket, not an access point or directory bucket")
	}
	if c.Prefix != "" && !validRelative(c.Prefix) {
		return c, Credentials{}, errors.New("prefix must be a relative folder path without wildcards")
	}
	if c.Name == "" {
		c.Name = c.Bucket
		if c.Prefix != "" {
			c.Name += " / " + c.Prefix
		}
	}
	if len(c.Name) > 200 {
		return c, Credentials{}, errors.New("workspace name is too long")
	}
	cred := Credentials{AccessKey: strings.TrimSpace(in.AccessKey), SecretKey: strings.TrimSpace(in.SecretKey), SessionToken: strings.TrimSpace(in.SessionToken)}
	if len(cred.AccessKey) < 1 || len(cred.AccessKey) > 256 || len(cred.SecretKey) < 1 || len(cred.SecretKey) > 512 || len(cred.SessionToken) > 16384 || strings.ContainsAny(cred.AccessKey+cred.SecretKey+cred.SessionToken, "\r\n\x00") {
		return c, cred, errors.New("enter valid Access Key ID, Secret Access Key and optional Session Token")
	}
	return c, cred, nil
}

type Client struct {
	config      Config
	credentials Credentials
	http        *http.Client
}

func newClient(c Config, credentials Credentials) *Client {
	return &Client{c, credentials, &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }, Transport: &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 10 * time.Second, MaxIdleConnsPerHost: 4, IdleConnTimeout: 30 * time.Second}}}
}
func (c *Client) key(relative string) (string, error) {
	if !validRelative(relative) {
		return "", errors.New("invalid cloud object path")
	}
	if c.config.Prefix != "" {
		return c.config.Prefix + "/" + relative, nil
	}
	return relative, nil
}
func (c *Client) request(ctx context.Context, method, key string, q url.Values, headers map[string]string) (*http.Response, error) {
	u, _ := url.Parse(c.config.Endpoint)
	u.Path = "/" + c.config.Bucket
	if key != "" {
		u.Path += "/" + key
	}
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, method, u.String(), nil)
	if err != nil {
		return nil, errors.New("could not create cloud request")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	const emptySHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	req.Header.Set("X-Amz-Content-Sha256", emptySHA)
	err = v4.NewSigner().SignHTTP(ctx, aws.Credentials{AccessKeyID: c.credentials.AccessKey, SecretAccessKey: c.credentials.SecretKey, SessionToken: c.credentials.SessionToken}, req, emptySHA, "s3", c.config.region(), time.Now(), func(o *v4.SignerOptions) { o.DisableURIPathEscaping = true })
	if err != nil {
		return nil, errors.New("could not sign cloud request")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%s connection failed; check region, endpoint, network and credentials", c.config.label())
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body.Close()
		switch resp.StatusCode {
		case 301, 307, 400:
			return nil, fmt.Errorf("%s rejected the request; check bucket region and credentials (HTTP %d)", c.config.label(), resp.StatusCode)
		case 401, 403:
			return nil, fmt.Errorf("%s access denied; check read permissions and credential expiry", c.config.label())
		case 404:
			return nil, errors.New("Cloud storage bucket or object was not found")
		case 412:
			return nil, errors.New("Cloud storage object changed during this query; run the query again")
		case 429:
			return nil, errors.New("Cloud storage is rate limiting requests; try again shortly")
		}
		return nil, fmt.Errorf("%s request failed (HTTP %d)", c.config.label(), resp.StatusCode)
	}
	return resp, nil
}

type listing struct {
	Contents []struct{ Key string }    `xml:"Contents"`
	Prefixes []struct{ Prefix string } `xml:"CommonPrefixes"`
	More     bool                      `xml:"IsTruncated"`
	Next     string                    `xml:"NextContinuationToken"`
}

func (c *Client) list(ctx context.Context, rel, token string) (listing, error) {
	var out listing
	prefix := c.config.Prefix
	if prefix != "" {
		prefix += "/"
	}
	if rel != "." {
		if !validRelative(rel) {
			return out, errors.New("invalid cloud folder path")
		}
		prefix += rel + "/"
	}
	q := url.Values{"list-type": {"2"}, "prefix": {prefix}, "delimiter": {"/"}, "max-keys": {"200"}, "encoding-type": {"url"}}
	if token != "" {
		q.Set("continuation-token", token)
	}
	resp, err := c.request(ctx, http.MethodGet, "", q, nil)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20+1))
	if err != nil || len(b) > 2<<20 {
		return out, errors.New("Cloud storage directory response exceeds 2 MiB or was interrupted")
	}
	if err = xml.Unmarshal(b, &out); err != nil {
		return out, errors.New("invalid cloud directory response")
	}
	if out.More && (out.Next == "" || len(out.Next) > 8192 || out.Next == token) {
		return out, errors.New("invalid cloud pagination cursor")
	}
	return out, nil
}

type Object struct {
	Key  string
	Size int64
	ETag string
}

func (c *Client) head(ctx context.Context, relative string) (Object, error) {
	key, err := c.key(relative)
	if err != nil {
		return Object{}, err
	}
	r, err := c.request(ctx, http.MethodHead, key, nil, nil)
	if err != nil {
		return Object{}, err
	}
	r.Body.Close()
	if r.ContentLength < 0 || r.Header.Get("ETag") == "" {
		return Object{}, errors.New("Cloud storage object metadata is missing length or ETag")
	}
	return Object{key, r.ContentLength, r.Header.Get("ETag")}, nil
}
func (c *Client) copyRange(ctx context.Context, w io.Writer, o Object, start, end int64) error {
	for start <= end {
		last := min(end, start+(8<<20)-1)
		part := fmt.Sprintf("bytes=%d-%d", start, last)
		r, err := c.request(ctx, http.MethodGet, o.Key, nil, map[string]string{"Range": part, "If-Match": o.ETag})
		if err != nil {
			return err
		}
		if r.StatusCode != http.StatusPartialContent || r.ContentLength != last-start+1 || r.Header.Get("Content-Range") != fmt.Sprintf("bytes %d-%d/%d", start, last, o.Size) || r.Header.Get("ETag") != o.ETag {
			r.Body.Close()
			return errors.New("Cloud storage returned an inconsistent object range")
		}
		_, err = io.CopyN(w, r.Body, last-start+1)
		r.Body.Close()
		if err != nil {
			return errors.New("Cloud storage range transfer was interrupted")
		}
		start = last + 1
	}
	return nil
}

// Scope maps a random capability path to each explicitly authorized object. It
// accepts only HEAD and ranged GET, never follows redirects, and dies with ctx.
type Scope struct {
	URLs    []string
	Objects []Object
	Close   func()
	Error   func() error
}

func (c *Client) scope(ctx context.Context, refs []string) (*Scope, error) {
	objects := make([]Object, len(refs))
	for i, ref := range refs {
		if !strings.EqualFold(path.Ext(ref), ".parquet") {
			return nil, errors.New("choose a Parquet object")
		}
		o, err := c.head(ctx, ref)
		if err != nil {
			return nil, err
		}
		objects[i] = o
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, errors.New("could not start local cloud reader")
	}
	token := make([]byte, 32)
	if _, err = rand.Read(token); err != nil {
		listener.Close()
		return nil, err
	}
	base := "/" + hex.EncodeToString(token) + "/"
	urls := make([]string, len(refs))
	routes := map[string]Object{}
	for i, o := range objects {
		p := base + strconv.Itoa(i) + ".parquet"
		routes[p] = o
		urls[i] = "http://" + listener.Addr().String() + p
	}
	errorsCh := make(chan error, 1)
	record := func(e error) {
		select {
		case errorsCh <- e:
		default:
		}
	}
	srv := &http.Server{ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := routes[r.URL.Path]
		if !ok || r.URL.RawQuery != "" || r.Host != listener.Addr().String() {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodHead && r.Method != http.MethodGet {
			w.WriteHeader(405)
			return
		}
		if ctx.Err() != nil {
			w.WriteHeader(410)
			return
		}
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("ETag", o.ETag)
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", strconv.FormatInt(o.Size, 10))
			return
		}
		var start, end int64
		raw := r.Header.Get("Range")
		if _, e := fmt.Sscanf(raw, "bytes=%d-%d", &start, &end); e != nil || raw != fmt.Sprintf("bytes=%d-%d", start, end) || start < 0 || end < start || end >= o.Size {
			w.WriteHeader(416)
			return
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, o.Size))
		w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
		w.WriteHeader(206)
		if e := c.copyRange(ctx, w, o, start, end); e != nil {
			record(e)
		}
	})}
	go srv.Serve(listener)
	stop := context.AfterFunc(ctx, func() { srv.Close() })
	return &Scope{URLs: urls, Objects: objects, Close: func() { stop(); srv.Close(); c.http.CloseIdleConnections() }, Error: func() error {
		select {
		case e := <-errorsCh:
			return e
		default:
			return nil
		}
	}}, nil
}
