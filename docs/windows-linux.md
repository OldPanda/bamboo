# Windows and Linux x64 preview

These packages extend Bamboo to Windows x64 and Linux x64. The macOS arm64
release and Sparkle update process are unchanged. No Intel Mac or ARM64 Windows/
Linux package is provided. Preview artifacts are built for PRs and `main`;
they are not a stable GitHub Release.

## Installation

- Windows 10/11 x64: run the `-setup.exe` installer for the current user, or
  extract the portable `.zip` and run `Bamboo/bamboo.exe`. Keep the `extensions`
  and `licenses` directories beside the executable. Microsoft Edge WebView2
  Evergreen x64 Runtime is required; install it from
  [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).
  Packages are unsigned, so Windows may display a SmartScreen warning.
- Ubuntu 22.04+ / compatible Debian x64 desktop: install the `.deb` with
  `sudo apt install ./Bamboo-<version>-linux-x64.deb`. A GTK 3/WebKitGTK 4.1
  desktop and libsecret are required. Alternatively extract the `.tar.gz` and
  run `Bamboo/bamboo` with those libraries installed. Other distributions have
  not been validated. The portable archive does not install system libraries.

Cloud credentials use Windows Credential Manager or the desktop Secret Service
(e.g. GNOME Keyring). Linux requires an active user D-Bus session and an unlocked
Secret Service. Missing/locked credential storage produces an error; Bamboo does
not fall back to plaintext. Local files work independently of the cloud vault.
Uninstalling keeps user settings and credential entries; remove saved cloud
connections from Bamboo first if you want to remove their credentials.

Settings → General → Check for updates opens the official releases page. Download
and install a compatible package explicitly. There are no automatic downloads,
installs, or restarts on these platforms; automatic checking remains disabled.

## Build and verify

Build on the target OS with Go 1.27.3, Node 22, Python 3.12, curl, and a native
C/C++ compiler. Windows uses MinGW-w64 GCC and NSIS. Linux also needs
`libsecret-1-dev`, `pkg-config`, GTK 3, WebKitGTK 4.1, and `dpkg-deb`.

```sh
npm ci
python scripts/build-desktop.py
python scripts/go-release.py test -p=1 -count=1 -timeout=300s . ./internal/... ./cmd/...
npm run test:web
python scripts/package-desktop.py
```

`BAMBOO_VERSION` selects the version before building and packaging. Packages
include `build-info.json`, licenses and a platform-specific hash-pinned official
DuckDB 2.0 httpfs extension. SHA256 files accompany each package in
`build/releases/`. Existing output names are never overwritten.

The Desktop x64 packages workflow uses real Windows/Linux runners, synthetic
credential entries, mock cloud transport, read-only SQL/export regressions and
native WebView/IPC acceptance. Linux UI acceptance uses Xvfb. No live cloud
credentials or developer desktop windows are used. Acceptance binaries contain
UI automation; distribution binaries are separately built with `bamboo_release`
and MyGo production mode. CI artifacts expire after 14 days; retain downloaded
packages and checksums for delivery.

See [Desktop CI scheduling](ci-workflows.md) for triggers, cancellation, parallel
checks and cache policy. Branches without a PR can use manual dispatch.
