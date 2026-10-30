# Working on Bamboo

Bamboo is a Parquet workbench built with Go, MyGo, DuckDB and TypeScript,
with macOS arm64 and native Windows/Linux x64 builds.
It opens local files and folders plus explicitly configured Amazon S3 and
Cloudflare R2 workspaces. Prioritize data integrity, exact values, bounded
resource use and a quiet, clear desktop experience.

## Start with the actual state

- Read `git status` and the relevant implementation before editing. Preserve
  unrelated changes, including work another contributor is currently making.
- Trace the whole affected path: UI → generated bridge → Workbench → engine or
  storage. A visible error can originate in a different layer.
- Read the relevant references below, then check them against source. Some root
  documents contain historical validation results, not current guarantees.
- Make the smallest coherent change. Extend the existing flow before adding a
  second entry point, provider-specific subsystem or dependency.

| Area                                        | Implementation                                                                                    | Reference                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Window and application lifecycle            | `main.go`, `window_lifecycle.go`                                                                  | [Contributing](CONTRIBUTING.md)                                       |
| IPC, export and settings                    | `workbench.go`, `workspace.go`, `cloudstorage.go`, `appearance.go`, `language.go`, `resources.go` | [Settings](SETTINGS.md), [Security](SECURITY.md)                      |
| Query validation, execution and budgets     | `internal/engine/`                                                                                | [Workspace SQL](WORKSPACE_SQL.md)                                     |
| Local workspace identity and persistence    | `internal/workspace/`                                                                             | [Folder workspaces](FOLDER_WORKSPACES.md)                             |
| Cloud credentials, listing and ranged reads | `internal/cloudstorage/`                                                                          | [R2](R2_WORKSPACES.md), [S3](S3_WORKSPACES.md)                        |
| UI, translations and editor behavior        | `frontend/src/`, `frontend/tests/`                                                                | [Contributing](CONTRIBUTING.md)                                       |
| Synthetic data and protocol fixtures        | `internal/fixtures/`, `internal/cloudstoragetest/`                                                | [Validation](VALIDATION.md)                                           |
| Packaging and local evidence                | `scripts/`, `assets/`, `licenses/`                                                                | [Artifacts](docs/artifacts.md), [Third-party notices](THIRD_PARTY.md) |

## Protect the user's data

- Keep user queries read-only. Validate before driver preparation or DESCRIBE:
  the DuckDB Go driver can execute preceding statements in a multi-statement
  request. SELECT wrapping and a first-keyword check are insufficient.
- Keep the lexical gate and independent DuckDB parser check. Unsupported quote
  syntax must fail closed. Changes to either SQL scanner require regression
  cases for escape strings, comments, nested wrappers and statement boundaries.
- A path allowlist is not a read-only filesystem. Security regressions must
  verify source-file hashes and side effects, even when the query returns an
  error. Reproduce attacks only against generated temporary fixtures.
- Quote identifiers, bind values, and keep cross-file references within the
  explicitly opened workspace. Preserve canonical-path and symlink checks.
- Preserve exact decimals, large integers, timestamps, nested values and NULL
  through Go, IPC and rendering. Do not route them through JavaScript numbers.
- Export only the selected result snapshot. Never overwrite an existing file.
  Protect CSV headers and formula-like text while preserving valid numeric
  values; document any transformation and keep JSON available for exact values.
- On Windows, private files and spill directories require protected native ACLs;
  POSIX mode bits do not provide that protection. Permission-failure tests must
  use real ACL denials rather than skipping the checks or relying on `Chmod`.
- Render file names, data, errors and connection labels as text. Keep dynamic
  values out of HTML templates and preserve CSP and bridge/navigation controls.

## Keep cloud and resource boundaries explicit

- Shared storage code uses provider-neutral names. Provider-specific protocol
  behavior stays explicit; adding a provider must not silently weaken another.
- Renaming code does not authorize changing saved JSON names, connection IDs,
  Keychain service names or IPC compatibility names. Migrate and test persisted
  state before changing those identifiers.
- Credentials belong in the platform vault, never logs, query text, localStorage
  or workspace JSON. Clear credential form fields on submission and dismissal.
  Use synthetic credentials for tests; live cloud access is opt-in.
- Retain HTTPS endpoint validation, redirect restrictions, signing, prefix
  containment and the scoped loopback gateway. Do not add ambient credential
  discovery or arbitrary endpoint access as a convenience.
- Read large files by bounded ranges. Cache identity must include object/version
  identity; maintain ETag checks, capacity limits, cancellation and scope cleanup.
  Test repeated previews and pagination using transferred bytes, not time alone.
- Memory and temporary-disk settings are budgets, not eager allocations or a
  promise about total app memory. Recheck available disk at query time, retain
  the free-space reserve and preserve the meaning of zero spill allowance.
- Temporary files must be private and owned by a known query/session. Handle
  cleanup failures; recovery must not delete another running instance's files.
- A path-only “verified” cache cannot establish that an extension's current bytes
  are unchanged. Preserve pinned downloads and verify content at load boundaries.
- Native parsing runs with process privileges. Do not describe application-level
  limits or SQL validation as an OS sandbox.

## Preserve the desktop experience

These are established interaction conventions; change them deliberately when
requested, and update their tests together.

- Keep one obvious primary action in an empty state. Accept welcome-page drops
  only inside the displayed drop area, with clear enter, leave and release feedback.
