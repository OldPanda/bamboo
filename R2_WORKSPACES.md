# Read-only R2 workspaces

## Connect

1. In Cloudflare, create R2 **Object Read only** credentials scoped to the intended bucket. Copy its S3 endpoint; jurisdiction-specific endpoints must match the bucket.
2. In Bamboo, choose **Open data → Cloud storage → Cloudflare R2**. Enter a name (optional), HTTPS S3 endpoint, bucket, optional folder prefix, Access Key ID and Secret Access Key.
3. Choose **Test & connect**. The connection appears in Workspaces and its independent SQL editor opens immediately. Use the table-name helper or type a query. Expand folders to browse lazily; pages contain up to 200 raw S3 entries.

```sql
SELECT a.order_id, b.city
FROM workspace."orders.parquet" a
JOIN workspace."nested/copy.parquet" b USING (order_id)
ORDER BY a.order_id
```

`data` is available only after opening a file. A query can reference at most 32 workspace files. Local and remote workspaces can coexist, but a query is scoped to its selected workspace. R2 supports preview, schema, filtering, sorting, paging, cancellation and local JSON page export. Drafts and the last successful query are restored separately. Closed workspaces are forgotten, including their credentials; reconnect to open them again.

## Data and credentials

- Only HTTPS Cloudflare R2 S3 endpoints are accepted, including supported jurisdiction variants. The transport never discovers ambient AWS credentials and never follows redirects.
- Credentials are stored through the native macOS Security framework under Bamboo's Keychain service. They are absent from JSON settings, SQL and logs; the form clears inputs on submit/close. Unlock or approve Keychain access if macOS requests it. Rebuilding an ad-hoc signed app can cause macOS to request access again.
- Metadata and SQL are stored in `~/Library/Application Support/Bamboo/r2-workspaces.json` with private file permissions and atomic replacement. No metadata is written into the bucket.
- Queries execute locally. Each query obtains current metadata, then reads selected byte ranges guarded by ETag/If-Match. It does not silently fall back to downloading entire objects. There is no persistent object cache. Different queries may observe newer versions; multiple objects do not form a transactional snapshot.
- A random, short-lived loopback capability gateway exposes only the exact objects referenced in a query. DuckDB receives no R2 credentials. Its allowed paths are those exact URLs; external access and configuration remain locked, persistent secret loading is disabled, and arbitrary file/network URLs are rejected. The gateway permits only HEAD and ranged GET; upstream transfers use chunks of at most 8 MiB. Queries expire after 15 seconds and retain existing output/memory limits.
- Source objects are read-only. Bamboo implements no remote upload/delete/rename operations. Prefix restrictions are enforced by Bamboo; Cloudflare's Object Read credentials are scoped to buckets.

## Validation and limits

Tests use a local S3-compatible protocol fixture with synthetic keys and real Parquet, plus the actual DuckDB extension. They cover listing, encoded names, Range requests, ETag changes, revoked access, malformed responses, SQL boundaries, cancellation, failed-settings rollback, exact types, joins and paging. An opt-in native Keychain test creates, updates, reads and deletes only a uniquely named synthetic entry.

Native R2 UI/IPC tests use a separate `r2smoke` build that replaces only transport and vault. Its fixture hook is excluded from the production app. Creation and restart phases verify the actual connection dialog, draft/result restoration and cascading workspace closure. Production app tests separately verify local behavior and its signature. Recorded results and screenshots are in `artifacts/r2/`.

A selective query over a 1,000,000-row, 5,166,996-byte fixture read 368,813 bytes. This is one fixture/query, not a general performance guarantee. Sorting, joins or aggregation may scan substantial remote data, consume R2 read requests, and exceed the timeout. The owner's live Cloudflare bucket still requires acceptance using credentials entered in the app. Multi-GB production workloads, other architectures/OSes, and R2 customer-provided encryption are not validated/supported in this first version.

Run `npm run coverage` for standard verification. Go tests use repository-wide instrumentation (`-coverpkg=./...`) so cross-package integration hits are counted, including the synthetic fixture server and native Keychain adapter. Prior reports used package-local instrumentation; both are ordinary-test measurements, but the increased scope must be considered when comparing them. No production file is excluded. `BAMBOO_KEYCHAIN_TEST=1` enables the temporary synthetic Keychain test and is set by the full verification script. Credentials should never be placed in repository files or command-line arguments.

Official references: [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/), [R2 credentials](https://developers.cloudflare.com/r2/api/tokens/), [DuckDB httpfs](https://duckdb.org/docs/2.0/core_extensions/httpfs/overview).
