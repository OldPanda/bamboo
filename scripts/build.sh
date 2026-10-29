#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export GOTOOLCHAIN=go1.27.3
# Reject invalid versions before doing any build work.
python3 scripts/release_version.py >/dev/null
python3 scripts/prepare-httpfs.py
python3 scripts/prepare-sparkle.py
# A tiny placeholder breaks the first-build embed/bindings dependency cycle.
mkdir -p frontend/dist build
if [ ! -f frontend/dist/index.html ]; then printf '<!doctype html><title>Bamboo</title>' > frontend/dist/index.html; fi
python3 scripts/go-release.py build -o build/bamboo .
MYGO_GENERATE=frontend/src/mygo.ts build/bamboo
npm run build:web
python3 scripts/go-release.py build -trimpath -o build/bamboo .
if [ "$(uname -s)" = Darwin ]; then
  # Package from an empty staging directory; stale generated files cannot survive.
  stage_dir=$(mktemp -d "$PWD/build/.bamboo-package.XXXXXX")
  trap 'rm -rf "$stage_dir"' EXIT
  bundle="$stage_dir/Bamboo.app"
  mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
  cp build/bamboo "$bundle/Contents/MacOS/Bamboo"
  # Keep the Dock tile aligned with the calibrated native macOS silhouette.
  swift -module-cache-path build/icon-module-cache scripts/package-icon.swift assets/dock-template.png frontend/src/assets/bamboo.png build/Bamboo-icon.png
  # Generate the full macOS icon family from the packaged artwork.
  mkdir -p build/Bamboo.iconset
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" build/Bamboo-icon.png --out "build/Bamboo.iconset/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z "$double" "$double" build/Bamboo-icon.png --out "build/Bamboo.iconset/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns build/Bamboo.iconset -o "$bundle/Contents/Resources/Bamboo.icns"
  cat > "$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Bamboo</string>
<key>CFBundleDisplayName</key><string>Bamboo</string>
<key>CFBundleIdentifier</key><string>local.bamboo.workbench</string>
<key>CFBundleExecutable</key><string>Bamboo</string>
<key>CFBundleIconFile</key><string>Bamboo.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
  python3 scripts/release_version.py --plist "$bundle/Contents/Info.plist" >/dev/null
  mkdir -p "$bundle/Contents/Resources/extensions"
  cp build/extensions/httpfs.duckdb_extension "$bundle/Contents/Resources/extensions/"
  cp -R licenses "$bundle/Contents/Resources/"
  cp LICENSE THIRD_PARTY.md "$bundle/Contents/Resources/"
  mkdir -p "$bundle/Contents/Frameworks"
  ditto build/sparkle/Sparkle.framework "$bundle/Contents/Frameworks/Sparkle.framework"
  # Keep upstream nested helper signatures; seal our ad-hoc app around the framework.
  codesign --force --sign - "$bundle"
  codesign --verify --deep --strict "$bundle"
  python3 - "$bundle" "$PWD/build/Bamboo.app" "$stage_dir/previous.app" <<'PYTHON'
import os, pathlib, sys
staged, target, previous = map(pathlib.Path, sys.argv[1:])
if target.exists():
    os.replace(target, previous)
try:
    os.replace(staged, target)
except BaseException:
    if previous.exists():
        os.replace(previous, target)
    raise
PYTHON
  printf 'Built %s/build/Bamboo.app\n' "$PWD"
fi
