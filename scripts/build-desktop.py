#!/usr/bin/env python3
"""Build native Windows/Linux binaries with the same release link and generated bridge."""

import json
import os
import platform
import subprocess
import sys
from pathlib import Path

from release_version import parse_version

ROOT = Path(__file__).resolve().parents[1]


def run(*args, env=None):
    """Run one build step from the repository root and propagate failures."""
    subprocess.run(args, cwd=ROOT, env=env, check=True)


def windows_resources():
    """Embed the existing artwork, DPI manifest and version in the Windows executable."""
    version, core, _ = parse_version(
        os.environ.get(
            "BAMBOO_VERSION", json.loads((ROOT / "package.json").read_text())["version"]
        )
    )
    run(
        "go",
        "run",
        "scripts/windows-icon.go",
        "frontend/src/assets/bamboo.png",
        "build/bamboo.ico",
    )
    resource = ROOT / "build/windows.rc"
    numeric = core.replace(".", ",") + ",0"
    resource.write_text(f'''#include <windows.h>
1 ICON "{(ROOT / "build/bamboo.ico").as_posix()}"
1 RT_MANIFEST "{(ROOT / "assets/windows.manifest").as_posix()}"
1 VERSIONINFO
FILEVERSION {numeric}
PRODUCTVERSION {numeric}
FILEOS VOS_NT_WINDOWS32
FILETYPE VFT_APP
BEGIN
 BLOCK "StringFileInfo"
 BEGIN
  BLOCK "040904b0"
  BEGIN
   VALUE "CompanyName", "Bamboo contributors"
   VALUE "FileDescription", "Bamboo Parquet workbench"
   VALUE "FileVersion", "{version}"
   VALUE "ProductName", "Bamboo"
   VALUE "ProductVersion", "{version}"
  END
 END
 BLOCK "VarFileInfo"
 BEGIN
  VALUE "Translation", 0x409, 1200
 END
END
''')
    run("windres", str(resource), "-O", "coff", "-o", "bamboo_windows_amd64.syso")


def main():
    """Build production and separate acceptance binaries on the native runner."""
    if platform.system() not in ("Windows", "Linux"):
        raise SystemExit("Use scripts/build.sh for macOS")
    run(sys.executable, "scripts/release_version.py")
    run(sys.executable, "scripts/prepare-httpfs.py")
    dist = ROOT / "frontend/dist"
    dist.mkdir(parents=True, exist_ok=True)
    if not (dist / "index.html").exists():
        (dist / "index.html").write_text("<!doctype html><title>Bamboo</title>")
    suffix = ".exe" if platform.system() == "Windows" else ""
    if suffix:
        windows_resources()
    binary = ROOT / f"build/bamboo{suffix}"
    run(
        sys.executable,
        "scripts/go-release.py",
        "build",
        "-o",
        str(binary),
        ".",
    )
    run(str(binary), env={**os.environ, "MYGO_GENERATE": "frontend/src/mygo.ts"})
    run("npm.cmd" if suffix else "npm", "run", "build:web")
    run(
        sys.executable,
        "scripts/go-release.py",
        "build",
        "-trimpath",
        "-o",
        str(binary),
        ".",
    )
    run(
        sys.executable,
        "scripts/go-release.py",
        "--with-smoke",
        "build",
        "-trimpath",
        "-o",
        f"build/bamboo-smoke{suffix}",
        ".",
    )
    run(
        sys.executable,
        "scripts/go-release.py",
        "build",
        "-trimpath",
        "-o",
        f"build/fixtures{suffix}",
        "./cmd/fixtures",
    )


if __name__ == "__main__":
    main()
