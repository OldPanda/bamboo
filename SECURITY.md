# Local security review

No security-audit skill/workflow was available in the supplied skill catalog, project, or checked local skill directories. The repository started empty, with no applicable `AGENTS.md`. A local manual boundary review, negative engine tests, `go vet`, npm audit, and Go govulncheck were used instead. No audit certification is claimed.

## Implemented controls

- No HTTP service, upload endpoint, account, telemetry, or network feature in Bamboo. The app embeds its frontend; DuckDB extension downloads and external access are disabled. The active file is allowlisted. For cross-file SQL, an ephemeral connection allowlists only that file and the explicitly referenced Parquet paths resolved within the active workspace; configuration is locked before user SQL. No entire directory is allowlisted. See WORKSPACE_SQL.md.
- Only regular local `.parquet` files are accepted. Remote URLs, relative paths, directories, and glob paths are rejected. Symlinks resolve to their canonical target before opening. Single quotes in paths are escaped.
- SQL is lexically gated before any database/sql prepare call (the driver can execute preceding statements in a multi-statement prepare). The gate rejects extra statements, unbalanced wrapping, and unsupported dollar quoting. User input is then embedded only as a SELECT subquery. No top-level writes, ATTACH, SET, COPY, extension installation, or DDL are exposed.
- Column identifiers are quoted and validated; contains-filter values use prepared parameters. Tests cover injection in SQL, paths, identifiers, and values, and file reads outside the selected path or explicitly referenced workspace paths.
- MyGo's trusted app bridge exposes only the Workbench service. External page navigation and new windows are denied. CSP prohibits network connections and inline scripts. Data and errors are inserted as text, never HTML.
- Bounded pages and text, one active operation, context cancellation and a 15-second deadline reduce accidental resource exhaustion. Configuration tests inspect actual DuckDB settings and verify they cannot be unlocked.
- Explicit page export uses the native save dialog, mode 0600 and `O_EXCL`: no overwrite and no symlink traversal. JSON keeps exact values and is not interpreted as spreadsheet formulas. Errors delete only the partial file newly created by that export.

## Tested and remaining scope

Negative tests cover write/administrative SQL, multi-statement wrapper escapes, unrelated local files, URLs/globs, malformed Parquet, quoting, page/cell/column limits, cancellation/deadline recovery, and source immutability. Tests are in `internal/engine/engine_test.go` and `export_test.go`.

This is an in-process native engine, not an OS-level sandbox. A DuckDB/Parquet decoder vulnerability or huge intermediate value may exceed these application controls. `memory_limit` does not bound all process memory, and the text limit is checked after DuckDB formats a cell. The path allowlist is not a snapshot: another local process may replace an already-selected file. Queries can introspect DuckDB metadata and read the selected file using other built-in readers. Running unfamiliar SQL is not represented as a robust hostile-code security boundary.

Dependency checks on 2026-10-26: npm audit reported zero known vulnerabilities; govulncheck v1.9.0 reported none in reachable Go code. These checks do not establish coverage of all native DuckDB/OS webview components. Upstream versions are pinned; future advisories require new scans and builds. The `.app` is ad-hoc signed, not notarized or hardened for external distribution.

Native UI automation did not complete on this host, so manual file-picker, save-dialog, and Finder-drop acceptance remains. Engine path and export filesystem behavior were tested independently.
