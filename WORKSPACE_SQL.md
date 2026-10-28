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

Queries remain read-only. JOIN, UNION, CTEs, aggregation, result paging/filtering/sorting, cancellation, exact string/null values and page export use the existing path. File queries remain attached to their document; workspace queries are saved separately under the workspace. Opening a folder shows its workspace editor and retains any existing open documents.

## Scope and resource behavior

- Only the selected workspace (or the workspace owning the active file) is resolved. Independent sibling roots and outside files are unavailable. A nested directory is within its parent workspace; when the active document belongs to a separately opened nested root, references are relative to that more specific root.
- Each query resolves its direct `workspace."relative.parquet"` references against the still-open root and verifies regular Parquet files. Absolute paths, traversal, escaping symlinks, wildcard filenames, directories and remote URLs are rejected. Closing the workspace revokes future references.
- Up to 32 distinct referenced files per query. Names use exact relative paths including `.parquet`; DuckDB identifiers are case insensitive, so two paths differing only in case cannot both be registered in one query.
- An ephemeral DuckDB connection registers only the referenced files as views, plus `data` when there is an active file. Its exact canonical path allowlist is locked before SQL runs. No directory-wide permission, dataset copying, eager recursive scan or upfront opening of all files. Unreferenced malformed siblings do not interfere.
- File queries without workspace references reuse the active connection. Workspace-only queries use an ephemeral connection even for a constant query such as `SELECT 1`; there is no implicit active file. Cross-file queries rebuild their lightweight catalog per execution (including pages), then close it; they do not cache whole files. Data can change between pages if another process edits a source.
- Limits remain 15 seconds, 500 output rows/page, 256 columns, 64 KiB/cell and 4 MiB/page. Each DuckDB connection has a 256 MB configured memory limit and no disk spill. These are not total process-memory guarantees. Very large joins may hit those limits.
- Only references directly present in SQL are registered. SQL strings passed to dynamic functions do not discover or grant additional file access.

## Verification

Real DuckDB tests cover JOIN, UNION ALL, active-file aliases, quoted/Unicode and nested paths, empty and malformed files, exact 64-bit values, paging/filtering/sorting, cancellation and recovery, source immutability, closed roots, standalone reset, and unrelated-file/network/traversal/symlink rejection. A Workbench test exercises the actual service and export snapshot. Frontend tests cover safe table insertion and workspace ownership transitions.

`npm run coverage` also executes `scripts/cross-file-query-smoke.js` through the native desktop and real IPC: JOIN of an unopened nested file, UNION, exact values, pagination, rejected traversal/malformed files, recovery and a second-process saved-query restore. It runs against both the instrumented binary and signed delivered app. Current measurements and raw results are in `artifacts/coverage/`; native picker/save/Finder gestures remain a separate manual check.

`scripts/workspace-query-smoke.js` additionally verifies workspace-only JOIN/paging/export availability, switching from a file back to the workspace draft, closing the last file without losing the editor, and restoring a workspace draft/result in a second process with no document reopened.
