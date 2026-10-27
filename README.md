# Bamboo

A standalone, local Parquet desktop workbench built with **MyGo + DuckDB**. Open a file, browse bounded pages, inspect its schema, filter and sort, and run read-only SQL against `data`. No account, telemetry, upload, server, or runtime network connection is required.

![Bamboo desktop](artifacts/coverage/app-desktop/multi/bamboo-light.png)

The analyst-focused interface puts the typed table first. See the [redesign decisions and verification](REDESIGN.md), [offline before/after report](artifacts/redesign/comparison.html), and [PNG comparison](artifacts/redesign/comparison.png).

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
- Workspace files appear only in their directory tree, with an **×** beside each opened file. **Open files** lists only files outside all open workspaces and disappears when empty. Click a filename to switch without discarding other files. The sidebar also lists columns when no folder is open; the header shows exact file rows, bytes, column count, and row-group count from metadata.
- Browse 50, 100, 250, or 500 rows at a time. **Click a column heading** to sort ascending, then descending. Nulls sort last. The toolbar applies a case-sensitive text-contains filter to one column; use SQL for numeric, date, or compound predicates.
- **Explore Data / ⌘Enter** runs one `SELECT` or `WITH` query using the selected file as `data`. CTEs, aggregates, expressions, joins to `data`, and window functions work. Results paginate without materializing the entire result in Go or the frontend.
- **Select cell text** directly to copy it; clicking does not open a popup. `NULL` and empty strings are visually distinct. Integers, decimals, timestamps, lists, structs, and blobs cross IPC as strings or null, with logical types alongside them. `TIMESTAMPTZ` is displayed in UTC; nested types use DuckDB's readable text notation, not JSON.
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

## Folder workspaces

Choose **Open Folder** once for each directory you want to keep as a workspace, then browse its sidebar tree and click a Parquet file. Adding another folder retains existing folders and the current preview. Directories expand on demand; **Load more entries** reads another bounded page. **Refresh** reloads the root after filesystem changes. Hidden entries and symbolic links are not listed. Only directories and `.parquet` files appear. No data is copied or imported.

Use the pencil beside the workspace name to rename its display label (the folder itself is never renamed). The top breadcrumb now shows the actual workspace name. **Open Parquet** keeps previously opened files available. A file within an open root appears only in that workspace tree, never duplicated under Open files; a file outside every root appears under **Other files** with a File breadcrumb. Nested roots use the most specific root. Reopening the same canonical path selects the existing file instead of duplicating it. **Close workspace** removes its tree and closes all files owned by that workspace; they are not moved into Other files. Other workspaces and independent files remain open. If the active file closes, Bamboo switches to a remaining file or returns to welcome when none remain. With overlapping roots, files belong to the most specific open root. Each open file has its own right-side **×**; closing the active file selects a neighbor, and closing the last file returns to the welcome screen. These actions never delete source files.

Each workspace remembers its last file and each file's SQL draft plus last successful query. Drafts save after 350 ms of inactivity and on editor blur; wait for **Saved locally** before quitting. File/workspace switches flush pending changes first. On the next launch Bamboo reopens all still-open workspaces and the last file from each, with the most recently used workspace last, runs the saved successful query through the same read-only engine, and restores the draft. If that query no longer works, the default file preview appears and the draft remains intact. Missing roots/files and failed settings writes show actionable errors. Within a session each open file retains its draft, successful query, page size/page, filter, sort and Explore/Schema view. Switching reopens that file and reruns its preview through the single bounded engine; inactive files do not retain whole datasets or separate database connections. The complete open-file list and outside-file queries are session-only; restart restores one last file per workspace, not every open document. Expanded tree branches and pagination are also session-only.

Settings live in `~/Library/Application Support/Bamboo/workspaces.json` on macOS, with private file permissions and atomic replacement; no management file is written inside the data folder. Settings contain local paths and SQL, not result rows. At most 32 workspace profiles and 256 per-file queries per profile are retained; queries are limited to 32 KiB each and the settings file to 8 MiB. Directory pages inspect 200 raw entries at a time, with a one-million-entry paging ceiling. Refresh if a directory changes during paging. File selection is checked against the selected root; this is not an OS sandbox against concurrent filesystem replacement. Simultaneous independent app instances sharing one config are not supported.

```sh
open build/Bamboo.app --args --workspace "/path/to/data-folder"
```

`--file` explicitly opens a standalone file for that launch. `BAMBOO_CONFIG_DIR` overrides the settings directory for isolated tests. The native folder picker is wired through MyGo's `Directory` option and covered by a dialog double; actual native picker interaction remains a manual acceptance step.

