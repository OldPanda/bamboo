# Desktop CI scheduling

The [Desktop x64 packages workflow](../.github/workflows/desktop-x64.yml) runs
Windows and Linux builds concurrently, with independent native release tests,
credential-vault tests, desktop acceptance, packaging and installed-startup
checks. A failure on one platform does not cancel the other platform's evidence.
The job names remain `desktop (ubuntu-22.04)` and `desktop (windows-2025)`.

## Events and cancellation

| Event                          | Behavior                                                                 |
| ------------------------------ | ------------------------------------------------------------------------ |
| Pull request, including drafts | Run both platforms on the PR merge commit; no path filters.              |
| Feature-branch push            | No automatic desktop run; opening/updating a PR covers the change.       |
| Push to `main`                 | Verify the merged result and populate the default-branch npm cache.      |
| Merge queue (`merge_group`)    | Run both platforms for the merge-group commit.                           |
| Manual dispatch                | Run both platforms on the selected ref, including branches without a PR. |

New runs cancel outdated runs for the same event and PR/ref. Event names are
part of the concurrency key: a manual run must not cancel a required PR,
`main` push or merge-group run. Workflow-specific prefixes keep desktop and
macOS checks independent. Do not add PR path filters when these checks are
required: skipped workflows can leave required checks pending. See GitHub's
[required-check guidance](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

The existing macOS `PR quality gate`, its native acceptance, security checks and
95% Go/frontend coverage thresholds are unchanged. The release workflow still
calls `ci.yml`; this desktop workflow does not publish releases or add tag
triggers. If checks are selected in a branch ruleset, require both desktop
matrix jobs as well as the quality gate. Changing this workflow does not edit
repository rulesets.

## Work placement and caches

The platform-independent jsdom frontend regression suite runs once on Linux
within the desktop matrix. Both platforms still generate and diff the IPC
bindings, type-check/build the frontend, run the full release Go tests and test
the actual platform WebView and packages. Frontend coverage remains enforced
by the existing macOS quality gate. Neither native job waits for the other.

`setup-node` caches npm's package download store, keyed by the root lockfile and
runner platform. `npm ci --prefer-offline` reuses cached content while retaining
the lockfile/integrity checks and fetching missing packages. It does not reuse
`node_modules` or build outputs.

Go caching remains disabled deliberately. A local inventory of the pinned
DuckDB modules found approximately 729 MiB of extracted libraries plus 151 MiB
of download archives, before the Go build cache or other modules. A broad
`setup-go` cache would include these large native libraries. A future cache
experiment should measure platform-specific compressed size, restore/save time
and hit rate before enabling it; do not share compiled native outputs across
platforms or skip extension integrity checks on a cache hit.

## Measurement

The pre-change baseline uses PR #5 head `576612b`, which ran both
[push CI](https://github.com/OldPanda/bamboo/actions/runs/41084078431) and
[PR CI](https://github.com/OldPanda/bamboo/actions/runs/41101899801).

| Run               | Linux job | Windows job |
| ----------------- | --------: | ----------: |
| Push, 41084078431 |    3m 37s |      4m 15s |
| PR, 41101899801   |    4m 09s |      7m 18s |

These are job `started_at` to `completed_at` durations from the Actions API,
not queue latency or benchmark percentiles. The push run spent 15 seconds on
Linux frontend tests and 16 seconds on the duplicated Windows frontend tests.
The two events ran at different times; this demonstrates duplicated validation
of the same head, not a controlled performance comparison. Removing the
feature push trigger prevents that second automatic matrix after a PR exists.

To evaluate a change, record run event, head SHA, job/step timestamps, conclusions
and cache restore results. Verify that a branch push with an open PR creates
one desktop PR run; supersede it with a new commit and check cancellation. Also
check that both native jobs finish on the latest commit. Queue delays and
GitHub service interruptions are separate from execution cost; do not promise
to eliminate them or infer a speedup percentage from a few runs.
