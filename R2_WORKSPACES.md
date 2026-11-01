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

`data` is available only after opening a file. A query can reference at most 32 workspace files. Local and remote workspaces can coexist, but a query is scoped to its selected workspace. R2 supports preview, schema, filtering, sorting, paging, cancellation and local JSON page export. Drafts and the last successful query are restored separately. Closed workspaces retain their connection, credentials and saved SQL. Reopen through Open data → Cloud storage or Settings. Explicitly deleting the connection in Settings forgets its metadata, queries and credentials and closes its open files; cloud objects are unchanged.

## Data and credentials

- For R2 connections, only HTTPS Cloudflare R2 S3 endpoints are accepted, including supported jurisdiction variants. The transport never discovers ambient AWS credentials and never follows redirects.
- Credentials are stored through the native macOS Security framework under Bamboo's Keychain service. They are absent from JSON settings, SQL and logs; the form clears inputs on submit/close. Unlock or approve Keychain access if macOS requests it. Rebuilding an ad-hoc signed app can cause macOS to request access again.
- Metadata and SQL are stored in `~/Library/Application Support/Bamboo/r2-workspaces.json` with private file permissions and atomic replacement. No metadata is written into the bucket.
- Queries execute locally. Each query obtains current metadata, then reads selected byte ranges guarded by ETag/If-Match. It does not silently fall back to downloading entire objects. There is no persistent object cache. Different queries may observe newer versions; multiple objects do not form a transactional snapshot.

- A random, short-lived loopback capability gateway exposes only the exact objects referenced in a query. DuckDB receives no R2 credentials. Its allowed paths are those exact URLs; external access and configuration remain locked, persistent secret loading is disabled, and arbitrary file/network URLs are rejected. The gateway permits only HEAD and ranged GET; upstream transfers use chunks of at most 8 MiB. Queries expire after 15 seconds and retain existing output/memory limits.
- Source objects are read-only. Bamboo implements no remote upload/delete/rename operations. Prefix restrictions are enforced by Bamboo; Cloudflare's Object Read credentials are scoped to buckets.

Workspace queries may retain validated range blocks for the same exact object
set for 30 idle seconds. Each new scope still performs signed HEAD requests and
uses new random gateway URLs and a new DuckDB connection. Object key, size and
ETag must match; access denial, credential/location changes, closing or forgetting
the connection clears retained blocks. A failed new scope leaves an existing
reader's lease usable, then releases those blocks when that reader closes.
All readers share a 64 MiB retained-payload
budget and a separate 32 MiB in-flight-fetch budget, with at most 256 entries per
cache. A full shared budget can cause uncached reads. These limits exclude native
engine memory and buffers still being sent after eviction; they do not cap RSS.

工作区查询可在空闲 30 秒内复用已验证的对象分块，但每次仍重新进行签名 HEAD 请求，
创建新的本地网关和数据库连接。所有读取器共享 64 MiB 保留缓存及独立的 32 MiB
传输缓冲预算；权限拒绝、凭据或位置变更、关闭及删除连接会清理缓存。它们不是
应用总内存上限，也不提供跨对象事务快照。新查询范围的验证失败不会中断已有读取器；
该读取器关闭时会立即清理相应分块，不再保留。

## Validation and limits

Tests use a local S3-compatible protocol fixture with synthetic keys and real Parquet, plus the actual DuckDB extension. They cover listing, encoded names, Range requests, ETag changes, revoked access, malformed responses, SQL boundaries, cancellation, failed-settings rollback, exact types, joins and paging. An opt-in native Keychain test creates, updates, reads and deletes only a uniquely named synthetic entry.

Native R2 UI/IPC tests use a separate `cloudsmoke` build that replaces only transport and vault. Its fixture hook is excluded from the production app. Creation and restart phases verify the actual connection dialog, draft/result restoration and cascading workspace closure. Production app tests separately verify local behavior and its signature. Recorded results and screenshots are in `artifacts/r2/`.

A selective query over a 1,000,000-row, 5,166,996-byte fixture read 368,813 bytes. This is one fixture/query, not a general performance guarantee. Sorting, joins or aggregation may scan substantial remote data, consume R2 read requests, and exceed the timeout. The owner's live Cloudflare bucket still requires acceptance using credentials entered in the app. Multi-GB production workloads, other architectures/OSes, and R2 customer-provided encryption are not validated/supported in this first version.

Run `npm run coverage` for standard verification. Go tests use repository-wide instrumentation (`-coverpkg=./...`) so cross-package integration hits are counted, including the synthetic fixture server and native Keychain adapter. Prior reports used package-local instrumentation; both are ordinary-test measurements, but the increased scope must be considered when comparing them. No production file is excluded. `BAMBOO_KEYCHAIN_TEST=1` enables the temporary synthetic Keychain test and is set by the full verification script. Credentials should never be placed in repository files or command-line arguments.

Official references: [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/), [R2 credentials](https://developers.cloudflare.com/r2/api/tokens/), [DuckDB httpfs](https://duckdb.org/docs/2.0/core_extensions/httpfs/overview).

## Connection settings

**Settings → Cloud connections** separates reusable connection profiles from currently open workspaces. Adding a connection here tests and saves it without opening it. Open data shows saved connections alongside the provider entry. Current supported providers: Cloudflare R2 and Amazon S3; future providers belong in this same management surface, not additional sidebar buttons.

- Edit name or rotate credentials. Existing keys are never returned over IPC or filled into the form. Leave both key fields blank to retain them; provide both to replace them.
- Close the workspace before changing endpoint, bucket or prefix. Changing location resets its saved SQL to avoid applying queries to a different dataset. Renaming/rotating keys preserves SQL and the stable connection identity.
- Test performs a read-only directory listing and supports cancellation. Failed tests, invalid settings, vault failures and failed persistence preserve the previous valid state where rollback succeeds.
- Delete requires an explicit confirmation in the app, removes the saved credentials and closes associated files. Closing a workspace alone is not deletion.
- Existing saved R2 records migrate without losing state: a missing `closed` flag means the workspace was open. Up to 32 connections may be saved.

Validation includes real DuckDB/S3 fixture queries and actual native Settings interactions, including editing with blank keys, failed updates, close/reopen, delete confirmation, canceled tests, and process restart with one open and one saved-but-closed connection. Real Cloudflare credentials/bucket access remains manual acceptance.
