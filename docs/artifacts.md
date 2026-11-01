# Development artifacts

`artifacts/` contains local generated evidence: screenshots, test logs, coverage,
performance reports and interface previews. The entire directory is ignored by
Git. Removing it from tracking does not delete local files or rewrite old commits.
Historical measurements in the root documentation describe their original runs;
their local report paths are not files supplied by a fresh clone.

## Files kept in the repository

- `scripts/`: reusable build, smoke, coverage and performance tools.
- `scripts/visual/`: promoted headless checks for the current workspace actions,
  welcome entry/drop zone and compact General settings layout.

Screenshots containing development paths are excluded from public documentation.
Original screenshots and scripts remain alongside their local reports to preserve
historical evidence. Superseded probes, baseline samplers, generated coverage
JavaScript and one-off scripts tied to an old build stay local in `artifacts/`.

## Generate local evidence

Run from the project root after installing the documented build dependencies:

```sh
npm run coverage
npm run test:perf -- --quick --runs 1
```

Coverage writes `artifacts/coverage/SUMMARY.md` and `artifacts/coverage/report.html`.
Performance writes a timestamped directory under `artifacts/performance/`.
The README describes full performance runs and native smoke requirements.

The promoted visual checks require Python 3.9+, Node 22.12+, Google Chrome at its
standard macOS application path, and an existing `frontend/dist/` from the build.
They use headless Chrome and mocked IPC; they do not replace native desktop tests.

```sh
python3 scripts/visual/workspace-actions/visual-check.py
python3 scripts/visual/welcome-single-entry/visual-check.py
python3 scripts/visual/general-compact/visual-check.py
```

Each check creates its own directory under `artifacts/visual/` for PNG and JSON
results. It finds the project and its capture helper relative to the script, so
no original developer home directory or pre-existing artifact directory is needed.

## Release package evidence

PR CI builds native candidate packages and verifies their installed production
startup on disposable runners. The release workflow repeats these checks and
then downloads the actual hosted packages for all three platforms. macOS checks
also validate the DMG and signed appcast with the committed public key, inspect
the mounted bundle read-only, and compare the configured latest-feed bytes when
GitHub identifies the verified tag as the latest release. Rerunning an older
release still verifies its versioned feed and archive signatures independently.
The CI metadata lookup uses the workflow's read-only repository token to avoid
shared-runner anonymous API limits. That token is restricted to the fixed GitHub
API request, rejects redirects, and is not sent to public assets or the app.
Native launch checks never run on a developer's desktop; local inspection is:

```sh
BAMBOO_VERSION=0.2.0 python3 scripts/verify-macos-package.py
```

This verifies an already-built DMG without opening the app. `--feed` additionally
requires the real signed appcast; `--launch` is restricted to disposable CI.
Reports live in `artifacts/macos-package-smoke/`. Archive signatures, installed
startup, native feature smoke and an actual updater install/relaunch are separate
evidence; these checks do not claim a cross-version Sparkle update was performed.

If hosted macOS verification needs repaired tooling after a release is published,
dispatch `verify-published-macos.yml` on `main` with its existing stable tag. It
uses the trusted current downloader with a separate checkout of the tag's original
verifier and pinned resources (available from 0.2.0), requires that commit in main
history, and checks matching package version and executable provenance. It only
downloads and verifies; it never
rebuilds, replaces a tag or uploads release assets. The metadata token is scoped
to the download step and is absent from the installed app's environment.