- Settings keeps a stable outer size when switching sections; overflow scrolls
  inside. General groups appearance and language. A dropdown must look selectable.
- Resource sliders show scales and units, support useful snap points and exact
  numeric entry, and distinguish Auto from Custom without losing user intent.
- Workspaces collapse independently. Group refresh, rename and close actions at
  the right edge; expanding/collapsing must not reset the current query.
- Opening a cloud connection and managing saved connections are different flows.
  Reuse provider choices, branding and forms rather than duplicating controls.
- On macOS, the red close button hides the window; Dock activation restores it.
  Explicit Quit must still terminate. Test repeated hide/show cycles and quitting
  from both visible and hidden states.
- Background update checks may discover and announce a new version. Installation
  and relaunch require an explicit user action; never silently update or restart
  an active session. Preserve this policy even if older preferences enabled
  automatic downloads, and test it against the real updater framework.
- Update English and Chinese together in `frontend/src/i18n.ts`. Use existing
  design tokens, accessible labels, keyboard behavior and visible focus states.
  Check both appearances, longer translations and narrow windows.
- Use the existing product artwork and provider assets. Preserve transparent
  in-app artwork and the native Dock tile treatment as separate uses.

## Implement and verify proportionately

Use [CONTRIBUTING.md](CONTRIBUTING.md) for tool setup. Work from the repository
root; commands and documentation must not depend on a developer's home path.

```sh
npm run build:web
npm run lint
python3 scripts/go-release.py test -count=1 -timeout=180s . ./internal/... ./cmd/...
npm run test:web
npm run build
```

- Choose checks appropriate to the change. Documentation-only edits need format,
  link and privacy checks, not a full application rebuild. For behavior changes,
  run focused regressions first, then the affected broader checks above.
- Use `scripts/go-release.py` for Go build/test/vet so tests exercise the release
  DuckDB libraries and build tags. A generic `go test` result is not equivalent.
  Build frontend assets first on a fresh checkout because Go embeds them.
- `frontend/src/mygo.ts` is generated by the build. Change the Go API and regenerate
  bindings rather than hand-editing the bridge or adding unrelated generated churn.
- Explain exported Go APIs and non-obvious public Python/TypeScript interfaces.
  Prefer documentation of behavior, ownership and failure handling over comments
  that merely restate a name. Follow the existing formatters and lint configuration.
- Prefer background unit tests and headless visual checks. Never foreground the
  app or manipulate the user's windows for routine verification. Native picker,
  Finder and Dock checks need an explicitly suitable interactive session.
- Mocked IPC screenshots verify layout, not native integration. Unit tests,
  synthetic cloud tests and live-provider acceptance are separate evidence.
- Concurrency/cache changes warrant targeted race checks. SQL, export and path
  changes warrant adversarial inputs and source-immutability checks.
- On Windows, observe actively written spill-file sizes through live file-handle
  metadata with read/write/delete sharing. NTFS directory-entry sizes can remain
  stale while DuckDB's writer is open; presence alone does not prove nonempty spill.
- Performance work uses real generated Parquet, including large and small-file
  cases, repeated reads, cancellation and low-memory spill. Start with
  `npm run test:perf -- --quick --runs 1`; run the full suite when relevant and
  resources permit. Clean generated data and distinguish simulated latency from
  actual cloud measurements. Do not infer a p95 from three samples.
- Reproduce regressions before fixing them where practical. A test asserting that
  an exploit succeeds is an audit probe; the final regression must assert rejection
  and unchanged data. Do not weaken tests just to produce a green result.

## Prepare changes for sharing

- Every Bamboo version release ships macOS Apple Silicon, Windows x64 and Linux
  x64 together: DMG, Windows setup EXE and ZIP, Linux DEB and tar.gz, each with
  SHA-256. Require all native gates before publishing the complete release set;
  update the website only after the actual hosted assets are verified.

- Keep README concise: product logo, purpose, useful capabilities and a short
  start path. Put implementation detail in the relevant reference document.
- Keep `licenses/`, dependency manifests and third-party notices in the repository
  and release package. Update them when dependencies or bundled assets change.
- Keep `artifacts/`, `.hallmark/`, build outputs, generated datasets and local
  settings out of Git. Promote reusable checks into `scripts/`; ignored evidence
  must not become a prerequisite for a fresh clone.
- Review text, screenshots and binaries for personal paths and credentials before
  publication. Deleting a file in a new commit does not remove it from history.
  Do not rewrite history or push as part of routine cleanup without authorization.
- Preserve unrelated staged work. Commit only when requested, using the owner's
  configured identity and signing preference. Do not add `Original-commit`
  trailers or silently disable GPG signing when it needs local unlocking.
- Use the packaging script and inspect the resulting bundle when shipping an app.
  Preserve `-trimpath`, pinned extension hashes and removal of development hooks.
  Distinguish ad-hoc signature verification from Developer ID signing/notarization.
- Dependency scanners supplement code review. Check Go, npm and relevant tooling,
  and separately account for native DuckDB/httpfs components. Triage findings;
  neither a scanner's severity nor zero reported CVEs establishes exploitability
  or safety.

## Finish with evidence

Describe the resulting behavior, what was verified, and any remaining limitation.
Link the actual changed files or deliverable. Do not claim a build, native UI check,
coverage figure, privacy cleanup or vulnerability fix that was not verified for
this revision. Update affected documentation and keep reusable lessons here when
new failures reveal a general rule; do not turn this file into a dated work log.
