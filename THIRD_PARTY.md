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
