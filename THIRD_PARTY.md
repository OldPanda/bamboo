# Third-party software

Bamboo's original application code is MIT licensed. Dependencies retain their own licenses.

- MyGo **v0.6.4**, release commit `6255ea40139d06e0762a7c4a32626148ba410478`: MIT. Provides the native window, OS webview, dialogs, and generated TypeScript IPC. The corresponding npm `mygo-runtime` is pinned to **0.6.4** (MIT).
- DuckDB Go **v2.20000.0**, bindings **v0.20000.0**, bundled DuckDB **2.0.0**: MIT. DuckDB is statically linked; its native library includes core extensions and third-party components. Upstream source and full component license notices: https://github.com/duckdb/duckdb/tree/v2.0.0/third_party and https://github.com/duckdb/duckdb/blob/v2.0.0/LICENSE . These should be reviewed before public redistribution; this artifact is a local development build.
- Compiled Go dependency license texts and versions are recorded in `licenses/manifest.json` and adjacent files. These include purego (Apache-2.0), x/text (BSD-style), uuid (BSD-style), and mapstructure (MIT).
- TypeScript, Vite, ESLint (MIT), eslint-plugin-jsdoc (BSD-3-Clause), and minimatch (BlueOak-1.0.0) are development tools and are not bundled into the desktop runtime. Exact transitive versions and package integrity hashes are in `package-lock.json`; Go versions and checksums are in `go.mod` / `go.sum`.
- No Parqlab code, artwork, assets, or proprietary implementation was copied. Its public product page informed the exploration workflow only.

Official references reviewed during implementation:

- https://github.com/egoist/mygo/tree/v0.6.4/docs — frontend embedding, generated bindings, dialogs, lifecycle, and page evaluation/capture.
- https://duckdb.org/docs/stable/clients/go — Go driver installation and native linking.
- https://duckdb.org/docs/stable/data/parquet/overview — direct Parquet scans and filter/projection pushdown.
- https://duckdb.org/docs/stable/operations_manual/securing_duckdb/overview — external resource restrictions and limitations.
- https://parqlab.app/ — product workflow reference; no comparative performance claims.

R2 support adds AWS SDK for Go v2 **v1.47.4** (SigV4 signing only) and Smithy Go **v1.28.6**, Apache-2.0; license and notice files are included under `licenses/`. No AWS environment credential discovery is used.

The macOS arm64 bundle includes the official **DuckDB 2.0.0 httpfs** extension (MIT), downloaded during explicit builds from `https://extensions.duckdb.org/v2.0.0/osx_arm64/httpfs.duckdb_extension.gz`. Its uncompressed SHA-256 is pinned to `c2d72a98ad081bf4d62c908b8d9f60b70ab1b83faa9141fc7e7d53526658761d`; DuckDB also verifies the embedded extension signature. See `licenses/duckdb-httpfs-LICENSE.txt` and upstream component notices at https://github.com/duckdb/duckdb-httpfs/tree/main/third_party. Native-extension dependency coverage is outside `govulncheck` and npm audit.

## Cloud provider trademarks

Connection logos are bundled locally, unmodified, to identify their providers.
Cloudflare cloud-only logo: https://www.cloudflare.com/logo.svg (official website SVG, without wordmark).
AWS logo: https://press.aboutamazon.com/logos ; asset https://assets.aboutamazon.com/ff/9f/c88d0578474381e7ee1b6d337d23/aws-logo-rgb.png .
These marks belong to their respective owners and are not covered by Bamboo's MIT license. No affiliation or endorsement is implied.

Release builds select pinned static libraries through the bindings' documented `duckdb_use_static_lib` path. The static registration loader omits only `autocomplete`, `tpch`, and `tpcds`; core functions, ICU, JSON, Parquet, httplib and loadable-extension support remain. The Parquet component is rebuilt from SHA-256-pinned DuckDB 2.0.0 source with Bamboo's decimal metadata patch; see [the patch and build provenance](docs/parquet-compatibility.md). DuckDB's MIT license remains included. The official httpfs binary and Go module-cache archives are retained without modification. CMake 3.31.6 (BSD-3-Clause) is a build tool only and is not bundled with the application.

Automatic updates use **Sparkle 2.10.1**, including its native installer helpers.
The official archive SHA-256 is pinned to
`1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27`.
Sparkle's complete license and bundled-component notices are preserved in
`licenses/sparkle-LICENSE.txt`. See https://sparkle-project.org/ and
https://github.com/sparkle-project/Sparkle/releases/tag/2.10.1.

## Windows/Linux preview runtime dependencies

The Windows x64 and Linux x64 packages retain the same DuckDB static extensions.
They bundle official DuckDB 2.0.0 httpfs artifacts from `extensions.duckdb.org`:

| Platform              | Uncompressed SHA256                                                |
| --------------------- | ------------------------------------------------------------------ |
| `windows_amd64_mingw` | `f243c4fb236dac6b5722373cf2ff1b85c95d2ae59212986309e32cc0e8d59967` |
| `linux_amd64`         | `77e6c429aa04f25da7962572f12b19113e0ce46080fa1365ad66017aadcdb68d` |

Linux dynamically uses distribution-provided libsecret (LGPL-2.1-or-later),
GTK 3 (LGPL-2.1-or-later) and WebKitGTK (LGPL/BSD components); these libraries
are not copied into the package. Their sources/licenses are supplied by the
distribution package manager. Windows requires Microsoft's separately installed
WebView2 Evergreen Runtime and uses the OS Credential Manager API. The Windows
installer is generated by NSIS (zlib/libpng license); GCC runtime components
use the GCC Runtime Library Exception. Sparkle is bundled only on macOS.

The native x64 DuckDB module licenses are included separately in `licenses/`.
Windows runtime notices include GCC's `COPYING3` and `COPYING.RUNTIME` from
[the GCC 15 release branch](https://github.com/gcc-mirror/gcc/tree/releases/gcc-15),
and NSIS's [complete component notices](https://github.com/NSIS-Dev/nsis/blob/v313/COPYING)
in `licenses/nsis-LICENSE.txt`.
