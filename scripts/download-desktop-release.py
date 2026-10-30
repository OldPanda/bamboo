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
    if system not in ("windows", "linux"):
        raise SystemExit("Expected Windows or Linux")
    releases = ROOT / "build/releases"
    releases.mkdir(parents=True, exist_ok=True)
    if any(releases.iterdir()):
        raise SystemExit("Hosted verification requires an empty release directory")
    suffixes = ("-setup.exe", ".zip") if system == "windows" else (".deb", ".tar.gz")
    base = f"https://github.com/OldPanda/bamboo/releases/download/v{version}/"
    for suffix in suffixes:
        name = f"Bamboo-{version}-{system}-x64{suffix}"
        for asset in (name, name + ".sha256"):
            urllib.request.urlretrieve(base + asset, releases / asset)


if __name__ == "__main__":
    main()
