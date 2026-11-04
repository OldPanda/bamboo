# Queries across files in one workspace

Open a folder to show its query editor immediately; no file needs to be opened. Refer to files by their exact relative path in the `workspace` schema. When you open a single file, `data` means that active file; the independent workspace editor has no `data` alias:

```sql
SELECT o.order_id, o.amount, c.customer_name
FROM workspace."orders.parquet" AS o
JOIN workspace."customers.parquet" AS c
  ON o.customer_id = c.customer_id
```

Files do not need to be opened in the sidebar first. Subdirectories and duplicate basenames are explicit:

```sql
SELECT * FROM workspace."2025/orders.parquet"
UNION ALL BY NAME
SELECT * FROM workspace."2026/orders.parquet"
```

The **Workspace tables** disclosure above the editor lists the active file and files discovered in the sidebar for the current root. Click a table name to insert its correctly quoted reference at the cursor, without running the query. Expand a directory or use its load-more control to discover further names; the list is not a recursive scan. A reference can also be typed directly. Double quotes inside filenames are doubled, e.g. `workspace."a""b.parquet"`. Use ordinary aliases such as `a` and `b`; `workspace` is reserved for file references.

Click a workspace name in the sidebar to return to its independent editor. Each workspace retains its own draft and last successful SQL across switches and restarts, separately from per-file queries. A blank editor waits for input; it does not automatically select or load a file. Closing the last file keeps an available workspace editor; the welcome screen appears when no documents or workspaces remain.

Queries remain read-only. JOIN, UNION, CTEs, aggregation, result paging/filtering/sorting, cancellation, exact string/null values and page/full-result export use the existing path. File queries remain attached to their document; workspace queries are saved separately under the workspace. Opening a folder shows its workspace editor and retains any existing open documents.

## Scope and resource behavior

- Only the selected workspace (or the workspace owning the active file) is resolved. Independent sibling roots and outside files are unavailable. A nested directory is within its parent workspace; when the active document belongs to a separately opened nested root, references are relative to that more specific root.
- Each query resolves its direct `workspace."relative.parquet"` references against the still-open root and verifies regular supported files (Parquet/CSV/TSV locally; Parquet in cloud workspaces). Absolute paths, traversal, escaping symlinks, wildcard filenames, directories and remote URLs are rejected. Closing the workspace revokes future references.
- Up to 32 distinct referenced files per query. Names use exact relative paths including the supported file extension; DuckDB identifiers are case insensitive, so two paths differing only in case cannot both be registered in one query.
- A scoped DuckDB connection registers only the referenced files as views, plus `data` when there is an active file. Its exact canonical path allowlist is locked before SQL runs. No directory-wide permission, dataset copying, eager recursive scan or upfront opening of all files. Unreferenced malformed siblings do not interfere.
- File queries without workspace references reuse the active connection. A local workspace-only Parquet query can retain one exact catalog for 30 seconds of inactivity. Every execution still resolves and opens every reference to check permission, canonical path, file identity, size, modification/change time and resource settings. A changed root or file set, a failed query, spill, settings change or workspace closure discards it. File identities use native macOS/Linux metadata and Windows handle metadata; unavailable identity information falls back to a fresh connection. CSV/TSV, active-file cross-references and constant workspace queries always bind a fresh catalog. There is no implicit `data` alias in a workspace editor. Neither retained metadata nor rechecking establishes a transactional snapshot of concurrent writers; data can change during a query or between pages.
- Wide files and query results are not restricted to 256 columns. All columns are retained; pages return at most the requested 1–500 rows and 128,000 cells, automatically reducing the row count for wide results. Paging uses that effective row count without skipping rows. Column names/types plus a 64-byte per-column allowance are bounded to 1 MiB; schemas beyond that budget can still be queried through a workspace with an explicit column selection. Values remain bounded to 64 KiB/cell and 4 MiB/page. Metadata operations use a 15-second timeout; query timeout, memory and disk-spill budgets follow Settings → Performance. These are not total process-memory guarantees. Very large joins may hit those limits.
- Only references directly present in SQL are registered. SQL strings passed to dynamic functions do not discover or grant additional file access.

