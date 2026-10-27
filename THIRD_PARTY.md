# Third-party software

Bamboo's original application code is MIT licensed. Dependencies retain their own licenses.

- MyGo **v0.6.4**, release commit `6255ea40139d06e0762a7c4a32626148ba410478`: MIT. Provides the native window, OS webview, dialogs, and generated TypeScript IPC. The corresponding npm `mygo-runtime` is pinned to **0.6.4** (MIT).
- DuckDB Go **v2.20000.0**, bindings **v0.20000.0**, bundled DuckDB **2.0.0**: MIT. DuckDB is statically linked; its native library includes core extensions and third-party components. Upstream source and full component license notices: https://github.com/duckdb/duckdb/tree/v2.0.0/third_party and https://github.com/duckdb/duckdb/blob/v2.0.0/LICENSE . These should be reviewed before public redistribution; this artifact is a local development build.
- Compiled Go dependency license texts and versions are recorded in `licenses/manifest.json` and adjacent files. These include purego (Apache-2.0), x/text (BSD-style), uuid (BSD-style), and mapstructure (MIT).
- TypeScript and Vite are development tools. Exact transitive versions and package integrity hashes are in `package-lock.json`; Go versions and checksums are in `go.mod` / `go.sum`.
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
