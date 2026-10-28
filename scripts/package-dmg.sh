#!/bin/bash
# Build a verified, compressed drag-to-Applications installer from the signed app.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  printf 'DMG packaging requires macOS arm64.\n' >&2
  exit 1
fi
version=$(python3 scripts/release_version.py)
bundle="$PWD/build/Bamboo.app"
actual=$(/usr/libexec/PlistBuddy -c 'Print :BambooReleaseVersion' "$bundle/Contents/Info.plist")
if [ "$actual" != "$version" ]; then
  printf 'App version mismatch; build with the same BAMBOO_VERSION first.\n' >&2
  exit 1
fi
codesign --verify --deep --strict "$bundle"
test "$(lipo -archs "$bundle/Contents/MacOS/Bamboo")" = arm64
test -f "$bundle/Contents/Resources/LICENSE"
test -f "$bundle/Contents/Resources/THIRD_PARTY.md"
test -f "$bundle/Contents/Resources/licenses/manifest.json"
mkdir -p build/releases
stage=$(mktemp -d "$PWD/build/.bamboo-dmg.XXXXXX")
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/contents"
ditto "$bundle" "$stage/contents/Bamboo.app"
ln -s /Applications "$stage/contents/Applications"
name="Bamboo-${version}-macOS-arm64.dmg"
hdiutil create -volname "Bamboo $version" -srcfolder "$stage/contents"   -fs HFS+ -format UDZO "$stage/$name"
hdiutil verify "$stage/$name"
# Publish only a complete verified image; reruns replace local build outputs.
mv -f "$stage/$name" "build/releases/$name"
(cd build/releases && shasum -a 256 "$name" > "$name.sha256")
printf 'Built build/releases/%s\n' "$name"