Wide result tables keep every returned column and exact cell in the native DOM.
Above 64 columns, font-relative fixed column widths and reused cells reduce page
update work. Long content remains selectable even when visually ellipsized;
browser find, cross-column text selection and native table semantics remain
available. Widths follow the current page within a bounded range. First display
still creates the complete bounded page; this is not column virtualization.

本地工作区的 Parquet 查询可短暂复用同一组文件的目录，空闲 30 秒后释放。每次查询
仍会重新验证路径、读取权限、文件身份和资源设置；文件变化、错误、磁盘溢出或关闭
工作区会丢弃缓存。CSV/TSV 每次重新绑定读取选项。宽表保留全部列和原始文本，通过
复用单元格及固定列宽减少翻页开销，不移除屏幕外的列。

## Verification

Real DuckDB tests cover JOIN, UNION ALL, active-file aliases, quoted/Unicode and nested paths, empty and malformed files, exact 64-bit values, paging/filtering/sorting, cancellation and recovery, source immutability, closed roots, standalone reset, and unrelated-file/network/traversal/symlink rejection. A Workbench test exercises the actual service and export snapshot. Frontend tests cover safe table insertion and workspace ownership transitions.

`npm run coverage` also executes `scripts/cross-file-query-smoke.js` through the native desktop and real IPC: JOIN of an unopened nested file, UNION, exact values, pagination, rejected traversal/malformed files, recovery and a second-process saved-query restore. It runs against both the instrumented binary and signed delivered app. Current measurements and raw results are in `artifacts/coverage/`; native picker/save/Finder gestures remain a separate manual check.

`scripts/workspace-query-smoke.js` additionally verifies workspace-only JOIN/paging/export availability, switching from a file back to the workspace draft, closing the last file without losing the editor, and restoring a workspace draft/result in a second process with no document reopened.

## Exporting results

The **Analyze** action also computes [full-query column profiles and pivots](ANALYSIS.md)
within the captured query's workspace, independently of preview pagination.

The export chooser offers **Current page** (the existing in-memory snapshot) or
**Complete result**. Complete result re-executes the last successful SQL with its
column projection, filter and sort in the original local or cloud workspace,
without the preview offset/limit. An explicit SQL `LIMIT` remains part of that
query. Editing SQL or a failed query never replaces the captured successful
request. Opening another file or workspace clears export eligibility until a
query succeeds. Sources can change outside Bamboo between preview and export;
this is a captured query, not a transactional copy of the original source bytes.

Complete exports stream rows through a native scalar sink into a private
temporary file beside the destination. A private single-threaded query connection
preserves row order; the driver receives only the sink's scalar aggregate, since
its ordinary cursor would materialize the full native result. Sorts and joins can
still require their own intermediate memory or spill space. The exported result
does not accumulate in native result storage, the WebView or a Go slice.
Schema and 64 KiB cell limits remain; each streamed row is limited to
4 MiB of value text. Query memory, temporary disk and timeout settings still
apply. The growing export file itself is not query spill and requires enough
space on the destination volume. Progress reports rows written, without running
an extra count query. Cancel interrupts the same operation and retains the preview.

All four formats are available for both scopes:

- **JSON:** an object with `columns` (name/type metadata), `rows` (arrays of
  strings or null), `more` and `offset`. A complete export has `more: false`
  and `offset: 0`. Strings preserve exact numeric, temporal and nested values.
- **JSONL:** the first line is `{"columns":[...]}`; each subsequent line is
  `{"row":[...]}` with the same exact string/null representation. The metadata
  line remains for an empty result. Arrays preserve duplicate column positions.
- **CSV / TSV:** a header followed by comma/tab-delimited records with standard
  double-quote escaping, including multiline values. Formula-like text and
  headers receive a leading apostrophe; typed numeric values remain unchanged.
  NULL and empty text both become empty fields. Use JSON/JSONL for original values.

Existing paths are never overwritten. Complete exports publish their final name
only after the stream, buffered writes, sync and close succeed, using an exclusive
hard link on the destination filesystem. Filesystems without hard-link support
are rejected; choose another destination. Failures and cancellation remove the
partial file, and cleanup errors are reported. A process crash may leave a hidden
`.bamboo-export-partial-*` file, never a falsely complete destination file.

See [Query history and saved queries](docs/query-history.md) for private local SQL recall.
