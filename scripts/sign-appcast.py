#!/usr/bin/env python3
"""Sign a versioned DMG and its Sparkle appcast without exposing private keys."""

import base64
import os
import subprocess
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import format_datetime

from release_version import ROOT, parse_version

SPARKLE = "http://www.andymatuschak.org/xml-namespaces/sparkle"
ET.register_namespace("sparkle", SPARKLE)
ACCOUNT = "Bamboo-OldPanda"


def key_options():
    """Verify the signing identity against the app's pinned public key before signing."""
    expected = (ROOT / "assets/update-public-key.txt").read_text().strip()
    secret = os.environ.get("SPARKLE_PRIVATE_KEY")
    if secret is not None:
        # Invalid or empty CI secrets must never fall back to an ambient Keychain.
        try:
            valid = len(base64.b64decode(secret.strip(), validate=True)) == 32
        except ValueError:
            valid = False
        if not valid:
            raise ValueError("SPARKLE_PRIVATE_KEY must contain a base64 32-byte seed")
        result = subprocess.run(
            ["swift", "scripts/update-key.swift"],
            cwd=ROOT,
            input=secret,
            text=True,
            capture_output=True,
            check=True,
        )
        actual = result.stdout.strip()
        options = ["--ed-key-file", "-"]
    else:
        if os.environ.get("GITHUB_ACTIONS") == "true":
            raise ValueError(
                "Configure the SPARKLE_PRIVATE_KEY Actions secret before releasing"
            )
        actual = subprocess.check_output(
            [str(ROOT / "build/sparkle/bin/generate_keys"), "--account", ACCOUNT, "-p"],
            text=True,
        ).strip()
        options = ["--account", ACCOUNT]
    if actual != expected:
        raise ValueError("Sparkle signing key does not match the bundled public key")
    return options, secret


def make_feed(version, signature, length, published):
    """Build one HTTPS-only release item, without untrusted HTML release notes."""
    clean, core, _ = parse_version(version)
    if length <= 0 or len(base64.b64decode(signature, validate=True)) != 64:
        raise ValueError("Invalid signed archive metadata")
    rss = ET.Element("rss", version="2.0")
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = "Bamboo updates"
    ET.SubElement(channel, "link").text = "https://github.com/OldPanda/bamboo"
    item = ET.SubElement(channel, "item")
    ET.SubElement(item, "title").text = f"Bamboo {clean}"
    ET.SubElement(item, "pubDate").text = published
    ET.SubElement(item, f"{{{SPARKLE}}}version").text = core
    ET.SubElement(item, f"{{{SPARKLE}}}shortVersionString").text = clean
    ET.SubElement(item, f"{{{SPARKLE}}}minimumSystemVersion").text = "12.0.0"
    ET.SubElement(item, f"{{{SPARKLE}}}hardwareRequirements").text = "arm64"
    ET.SubElement(
        item,
        "enclosure",
        {
            "url": f"https://github.com/OldPanda/bamboo/releases/download/v{clean}/Bamboo-{clean}-macOS-arm64.dmg",
            "type": "application/octet-stream",
            "length": str(length),
            f"{{{SPARKLE}}}edSignature": signature,
        },
    )
    ET.indent(rss)
    return ET.tostring(rss, encoding="utf-8", xml_declaration=True) + b"\n"


def main():
    """Sign and verify both archive and feed using a matching local or CI identity."""
    version, _, _ = parse_version(os.environ["BAMBOO_VERSION"])
    options, secret = key_options()
    tool = str(ROOT / "build/sparkle/bin/sign_update")
    directory = ROOT / "build/releases"
    archive = directory / f"Bamboo-{version}-macOS-arm64.dmg"
    signature = subprocess.run(
        [tool, *options, "-p", str(archive)],
        input=secret,
        text=True,
        capture_output=True,
        check=True,
    ).stdout.strip()
    subprocess.run(
        [tool, *options, "--verify", str(archive), signature],
        input=secret,
        text=True,
        check=True,
    )
    feed = directory / "appcast.xml"
    feed.write_bytes(
        make_feed(
            version,
            signature,
            archive.stat().st_size,
            format_datetime(datetime.now(timezone.utc)),
        )
    )
    subprocess.run([tool, *options, str(feed)], input=secret, text=True, check=True)
    subprocess.run(
        [tool, *options, "--verify", str(feed)], input=secret, text=True, check=True
    )
    print(f"Signed and verified {archive.name} and appcast.xml")


if __name__ == "__main__":
    main()
