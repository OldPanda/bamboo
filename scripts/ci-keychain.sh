#!/bin/bash
# Isolate synthetic credential tests on a disposable GitHub-hosted macOS runner.
set -euo pipefail
if [ "${GITHUB_ACTIONS:-}" != true ] || [ "${RUNNER_ENVIRONMENT:-}" != github-hosted ] || [ "$(uname -s)" != Darwin ]; then
  echo 'CI Keychain setup is restricted to disposable GitHub-hosted macOS runners.' >&2
  exit 1
fi
: "${RUNNER_TEMP:?Missing runner temporary directory}"
keychain="$RUNNER_TEMP/bamboo-ci.keychain-db"
previous="$RUNNER_TEMP/bamboo-ci-previous-keychain"
case "${1:-}" in
  create)
    security default-keychain -d user > "$previous"
    password=$(openssl rand -hex 32)
    echo "::add-mask::$password"
    security create-keychain -p "$password" "$keychain"
    security set-keychain-settings -lut 7200 "$keychain"
    security unlock-keychain -p "$password" "$keychain"
    security default-keychain -d user -s "$keychain"
    ;;
  delete)
    if [ -f "$previous" ]; then
      saved=$(sed 's/^[[:space:]]*"//;s/"[[:space:]]*$//' "$previous")
      security default-keychain -d user -s "$saved"
      rm "$previous"
    fi
    if [ -f "$keychain" ]; then security delete-keychain "$keychain"; fi
    ;;
  *) echo 'Usage: scripts/ci-keychain.sh create|delete' >&2; exit 2 ;;
esac
