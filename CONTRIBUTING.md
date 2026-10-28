# Contributing to Bamboo

Bamboo currently builds on **macOS arm64**. Install Xcode Command Line Tools,
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
