# Security

Bamboo previews local Parquet and explicitly configured R2/S3 workspaces. It has no telemetry or upload feature. Cloud browsing and reads use HTTPS; a token-protected loopback gateway serves only selected objects to DuckDB via GET/HEAD. Credentials use the system credential store; workspace settings and SQL drafts are stored locally.

## Query boundaries

- Only one SELECT/WITH query is accepted. Before any user query reaches driver preparation, a conservative lexical gate rejects escape strings (`E'…'` / `e'…'`), dollar quoting, NUL, extra statements and unbalanced wrappers. Standard doubled-quote strings remain supported.
- DuckDB's own [SQL serialization parser](https://duckdb.org/docs/2.0/data/json/sql_to_and_from_json) independently checks for exactly one SELECT statement. SQL is passed as a bound value to the parser, never executed by this check. Failure rejects the query before DESCRIBE or execution.
- User SQL runs as a SELECT subquery. Sort/filter identifiers are quoted and checked; filter values are parameters. External access and extension downloads are disabled, paths are limited to the selected file and explicitly resolved workspace references, and configuration is locked.
- The path allowlist restricts access, **not write permissions**. SQL validation is an application boundary, not an OS sandbox. DuckDB and Parquet decoding run in the main process; malicious native inputs require stronger process isolation than this application provides. Other local processes can still replace selected files.
- Pages, columns and returned text are bounded. Query cancellation, configurable memory/spill budgets and 15–3600-second query timeouts limit normal workloads; metadata operations use 15 seconds. DuckDB's memory limit does not cover every native allocation.

## Export and local data

JSON retains column types, exact textual values and NULL. CSV protects headers and formula-like text by prefixing an apostrophe, including leading whitespace/control characters and full-width formula markers. Strictly validated numeric cells retain their original spelling, including negative integers and decimals. NULL and empty text become empty CSV fields. The export chooser explains the transformation; use JSON when original values are required.

CSV protection reduces formula interpretation on import; it is not a guarantee across every spreadsheet application or saving/reopening workflow. See [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection). No spreadsheet application is invoked by Bamboo.

Export uses a native save dialog and creates a new file with mode 0600 and `O_EXCL`; existing files are never overwritten. Failed exports attempt to remove the partial file. Private query spill directories are cleaned up after normal database closure; crashes or deletion failures can leave local data behind. SQL drafts and saved workspace paths can also contain sensitive information.

The frontend uses text rendering for data/errors, a restricted CSP and a trusted MyGo bridge. External navigation and new windows are denied.

## Verification and distribution

Security regressions cover statement injection, independent native parsing, source SHA-256 preservation, ordinary quoting/comments, CSV headers/cells, exact negative numbers and unchanged in-memory results. Cloud tests use isolated fixtures rather than real credentials.

Publish explicitly selected source files and packaged applications. Do not distribute the development directory, local audit evidence or raw Git backups. Removing a sensitive file in a new commit does not remove it from Git history; check all branches/tags before publishing. Build release binaries with `-trimpath` and inspect the resulting package.

The current packaging uses ad-hoc macOS signing. Developer ID signing, notarization, process isolation and full native dependency coverage remain separate release work. Dependency scanner results do not establish the absence of native or application logic vulnerabilities.
