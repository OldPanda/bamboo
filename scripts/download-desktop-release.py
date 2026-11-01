#!/usr/bin/env python3
"""Download public release bytes for native installation checks on disposable CI."""

import os
import platform
import urllib.request
from pathlib import Path

from release_version import parse_version

ROOT = Path(__file__).resolve().parents[1]


def main():
    """Fetch both native formats and checksums without substituting local builds."""
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise SystemExit("Hosted package checks require a disposable Actions runner")
    version = parse_version(os.environ["BAMBOO_VERSION"])[0]
    system = platform.system().lower()
    if system not in ("windows", "linux", "darwin"):
        raise SystemExit("Expected a supported native desktop platform")
    releases = ROOT / "build/releases"
    releases.mkdir(parents=True, exist_ok=True)
    if any(releases.iterdir()):
        raise SystemExit("Hosted verification requires an empty release directory")
    suffixes = {
        "windows": ("windows-x64-setup.exe", "windows-x64.zip"),
        "linux": ("linux-x64.deb", "linux-x64.tar.gz"),
        "darwin": ("macOS-arm64.dmg",),
    }[system]
    base = f"https://github.com/OldPanda/bamboo/releases/download/v{version}/"
    for suffix in suffixes:
        name = f"Bamboo-{version}-{suffix}"
        for asset in (name, name + ".sha256"):
            urllib.request.urlretrieve(base + asset, releases / asset)
    if system == "darwin":
        urllib.request.urlretrieve(base + "appcast.xml", releases / "appcast.xml")
        urllib.request.urlretrieve(
            "https://github.com/OldPanda/bamboo/releases/latest/download/appcast.xml",
            releases / "latest-appcast.xml",
        )


if __name__ == "__main__":
    main()
