#!/usr/bin/env python3
"""Verify the actual DMG; optional native launch is restricted to disposable CI."""

import argparse
import hashlib
import json
import os
import plistlib
import re
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path

from release_version import parse_version

ROOT = Path(__file__).resolve().parents[1]
SPARKLE = "http://www.andymatuschak.org/xml-namespaces/sparkle"


def feed_signatures(data, version, archive):
    """Validate exact signed XML boundaries and versioned enclosure metadata."""
    marker = b"<!-- sparkle-signatures:\n"
    offset = data.rfind(marker)
    match = re.fullmatch(
        rb"<!-- sparkle-signatures:\nedSignature: ([A-Za-z0-9+/=]+)\nlength: ([0-9]+)\n-->\s*",
        data[offset:] if offset >= 0 else b"",
    )
    if not match or int(match[2]) != offset:
        raise ValueError("Invalid signed-feed boundary")
    item = ET.fromstring(data).find("channel/item")
    if item is None:
        raise ValueError("Missing release item")
    enclosure = item.find("enclosure")
    expected = f"https://github.com/OldPanda/bamboo/releases/download/v{version}/{archive.name}"
    if (
        enclosure is None
        or enclosure.get("url") != expected
        or enclosure.get("length") != str(archive.stat().st_size)
        or item.findtext(f"{{{SPARKLE}}}shortVersionString") != version
        or item.findtext(f"{{{SPARKLE}}}version") != parse_version(version)[1]
        or item.findtext(f"{{{SPARKLE}}}hardwareRequirements") != "arm64"
    ):
        raise ValueError("Feed does not describe the expected versioned archive")
    return data[:offset], match[1].decode(), enclosure.get(f"{{{SPARKLE}}}edSignature")


