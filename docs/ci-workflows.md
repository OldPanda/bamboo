# CI and release scheduling

[CI](../.github/workflows/ci.yml) runs the website checks and, for application
changes, the complete macOS quality suite. [Desktop x64](../.github/workflows/desktop-x64.yml)
runs Windows and Linux concurrently with independent native release tests,
credential-vault tests, spill regressions, desktop acceptance, packaging and
installed-startup checks. Matrix failures do not cancel another platform.
The 95% Go/frontend coverage requirements and production-size performance cases
remain in the macOS suite.

## Required results and change scope

Both entry workflows run for every PR, main push and merge group; neither has
path-based trigger filters that could leave a required check pending. Manual
runs and formal releases always select full validation. Concurrency includes the
event, so a manual run cannot cancel a PR check. Feature-branch pushes are covered
by PR events rather than another automatic native run.

The shared [scope selector](../scripts/ci_scope.py) permits a short path only
when the entire exact Git diff consists of ordinary, non-executable website file
additions/modifications. PRs must have the expected base/head merge parents;
main pushes must have complete, ancestral before/after commits. Unknown events,
missing history, empty comparisons, renames, deletions, symlinks, mode changes,
and mixed application/workflow changes select the full suite. Classification
failure blocks the summaries; it does not silently succeed.

Stable summary contexts are `PR quality gate`, `desktop (ubuntu-22.04)` and
`desktop (windows-2025)`. Full validation requires successful native jobs;
website-only validation explicitly expects them to be skipped. CI always
requires `Website / Website build and browser checks`, covering website unit,
release/catalog boundary, build, SEO and headless browser checks. Website is now
called by CI, so it runs once instead of both independently and inside macOS.
Website-only summaries attest scope and website validation, **not native tests**.

[Release website sync](../website/scripts/sync-release.mjs) requires eligible
`pull_request` runs of CI and both desktop summaries, bound to the repository,
current head/base and latest attempts. Its real published-asset verification
remains separate. It ignores candidate dispatches. Existing App credential
configuration is still required for automated catalog writes and merges.

Repository policy is separate from YAML: inspection on 2026-11-01 found the
active main ruleset required PRs but had no required status-check rule; the
classic branch-protection endpoint returned 404. This change does not edit those
rules. When configuring required checks, select all three stable summaries.

## Build once within a release run

[Release](../.github/workflows/release.yml) starts the full quality suite and
Windows/Linux packages concurrently. The macOS quality job already builds the
production app, packages the DMG and verifies installed startup; it now exports
that DMG's SHA-256 and immutable artifact ID through reusable-workflow outputs.
The downstream macOS job downloads **that ID from the same run**, checks the
repository, exact source SHA, run, attempt, version, architecture and digest,
then signs the original archive and verifies the transferred package and feed.
The app/framework never passes through a ZIP extraction: executable permissions
and symlinks remain inside the disk image.

Absent/expired downloads, missing outputs or any identity/content mismatch select
a clean full build, package and native startup check. Downloaded checksum files
are checked against the upstream job output; rewriting the manifest and checksum
does not authorize changed bytes. A failed-only rerun may retain an unchanged
successful producer's earlier attempt, but publication still requires the actual
current `needs` results. There is no lookup of arbitrary earlier workflow runs,
PR artifacts, same-name checks or cached success records. Cross-run/main-to-tag
reuse is deliberately deferred until its extra trust and version boundaries can
be justified by measurement.

Only `Publish GitHub Release` has `contents: write`. It explicitly needs quality,
macOS and desktop success and a version-tag push. It checks all five installers
and SHA-256 sidecars before publication. Hosted-asset checks still download and
install the real public bytes on fresh native runners after publication.

A manual Release dispatch builds a candidate at the selected branch's package
version and exercises transfer; `rebuild=true` deliberately supplies a mismatched expected digest after
downloading and mounting the real candidate successfully, exercising both
verified transfer and clean rebuild fallback in the same acceptance run.
Neither manual mode reads the Sparkle signing secret, runs the publisher, creates
a tag nor modifies a hosted release. It is not a substitute for PR-event checks
or the next formal tag/signing/hosted-download acceptance.

## Eliminated duplication and retained boundaries

- One macOS production app/DMG build per successful release run, instead of two.
- Native Windows/Linux work overlaps macOS quality instead of waiting for it.
- One frontend regression/coverage invocation on macOS; the extra Linux jsdom
  invocation is removed. Each OS still generates/diffs bindings, builds its
  frontend and tests its real native WebView.
- Each desktop installer uploads once; evidence artifacts contain logs/reports,
  not another copy of the installers. Hosted verification skips Node and NSIS
  setup and authenticates only the GitHub metadata request.
- Each visual fixture group starts one headless browser. Scenarios use independent
  browser contexts and retain all screenshots, assertions and functional limits.
  Protocol/exit waits are bounded, browser diagnostics are retained, and no
  failed capture is automatically retried.

Release, smoke, coverage and performance Go builds have different tags or
instrumentation and are intentionally retained. OS/architecture binaries are not
interchangeable. npm's integrity-checked download store remains cached; Go's large
native module/build caches remain disabled pending measured cache economics.

## Measurement and evidence

The existing five-release baseline measured tag-trigger to public packages:
0.1.3 **31:37**, 0.1.4 **31:42**, 0.1.5 **33:04**, 0.2.0 **31:11**,
0.2.1 **44:38**. For 0.2.1, quality took 29:35, then macOS 5:24,
Windows 14:32 and Linux 12:05 ran in parallel. Overlapping the latter work with
quality removes that serial wait; actual savings still depend on runner queueing,
cache state and signing/transfer time. These are baseline observations, not an
optimized release measurement.

Record Actions run/event/head, attempt-specific jobs, start/end timestamps,
cache restore logs and conclusions. A failed-only rerun inherits earlier jobs
that did not execute again: deduplicate by job ID rather than counting their
runtime twice. Failed/cancelled attempts remain evidence; do not replace a newer
failure with an earlier success. Do not infer percentiles from a few runs.

Local regressions exercise the actual summary/publish shell blocks, real temporary
Git histories, candidate tampering/fallback and browser context isolation. The
real PR/candidate runs and their timings belong in the PR acceptance record.
