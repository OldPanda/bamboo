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
