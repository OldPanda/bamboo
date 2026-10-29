#!/bin/bash
# Explicit one-time transfer from Bamboo's Keychain item to its Actions secret.
set -euo pipefail
cd "$(dirname "$0")/.."
mode=${1:-upload}
if [ "$mode" != upload ] && [ "$mode" != --copy ]; then
  printf 'Usage: bash scripts/configure-update-signing.sh [--copy]\n' >&2
  exit 1
fi
if [ "$mode" = upload ]; then
  command -v gh >/dev/null || { printf 'Install GitHub CLI and run gh auth login, or use --copy for GitHub Settings.\n' >&2; exit 1; }
  gh auth status >/dev/null
fi
python3 scripts/prepare-sparkle.py
expected=$(tr -d '\n' < assets/update-public-key.txt)
actual=$(build/sparkle/bin/generate_keys --account Bamboo-OldPanda -p)
if [ "$expected" != "$actual" ]; then
  printf 'The Keychain signing identity does not match this app.\n' >&2
  exit 1
fi
umask 077
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
build/sparkle/bin/generate_keys --account Bamboo-OldPanda -x "$stage/private-key" >/dev/null
if [ "$mode" = --copy ]; then
  pbcopy < "$stage/private-key"
  printf 'Copied the signing key. Add SPARKLE_PRIVATE_KEY at:\nhttps://github.com/OldPanda/bamboo/settings/secrets/actions/new\nPaste it into Secret, save, then clear the clipboard. Do not paste it into chat.\n'
else
  gh secret set SPARKLE_PRIVATE_KEY --repo OldPanda/bamboo < "$stage/private-key"
  gh secret list --repo OldPanda/bamboo --json name --jq '.[].name' | rg '^SPARKLE_PRIVATE_KEY$'
fi
