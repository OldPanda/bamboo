#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export GOTOOLCHAIN=go1.27.3
# A tiny placeholder breaks the first-build embed/bindings dependency cycle.
mkdir -p frontend/dist build
if [ ! -f frontend/dist/index.html ]; then printf '<!doctype html><title>Bamboo</title>' > frontend/dist/index.html; fi
go build -ldflags='-s -w' -o build/bamboo .
MYGO_GENERATE=frontend/src/mygo.ts build/bamboo
npm run build:web
go build -trimpath -ldflags='-s -w' -o build/bamboo .
if [ "$(uname -s)" = Darwin ]; then
  mkdir -p build/Bamboo.app/Contents/MacOS build/Bamboo.app/Contents/Resources
  cp build/bamboo build/Bamboo.app/Contents/MacOS/Bamboo
  cat > build/Bamboo.app/Contents/Info.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Bamboo</string>
<key>CFBundleDisplayName</key><string>Bamboo</string>
<key>CFBundleIdentifier</key><string>local.bamboo.workbench</string>
<key>CFBundleExecutable</key><string>Bamboo</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
  cp -R licenses build/Bamboo.app/Contents/Resources/
  cp LICENSE THIRD_PARTY.md build/Bamboo.app/Contents/Resources/
  codesign --force --sign - build/Bamboo.app
  printf 'Built %s/build/Bamboo.app\n' "$PWD"
fi