## Explore Data

Explore Data combines the query editor and data preview in one view. File switching keeps the previous coherent preview visible while loading, then updates the title, editor and table together. Controls remain visually steady and brief operations do not flash a loading overlay. Open a file to see both, run read-only SQL above the results, or switch to Schema to inspect column types.

## Table text selection

Clicking a cell stays in the table without opening a dialog. Drag over text to select and copy it. Full values remain in the cell text even when visually shortened to fit the column.

## First-version limits

Multiple files and folder workspaces can remain open, with one active preview/engine at a time. Folder workspaces remember names, one recent file per root and per-file query drafts; there is no support for cross-file SQL joins, virtual/custom collections, cloud access, charts, editing or CSV input. Export covers only the visible page, in JSON. Page navigation uses `LIMIT/OFFSET`; deep pages, sorting, and aggregation can scan significant data. Queries are rerun on each page; use a unique `ORDER BY` for deterministic pagination, and reopen files after external modification. Concurrent external file replacement is not snapshot-isolated.

The SQL gate supports standard quoted strings/identifiers and comments within queries, but not dollar-quoted text, parameters, leading comments, or multiple statements. File paths containing `* ? [ ]` are rejected to avoid Parquet glob expansion. Very wide schemas/large cells need a future projected-open workflow. No partial truncation is hidden. The app follows system light/dark mode and supports a 700 px minimum desktop window, with scrolling for small heights.

Native picker/save interaction and actual Finder drag-and-drop require manual acceptance on this host. Windows/Linux, encrypted or corrupted hostile files beyond the malformed fixture, multi-GB real-world data, memory-pressure behavior, screen-reader behavior, and notarized distribution have not been validated.

## License

MIT for Bamboo. See [THIRD_PARTY.md](THIRD_PARTY.md) and `licenses/` for pinned dependencies, source references, and redistribution notes.

## Cross-file workspace SQL

Use `workspace."orders.parquet"` or `workspace."nested/orders.parquet"` in JOIN, UNION and aggregation queries. `data` remains the active file. Open **Workspace tables** above the query editor to insert references; files need not be opened beforehand. Queries resolve only the active workspace, with at most 32 referenced files and existing read-only/resource limits. See [WORKSPACE_SQL.md](WORKSPACE_SQL.md) for examples, boundaries and validation.

Opening a workspace now immediately shows its independent query editor, even with no open files. Click the workspace name to return to it. Workspace drafts and successful SQL persist separately from per-file queries; closing the last file retains an available workspace editor. With no active file, reference `workspace."filename.parquet"` instead of `data`.

## Cloudflare R2 workspaces

Choose **Open data → Cloud storage → Cloudflare R2**, enter the bucket's S3 endpoint, bucket name, optional folder prefix, and bucket-scoped **Object Read only** Access Key ID / Secret Access Key. **Test & connect** verifies listing access before saving the connection. Credentials live in macOS Keychain; metadata and saved SQL stay in Bamboo's private settings. Closing an R2 workspace retains its saved connection and Keychain entry. Manage connections through **Settings → Cloud connections**: add, edit, open, or explicitly delete a connection. Deletion closes its workspace and removes saved credentials, without changing cloud files.

R2 appears beside local workspaces. You can query immediately without opening a document, browse folders, preview Parquet, inspect schema, and join files using `workspace."orders.parquet"` / `workspace."nested/other.parquet"`. Reads use byte ranges; large scans can still transfer substantial data and consume R2 read operations. Export remains local and page-only.

See [R2_WORKSPACES.md](R2_WORKSPACES.md) for setup, read boundaries, validation and limitations. The macOS arm64 build downloads a hash-pinned official httpfs extension once and packages it for offline startup. Local-only workspaces make no R2 requests.


## Amazon S3 workspaces

Choose **Open data → Cloud storage → Amazon S3**, or add a connection in **Settings**. Supply the bucket's AWS Region, bucket, optional prefix and read credentials; temporary credentials include a Session Token. S3 supports the same Parquet preview, schema, paging and workspace SQL as R2. Credentials remain in macOS Keychain. Closing a workspace keeps its saved connection; deleting a connection never deletes cloud files.

See [S3_WORKSPACES.md](S3_WORKSPACES.md) for setup, least-privilege example, protocol boundaries and supported bucket types. Actual AWS-account acceptance remains separate from the automated native-window/S3-protocol checks.
