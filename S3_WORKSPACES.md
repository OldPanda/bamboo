# Read-only Amazon S3 workspaces

## Connect and manage

Choose **Open data → Cloud storage → Amazon S3**, or **Settings → Add connection → Provider: Amazon S3**.

Enter the bucket's **AWS Region**, bucket name, optional folder prefix, Access Key ID and Secret Access Key. For temporary credentials, include the matching **Session Token**. Do not send credentials in chat or save them in the repository. Test & connect opens the workspace; Test & save in Settings saves it without opening it.

Credentials, including the session token, are stored in macOS Keychain. Editing never returns saved secrets to the frontend: leave all credential fields blank to keep them, or provide both keys plus any session token to replace the whole credential set. Temporary credentials are not automatically refreshed; update them when they expire. Bamboo does not search environment variables, AWS CLI profiles, SSO caches or instance metadata for credentials.

Close a workspace to close its files while retaining connection and SQL. Open the saved connection through Settings or Open data. Delete connection removes its saved metadata and credentials after confirmation, without changing any S3 objects. To change Region, bucket or prefix, first close the workspace; changing location clears saved SQL. A connection's provider cannot change in-place; create a separate connection.

## Browse and query

The workspace opens its query editor immediately. Expand folders to list Parquet objects lazily, open one to preview/schema, or query unopened siblings:

```sql
SELECT a.order_id, b.city
FROM workspace."orders.parquet" a
JOIN workspace."nested/customers.parquet" b USING (customer_id)
ORDER BY a.order_id
```

Use `data` only after opening an individual file. Paging, filters, sorting, exact integers/decimals, cancellation and local page export work through the shared cloud reader. Queries remain scoped to the selected workspace and read-only. Local folders, R2 and S3 connections may coexist.

## Access and protocol

Use permissions restricted to the bucket/prefix being explored: `s3:ListBucket` on the bucket and `s3:GetObject` on its objects. Encrypted objects may also require access to the relevant KMS key. For example, this policy grants ordinary read access only to the `data/` prefix of an example bucket; replace the bucket name and prefix for your deployment:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::example-analytics-bucket",
      "Condition": { "StringLike": { "s3:prefix": ["data/*"] } }
    },
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::example-analytics-bucket/data/*"
    }
  ]
}
```

Bamboo derives the HTTPS regional S3 endpoint and signs each request with SigV4 for that region. Only general purpose buckets are supported. Regional path-style requests preserve verified TLS for bucket names containing dots; arbitrary endpoints and redirects are rejected. Commercial, China and GovCloud endpoint construction is covered by tests; their live accounts have not been exercised. Wrong-region and expired/denied credential responses produce a retryable configuration error without echoing response bodies or secrets.

All cloud requests are read-only listing, HEAD or ranged GET. DuckDB receives only short-lived loopback URLs for explicitly referenced objects, never AWS credentials. Reads verify ETag/If-Match and exact byte-range responses, with bounded transfer chunks; no fallback full-file download. Aggregations or sorting can still scan substantial data and incur AWS request/transfer charges. No remote upload, delete, rename or policy change is implemented.

## Validation and current limits

- Backend tests cover regional endpoints, SigV4 scope, session headers, escaped object names, wrong regions, denied/expired credentials, legacy R2 restoration, mixed provider persistence, token rotation/retention and deletion isolation.
- Real DuckDB + Parquet integration verifies AWS-workspace IPC, metadata, queries, paging/cancellation and scope boundaries using a local S3 protocol fixture. The fixture checks AWS region and session token independently of the R2 path.
- Native tests use the actual MyGo window and IPC with a test-only transport/vault. They cover connection, joins over unopened files, exact BIGINT, schema, paging, Settings CRUD, saved-but-closed state and restart. The fixture hook is excluded from the signed production app.
- No live AWS account, production KMS configuration, Glacier restore workflow or multi-GB workload has been tested. S3 Express/directory buckets, access points, custom S3-compatible services, requester-pays, object version selection, SSE-C, automatic STS renewal and IAM/SSO profile discovery are outside this version.

Run `npm run coverage` for all checks, or `python3 scripts/validate-s3.py` after building assets and fixtures for the native S3 suite. Screenshots and structured results are in `artifacts/s3/`; frontend/Go scope and raw counters are in `artifacts/coverage/`.

The internal `r2` package, IPC method names and Keychain service retain their historical names to preserve existing installations. Explicit provider metadata selects the adapter; S3 roots use `s3://` and R2 roots remain unchanged.

Official references: [regional/path-style addressing](https://docs.aws.amazon.com/AmazonS3/latest/userguide/VirtualHosting.html), [SigV4 and temporary credentials](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-authenticating-requests.html), [GetObject permissions and limitations](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).
