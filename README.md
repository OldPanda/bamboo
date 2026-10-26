# Bamboo

A standalone, local Parquet desktop workbench built with **MyGo + DuckDB**. Open a file, browse bounded pages, inspect its schema, filter and sort, and run read-only SQL against `data`. No account, telemetry, upload, server, or runtime network connection is required.

![Bamboo desktop](artifacts/bamboo-light.png)\n\nThe analyst-focused interface puts the typed table first. See the [redesign decisions and verification](REDESIGN.md), [offline before/after report](artifacts/redesign/comparison.html), and [PNG comparison](artifacts/redesign/comparison.png).

## Run the delivered app

On this Mac (Apple Silicon), double-click **`build/Bamboo.app`** or run:

```sh
cd /path/to/Bamboo
open build/Bamboo.app
```

Try the included deterministic fixture:

```sh
open build/Bamboo.app --args --file "$PWD/fixtures/orders.parquet"
```

Quit an existing Bamboo instance first if using `open --args`. The executable also runs directly:

```sh
./build/bamboo --file "$PWD/fixtures/million.parquet"
```

The `.app` contains its frontend and DuckDB. It needs no Go, Node, npm, or separate database installation to run. This is an ad-hoc signed local build, not a notarized distributable. macOS arm64 is the tested platform; no Intel, Windows, or Linux artifact is supplied.

## Explore

- **Open Parquet / ⌘O** opens the native file picker. MyGo's native file-drop event is connected for dropping a local `.parquet` file.
- The sidebar lists columns; the header shows exact file rows, bytes, column count, and row-group count from metadata.
- Browse 50, 100, 250, or 500 rows at a time. **Click a column heading** to sort ascending, then descending. Nulls sort last. The toolbar applies a case-sensitive text-contains filter to one column; use SQL for numeric, date, or compound predicates.
- **SQL / ⌘Enter** runs one `SELECT` or `WITH` query using the selected file as `data`. CTEs, aggregates, expressions, joins to `data`, and window functions work. Results paginate without materializing the entire result in Go or the frontend.
- **Click a cell / Enter** opens its full text. `NULL` and empty strings are visually distinct. Integers, decimals, timestamps, lists, structs, and blobs cross IPC as strings or null, with logical types alongside them. `TIMESTAMPTZ` is displayed in UTC; nested types use DuckDB's readable text notation, not JSON.
- **Export page** saves the last successful visible result page to a new `.json` file through a native save dialog. It includes column names/types, string-or-null rows, offset, and whether more rows exist. It does not re-run SQL, export the full dataset, or overwrite existing files. This avoids spreadsheet formula interpretation and preserves null/empty and numeric precision.
- **Cancel** interrupts an active engine operation. Queries time out after 15 seconds; a failure leaves the previous successful result available. A failed file open leaves the previous session usable.

Example:

```sql
SELECT city, count(*) AS orders, sum(amount) AS revenue
FROM data
WHERE fulfilled
GROUP BY city
ORDER BY revenue DESC
```

## Build from source

