# Contributing to Bamboo

Bamboo builds on **macOS arm64**, with native **Windows x64 and Linux x64**
preview packaging on `feat/windows-linux-x64`. See [Windows/Linux](docs/windows-linux.md)
for native toolchains, installation requirements and acceptance commands.
For macOS, install Xcode Command Line Tools,
Node.js 22 or newer, Python 3.12 or newer, and Go with toolchain download support.
The release helper pins Go 1.27.3. Run commands from the repository root.

## Set up development tools

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
mkdir -p build/tools
GOTOOLCHAIN=go1.27.3 GOBIN="$PWD/build/tools" go install github.com/mgechev/revive@v1.17.1
```

Swift formatting uses `xcrun swift-format` from Xcode Command Line Tools
(validated with version 6.3.0). Python lint tools are pinned in
`requirements-dev.txt`; JavaScript lint tools are pinned in `package-lock.json`.

## Check a change

```sh
npm run build:web
npm run lint
python3 scripts/go-release.py test -count=1 -timeout=180s . ./internal/... ./cmd/...
npm run test:web
npm run build
```

`build:web` provides the embedded assets required by Go when starting from a
fresh checkout. `npm run lint` runs gofmt, Revive, go vet, ESLint, TypeScript,
Ruff, ShellCheck, Swift formatting and Prettier. It checks normal release and
cloud-fixture/performance build variants without launching the app. The release
helper uses the same static DuckDB link for build, test and vet.

`npm run format` applies formatting only. Review the diff afterward; add meaningful
documentation and fix semantic lint findings manually. Go exported APIs should
describe behavior and ownership, Python public functions/classes need docstrings,
and exported JavaScript/TypeScript functions need JSDoc when their purpose is
not already documented. Keep types in TypeScript signatures rather than repeating
them in comments.

Native smoke JavaScript files are async function bodies evaluated in WKWebView.
They are linted with that parse context and formatted through a temporary async
wrapper. The wrapper is not written into the source file. Generated IPC bindings
(`frontend/src/mygo.ts`), dependencies, licenses, build outputs and historical
local artifacts are excluded from source formatting. Generated bindings are still
checked by TypeScript and the application build.

## Tests and privacy

Unit and frontend tests run in the background. Native desktop acceptance checks
(`npm run coverage` and provider validation scripts) are separate, may launch a
window and require a logged-in macOS session. Never run those checks during an
unattended background-only session. Large benchmarks and Keychain tests are
explicitly opt-in; see their test guards and the validation documentation.

Use synthetic fixtures and test credentials. Do not commit cloud credentials,
local settings, personal paths in screenshots, generated datasets or `artifacts/`.
Keep API compatibility names and persisted settings identifiers stable unless a
migration is implemented and tested. See [SECURITY.md](SECURITY.md) for the data
access boundaries and [docs/artifacts.md](docs/artifacts.md) for local test outputs.

## Pull request checks

[CI](.github/workflows/ci.yml) runs for every pull request (including drafts),
pushes to `main`, merge-queue groups and manual dispatches. There are no path
filters or allowed-failure test steps. The required check name is
**`PR quality gate`**. CI calls the reusable [macOS checks](.github/workflows/macos.yml)
workflow once, shown as **`macOS / macOS arm64 checks`** in the PR checks list.
The existing `PR quality gate` is a small aggregation job: it passes only after
the macOS suite succeeds, and fails if that suite fails, is cancelled or is
skipped. Event triggers and concurrency stay in CI; the macOS workflow has no
independent event triggers.

The disposable macOS arm64 runner builds the app, checks generated bindings,
runs all language linters, tests the coverage checker, and runs both release and
cloud-smoke/performance Go test variants. Large-fixture and synthetic Keychain
tests are enabled. It also runs frontend coverage, native desktop and provider
smoke suites, all four headless visual suites, and every production-size
performance case once. Real cloud accounts and native picker/Finder gestures
remain manual acceptance; CI uses generated data and synthetic credentials.

`npm run coverage:ci` collects Go test and native-process profiles and requires
**at least 95% Go statement coverage** across the entire measured build scope.
Startup, fixtures and desktop smoke helpers remain counted. It separately
requires **95% frontend statements, branches, functions and lines**, including
generated IPC bindings. No percentages are averaged across languages. Tagged
performance tooling is tested separately; the Go percentage describes the
instrumented application/test build, not every platform or build-tag variant.

Unlike the historical local report, the CI gate needs no ignored baseline files.
It checks source hashes, matching Go block boundaries, all frontend source files,
and exact counts before rounding. Missing, stale or below-threshold evidence
fails the job. Reports and failure logs are retained as Actions artifacts for
14 days; the coverage summary also appears on the workflow run.

Run the safe checker regressions locally with:

```sh
python3 -m unittest discover -s scripts/tests -p 'test_*.py' -v
```

The full `coverage:ci` command needs an explicitly available macOS GUI session
and uses synthetic Keychain entries. Do not run it in a background-only local
session. `scripts/ci-keychain.sh` is restricted to disposable GitHub-hosted
runners and must not be used to change a developer's Keychain setup.

### Require CI before merging

A workflow file alone does not prevent merging. After publishing the repository
and running CI once, create an active branch ruleset for `main` in
**Settings → Rules → Rulesets**:

- Require a pull request before merging.
- Require status checks to pass: select **`PR quality gate`** from GitHub Actions.
- Require branches to be up to date before merging, or use a merge queue.
- Leave the bypass list empty so administrators follow the same checks.
- Block force pushes and deletion of `main`.

The workflow uses read-only repository permissions, immutable action SHAs and
`pull_request` rather than `pull_request_target`; it requires no repository
secrets. Do not run untrusted pull requests on a personal/self-hosted Mac.
See GitHub's [required status checks documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging).

## Version releases

Push a signed version tag such as `v0.1.0` to run
[Release](.github/workflows/release.yml). The tagged commit must include the release, CI and reusable macOS
workflow files. The release reuses the full CI quality gate, including the 95%
coverage thresholds; failed checks prevent packaging and publication.

```sh
git tag -s v0.1.0 -m "Bamboo 0.1.0"
git push origin v0.1.0
```

Tags use `vMAJOR.MINOR.PATCH`, optionally followed by a prerelease identifier
such as `-rc.1`. Prerelease tags produce GitHub prereleases. Other tag names are
not release versions; malformed matching tags fail version validation.

The workflow builds **macOS Apple Silicon (arm64)**, stamps the version into the
app before signing, and attaches `Bamboo-<version>-macOS-arm64.dmg` and its
`.sha256` checksum to an automatically generated release. The DMG contains
`Bamboo.app` (including third-party licenses) and an Applications shortcut.
Numeric Apple bundle versions use the tag's three numeric components; the full
prerelease version is preserved in `BambooReleaseVersion`.

Build/test jobs have read-only permissions. Only the separate publishing job
receives `contents: write`, using GitHub's automatic token; no personal token is
needed. Assets upload to a draft before publication. Rerunning a failed upload
can finish that draft; an already published release is left unchanged.

Current packages use ad-hoc signing, **not Developer ID signing or Apple
notarization**. The release notes state this explicitly. Configure a separate
signing/notarization process before distributing as a notarized application.

For a local installer, use the same version for both commands:

```sh
BAMBOO_VERSION=v0.1.0 npm run build
BAMBOO_VERSION=v0.1.0 npm run package:dmg
```

Outputs stay in the ignored `build/releases/` directory. Never move an existing
published version tag to a different commit; create a new version instead.

See [Automatic updates](docs/automatic-updates.md) for the one-time signing secret,
stable release feed and native updater checks. Version releases now require
`SPARKLE_PRIVATE_KEY`; ordinary PR tests continue to run without repository secrets.
