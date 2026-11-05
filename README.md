[English](README.md) | [简体中文](README.zh-CN.md)

<div align="center">

<img src="assets/bamboo.png" width="112" height="112" alt="Bamboo logo" />

# Bamboo

### Explore Parquet, locally and in the cloud.

**Your files. Your SQL. One workbench.**<br>
Browse local files, Amazon S3 and Cloudflare R2.<br>
Query with DuckDB, without importing your data into a database.

![macOS Apple Silicon](https://img.shields.io/badge/macOS-Apple_Silicon-111111?logo=apple&logoColor=white)
![Windows x64](https://img.shields.io/badge/Windows-x64-111111)
![Linux x64](https://img.shields.io/badge/Linux-x64-111111?logo=linux&logoColor=white)
[![License: MIT](https://img.shields.io/badge/license-MIT-111111)](LICENSE)

[![Listed on Awesome MyGo](https://awesomemygo.dev/badge.svg)](https://awesomemygo.dev/apps/bamboo)

**[Download](https://github.com/OldPanda/bamboo/releases/latest)** · **[Installation guide](docs/first-install.md)** · **[Website source & deployment](website/README.md)** · **[Documentation](#documentation)** · **[Contributing](CONTRIBUTING.md)** · **[Security](SECURITY.md)**

</div>

## Features

- **Explore files.** Preview Parquet and local CSV/TSV, inspect schemas, sort and filter columns.
- **Query across files.** Write SQL with inline completion, joins and aggregations.
- **Analyze and export.** Profile columns, build pivots, and export complete results or the current page.
- **Connect your storage.** Open local folders, S3 or R2 workspaces; cloud credentials stay in your system vault: macOS Keychain, Windows Credential Manager or Linux Secret Service.
- **Pick up where you left off.** Keep multiple files open and restore saved query drafts.

## Quick start

Download the [latest release](https://github.com/OldPanda/bamboo/releases/latest) for your platform:

| Platform            | Download and install                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | [DMG](https://getbamboo.app/en/#download-macos) — drag Bamboo into Applications.                                                                                                                                    |
| Windows x64         | Run the [setup EXE](https://getbamboo.app/en/#download-windows), or extract the portable [ZIP](https://getbamboo.app/en/#download-windows).                                                                         |
| Linux x64           | Install the [DEB](https://getbamboo.app/en/#download-linux) on Ubuntu 22.04+ / compatible Debian desktops, or extract the [tar.gz](https://getbamboo.app/en/#download-linux) with the required libraries installed. |

See the [installation guide](docs/first-install.md) for system requirements and first-launch instructions. Each package has a SHA-256 checksum on the release page.

Choose a file, folder or cloud workspace, or drop a Parquet, CSV or TSV file into the welcome area. Query `data` for the selected file, or `workspace."orders.parquet"` for a file in the active workspace.

## Build from source

See [Contributing](CONTRIBUTING.md) for the macOS toolchain setup and
[Windows/Linux build instructions](docs/windows-linux.md#build-and-verify) for native x64 builds.
On macOS Apple Silicon, run from the repository root:

```sh
npm ci
npm run build
open build/Bamboo.app
```

The macOS build downloads Go 1.27.3 as needed. Local macOS builds are ad-hoc signed, not notarized.

## Documentation

[Cross-file SQL](WORKSPACE_SQL.md) · [CSV / TSV](TEXT_FILES.md) · [Analysis](ANALYSIS.md) · [Amazon S3](S3_WORKSPACES.md) · [Cloudflare R2](R2_WORKSPACES.md) · [Development and tests](CONTRIBUTING.md)

## License

[MIT](LICENSE). Built with [MyGo](https://github.com/egoist/mygo) and [DuckDB](https://duckdb.org/).
See [third-party notices](THIRD_PARTY.md) for dependency licenses.
