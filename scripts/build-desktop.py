#!/usr/bin/env python3
"""Build native Windows/Linux binaries with the same release link and generated bridge."""

import os
import platform
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*args, env=None):
    """Run one build step from the repository root and propagate failures."""
    subprocess.run(args, cwd=ROOT, env=env, check=True)


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
