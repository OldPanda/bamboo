# Bamboo

### Explore Parquet, locally and in the cloud.

A lightweight desktop workbench for browsing Parquet files and querying them with SQL.
Open a file, a local folder, or an Amazon S3 / Cloudflare R2 workspace—without importing your data into a database.

[Getting started](#getting-started) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT license](LICENSE)

## What you can do

- **Explore your data.** Preview rows, inspect schemas, sort and filter columns.
- **Query with SQL.** Use DuckDB for joins, aggregations and cross-file queries, with inline completion.
- **Keep work organized.** Open multiple files and workspaces, and restore saved query drafts.
- **Read from the cloud.** Browse S3 and R2 with credentials stored in macOS Keychain.
- **Export a preview.** Save the current result page as JSON or CSV.
- **Make it yours.** Choose light, dark or automatic appearance, English or Chinese, and query resource limits.

Queries run on your Mac. Source files stay read-only, and local files work offline.
Built with [MyGo](https://github.com/egoist/mygo) and [DuckDB](https://duckdb.org/).

## Getting started

Currently supported: **macOS on Apple Silicon**.

To build from source, install Xcode Command Line Tools, Node.js 22.12+, Python 3.12+,
and Go with toolchain download support. From the repository root:

```sh
npm ci
npm run build
open build/Bamboo.app
```

The build selects Go 1.27.3 automatically. The resulting app needs no development
tools to run; local builds are ad-hoc signed, not notarized.

Choose **Open data** to open a file, folder or cloud workspace, or drag a Parquet file
into the welcome area. Query the selected file as `data`; use
`workspace."orders.parquet"` to reference a file in the active workspace.

## Learn more

- [Cross-file SQL](WORKSPACE_SQL.md)
- [Cloudflare R2](R2_WORKSPACES.md) · [Amazon S3](S3_WORKSPACES.md)
- [Development, lint and tests](CONTRIBUTING.md)
- [Security and data access](SECURITY.md)
- [Third-party licenses](THIRD_PARTY.md)