def launch(bundle, output, helper):
    """Require a visible installed production window, then send native Quit."""
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise ValueError("Native package launch requires a disposable Actions runner")
    env = {**os.environ, "BAMBOO_CONFIG_DIR": str(output / "config")}
    env.pop("BAMBOO_SMOKE", None)
    with (output / "installed.log").open("w") as log:
        process = subprocess.Popen(
            [str(bundle / "Contents/MacOS/Bamboo")],
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 40
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Packaged app exited before opening a window")
                visible = subprocess.run(
                    [str(helper), str(process.pid), "visible"],
                    capture_output=True,
                    timeout=5,
                )
                if visible.returncode == 0:
                    break
                time.sleep(0.25)
            else:
                raise RuntimeError("Packaged app did not open a native window")
            subprocess.run(
                [str(helper), str(process.pid), "quit"], check=True, timeout=5
            )
            if process.wait(timeout=20) != 0:
                raise RuntimeError("Packaged app did not quit cleanly")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def main():
    """Mount read-only, verify pinned resources, and optionally install/launch."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--feed", action="store_true")
    parser.add_argument("--launch", action="store_true")
    args = parser.parse_args()
    if args.launch and os.environ.get("GITHUB_ACTIONS") != "true":
        parser.error("Native package launch requires a disposable Actions runner")
    version, core, _ = parse_version(os.environ["BAMBOO_VERSION"])
    releases = ROOT / "build/releases"
    archive = releases / f"Bamboo-{version}-macOS-arm64.dmg"
    digest, name = archive.with_suffix(".dmg.sha256").read_text().strip().split("  ", 1)
    if (
        name != archive.name
        or hashlib.sha256(archive.read_bytes()).hexdigest() != digest
    ):
        raise ValueError("DMG checksum mismatch")
    output = ROOT / "artifacts/macos-package-smoke"
    output.mkdir(parents=True, exist_ok=True)
    key = (ROOT / "assets/update-public-key.txt").read_text().strip()
    with tempfile.TemporaryDirectory(prefix="bamboo-package-") as temporary:
        staging = Path(temporary)
        if args.feed:
            data = (releases / "appcast.xml").read_bytes()
            prefix, signature, archive_signature = feed_signatures(
                data, version, archive
            )
            signed = staging / "signed-prefix.xml"
            signed.write_bytes(prefix)
            verifier = staging / "verify-signature"
            subprocess.run(
                [
                    "swiftc",
                    "scripts/verify-update-signature.swift",
                    "-o",
                    str(verifier),
                ],
                cwd=ROOT,
                check=True,
            )
            for path, value in ((signed, signature), (archive, archive_signature)):
                subprocess.run([str(verifier), key, str(path), value], check=True)
            latest = releases / "latest-appcast.xml"
            if latest.exists() and latest.read_bytes() != data:
                raise ValueError(
                    "Latest update feed differs from the published release"
                )
        subprocess.run(["hdiutil", "verify", str(archive)], check=True)
        mount = staging / "mounted"
        mount.mkdir()
        subprocess.run(
            [
                "hdiutil",
                "attach",
                "-readonly",
                "-nobrowse",
                "-mountpoint",
                str(mount),
                str(archive),
            ],
            check=True,
        )
        try:
            bundle = mount / "Bamboo.app"
            binary = bundle / "Contents/MacOS/Bamboo"
            info = plistlib.loads((bundle / "Contents/Info.plist").read_bytes())
            expected = {
                "BambooReleaseVersion": version,
                "CFBundleShortVersionString": core,
                "CFBundleVersion": core,
                "SUPublicEDKey": key,
                "SUFeedURL": "https://github.com/OldPanda/bamboo/releases/latest/download/appcast.xml",
                "SUAutomaticallyUpdate": False,
                "SUAllowsAutomaticUpdates": False,
                "SURequireSignedFeed": True,
                "SUVerifyUpdateBeforeExtraction": True,
                "SUSendProfileInfo": False,
            }
            if any(
                info.get(k) != v or type(info.get(k)) is not type(v)
                for k, v in expected.items()
            ):
                raise ValueError("Bundle version or update-consent policy mismatch")
            if os.readlink(mount / "Applications") != "/Applications":
                raise ValueError("Missing drag-to-Applications destination")
            subprocess.run(
                ["codesign", "--verify", "--deep", "--strict", str(bundle)], check=True
            )
            signing = subprocess.run(
                ["codesign", "--display", "--verbose=4", str(bundle)],
                capture_output=True,
                text=True,
                check=True,
            )
            if "Signature=adhoc" not in signing.stderr:
                raise ValueError("Expected the documented ad-hoc signing status")
            if (
                subprocess.check_output(
                    ["lipo", "-archs", str(binary)], text=True
                ).strip()
                != "arm64"
            ):
                raise ValueError("Expected native Apple Silicon executable")
            for relative in ("LICENSE", "THIRD_PARTY.md", "licenses/manifest.json"):
                if not (bundle / "Contents/Resources" / relative).is_file():
                    raise ValueError("Missing packaged resource: " + relative)
            extension = bundle / "Contents/Resources/extensions/httpfs.duckdb_extension"
            if (
                hashlib.sha256(extension.read_bytes()).hexdigest()
                != "c2d72a98ad081bf4d62c908b8d9f60b70ab1b83faa9141fc7e7d53526658761d"
            ):
                raise ValueError("Bundled extension differs from pinned release bytes")
            commit = subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
            ).strip()
            build = subprocess.check_output(
                ["go", "version", "-m", str(binary)], text=True
            )
            if (
                f"vcs.revision={commit}\n" not in build
                or str(ROOT).encode() in binary.read_bytes()
            ):
                raise ValueError("Executable provenance or trimpath mismatch")
            if args.launch:
                installed = staging / "installed/Bamboo.app"
                subprocess.run(["ditto", str(bundle), str(installed)], check=True)
                subprocess.run(
                    ["codesign", "--verify", "--deep", "--strict", str(installed)],
                    check=True,
                )
                helper = staging / "package-window"
                subprocess.run(
                    ["swiftc", "scripts/package-window.swift", "-o", str(helper)],
                    cwd=ROOT,
                    check=True,
                )
                launch(installed, output, helper)
        finally:
            subprocess.run(["hdiutil", "detach", str(mount)], check=True)
    report = {
        "version": version,
        "commit": commit,
        "sha256": digest,
        "bytes": archive.stat().st_size,
        "architecture": "arm64",
        "adHocSignature": True,
        "notarized": False,
        "signedFeedVerified": args.feed,
        "installedLaunchAndQuit": args.launch,
    }
    (output / "package-smoke.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
