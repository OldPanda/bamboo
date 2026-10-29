#!/usr/bin/env python3
"""Validate release versions and stamp macOS bundle metadata before signing."""

import argparse
import base64
import json
import os
import plistlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(
    r"v?(?P<core>(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))"
    r"(?:-(?P<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
)


def parse_version(value):
    """Return the filename version, numeric bundle version and prerelease flag."""
    match = VERSION.fullmatch(value)
    if not match:
        raise ValueError("Expected [v]MAJOR.MINOR.PATCH[-PRERELEASE]")
    prerelease = match.group("pre")
    if prerelease and any(
        part.isdigit() and len(part) > 1 and part.startswith("0")
        for part in prerelease.split(".")
    ):
        raise ValueError("Numeric prerelease identifiers cannot have leading zeros")
    return value.removeprefix("v"), match.group("core"), bool(prerelease)


def stamp_bundle(path, value):
    """Stamp the numeric Apple versions and retain the complete release version."""
    version, core, _ = parse_version(value)
    with path.open("rb") as source:
        info = plistlib.load(source)
    public_key = (ROOT / "assets/update-public-key.txt").read_text().strip()
    if len(base64.b64decode(public_key, validate=True)) != 32:
        raise ValueError("Invalid Sparkle public key")
    info.update(
        SUFeedURL="https://github.com/OldPanda/bamboo/releases/latest/download/appcast.xml",
        SUPublicEDKey=public_key,
        SUEnableAutomaticChecks=True,
        SUAutomaticallyUpdate=False,
        SUAllowsAutomaticUpdates=False,
        SUSendProfileInfo=False,
        SUVerifyUpdateBeforeExtraction=True,
        SURequireSignedFeed=True,
        CFBundleShortVersionString=core,
        CFBundleVersion=core,
        BambooReleaseVersion=version,
    )
    with path.open("wb") as target:
        plistlib.dump(info, target, sort_keys=False)


def main():
    """Validate the environment version, optionally updating plist and CI outputs."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plist", type=Path)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    value = os.environ.get("BAMBOO_VERSION")
    if value is None:
        value = json.loads((ROOT / "package.json").read_text())["version"]
    try:
        version, _, prerelease = parse_version(value)
    except ValueError as error:
        parser.error(str(error))
    if args.plist:
        stamp_bundle(args.plist, value)
    if args.github_output:
        with args.github_output.open("a") as output:
            output.write(f"version={version}\nprerelease={str(prerelease).lower()}\n")
    print(version)


if __name__ == "__main__":
    main()