Requirements: macOS with Xcode Command Line Tools (`clang` for DuckDB's cgo binding), Go capable of downloading **Go 1.27.3**, and Node **22.12+** with npm. This build was verified with Go 1.27.3 and Node 22.23.3. Bun is not needed. Allow roughly 2 GB of free build/cache space; Go initially downloads DuckDB libraries for multiple platforms.

```sh
npm ci
npm run build
npm run fixtures
```

`npm run build` bootstraps the embedded frontend, compiles MyGo, regenerates `frontend/src/mygo.ts` from the bound Go service, checks TypeScript, builds the frontend, and builds `build/bamboo` plus the macOS `.app`. The build script pins `GOTOOLCHAIN=go1.27.3`; no global toolchain or shell settings are changed. Dependencies and build tools are required only when building. For edits, rerun `npm run build` and launch the binary.

## Architecture and boundaries

```text
Local Parquet file
  → DuckDB direct scan / view named data
  → Go engine (deadline, one operation, bounded rows and bytes)
  → MyGo generated typed IPC
  → local embedded TypeScript/CSS UI in WKWebView
```

`internal/engine` owns the database and query boundary. Opening a file creates a fresh in-memory DuckDB instance with an exact canonical path allowlist. It uses two threads, a 256 MB DuckDB memory limit, no disk spill, external access disabled, extension auto-install/loading disabled, and locked configuration. The source file is never imported into an in-memory table or converted wholesale to JSON. Parquet metadata supplies row counts without a full scan. Paging fetches one extra row to determine whether a next page exists.

A conservative SQL lexical gate rejects multiple statements and wrapper escapes before the Go driver's prepare path. DuckDB then parses a subquery wrapper; write/administrative commands cannot execute there. Sort identifiers are quoted and checked against result columns; filter values are bound parameters. Only embedded app content is rendered; external navigation/window creation is blocked, CSP disables network connections, and all file-derived strings use `textContent`.

Resource limits: 500 rows/page, 256 columns, 64 KiB per cell, 4 MiB of raw cell text/page, 32 KiB SQL, 4 KiB filter text, offset ≤1 billion, one running engine operation. Oversized cells/pages produce a clear error instead of silent truncation. DuckDB's memory setting is **not a hard process RSS limit**: decoding, strings, Go, and the webview have additional allocations. JSON escaping also increases wire size beyond raw text size. This is not an OS sandbox for hostile Parquet files; see [SECURITY.md](SECURITY.md).

## Verification

### Coverage

The coverage expansion retains every Go production/tool file and every frontend
TypeScript source file, including generated IPC bindings. Ordinary Go tests and
instrumented real-desktop coverage are reported separately. See the
[coverage summary](artifacts/coverage/SUMMARY.md) and the self-contained,
phone-friendly [HTML report](artifacts/coverage/report.html) for exact counts,
baseline comparison, raw evidence and remaining gaps.

```sh
npm ci
npm run coverage       # macOS GUI: tests, native desktop, reports, scans, 95% gates
npm run coverage:unit  # no desktop: core/frontend 95% gates; no full-Go 95% claim
npm run coverage:web  # V8 statements, branches, functions and lines; each >=95%
```

The full command uses Go 1.27.3 locally, generates its own deterministic Parquet
fixtures, rebuilds `build/Bamboo.app`, and verifies both an instrumented executable
and the signed app. It requires Python 3, Node 22.12+ and a logged-in macOS GUI
session. It does not change global toolchain or signing settings. On restricted
hosts the existing Go/npm caches and desktop access must be permitted. Raw Go
profiles, native counters, compressed V8 data and scanner logs are retained under
`artifacts/coverage/`. The HTML has all resources inline and makes no network
requests. The native picker, save dialog and actual Finder drop still require
manual acceptance; dialog doubles are only service tests.
The coverage runner builds/tests Go packages serially (`-p=1`) to limit temporary
disk use from DuckDB-linked binaries; this does not change the measured files.

### Other verification commands

```sh
GOTOOLCHAIN=go1.27.3 go test -ldflags='-s -w' ./...
BAMBOO_LARGE_TEST=1 GOTOOLCHAIN=go1.27.3 go test -ldflags='-s -w' -count=1 -v ./internal/engine
GOTOOLCHAIN=go1.27.3 go vet ./...
npm audit
GOTOOLCHAIN=go1.27.3 go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...

# Runs real desktop UI + IPC checks, captures screenshots, then quits.
# Run from the project root after building and generating fixtures.
BAMBOO_SMOKE="$PWD/artifacts" ./build/bamboo --file "$PWD/fixtures/orders.parquet"
cat artifacts/desktop-smoke.json
```

The smoke runner writes an `error` field if it fails; inspect the report rather than relying only on the process exit status. [VALIDATION.md](VALIDATION.md) contains actual test results, fixture sizes, measurements, screenshots, and remaining manual checks.

## First-version limits

One active file per window/session; opening another replaces it. No history, multi-file workspace, cloud access, charts, editing, CSV input, or saved queries. Export covers only the visible page, in JSON. Page navigation uses `LIMIT/OFFSET`; deep pages, sorting, and aggregation can scan significant data. Queries are rerun on each page; use a unique `ORDER BY` for deterministic pagination, and reopen files after external modification. Concurrent external file replacement is not snapshot-isolated.

The SQL gate supports standard quoted strings/identifiers and comments within queries, but not dollar-quoted text, parameters, leading comments, or multiple statements. File paths containing `* ? [ ]` are rejected to avoid Parquet glob expansion. Very wide schemas/large cells need a future projected-open workflow. No partial truncation is hidden. The app follows system light/dark mode and supports a 700 px minimum desktop window, with scrolling for small heights.

Native picker/save interaction and actual Finder drag-and-drop require manual acceptance on this host. Windows/Linux, encrypted or corrupted hostile files beyond the malformed fixture, multi-GB real-world data, memory-pressure behavior, screen-reader behavior, and notarized distribution have not been validated.

## License

MIT for Bamboo. See [THIRD_PARTY.md](THIRD_PARTY.md) and `licenses/` for pinned dependencies, source references, and redistribution notes.
