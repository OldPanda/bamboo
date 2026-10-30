#!/bin/bash
set -euo pipefail
# Synthetic, disposable runner-only keyring; never touch a developer's login store.
if [ "${GITHUB_ACTIONS:-}" != true ]; then
  echo 'This script requires a disposable GitHub Actions runner' >&2
  exit 1
fi
export XDG_DATA_HOME="$RUNNER_TEMP/bamboo-keyring"
mkdir -p "$XDG_DATA_HOME"
printf 'bamboo-synthetic-ci-password' | gnome-keyring-daemon --unlock --components=secrets
python scripts/go-release.py test -v -p=1 -count=1 -timeout=180s . ./internal/... ./cmd/...
python scripts/desktop-platform-smoke.py
