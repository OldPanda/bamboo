"""Verify update-feed destinations, signed metadata and signing-identity checks."""

import base64
import importlib.util
import os
import subprocess
import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location("appcast", SCRIPTS / "sign-appcast.py")
assert SPEC and SPEC.loader
APPCAST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APPCAST)


class AppcastTests(unittest.TestCase):
    """Keep release metadata bound to the expected repository and pinned identity."""

    def test_feed_metadata(self):
        """Use only validated version paths, signed lengths and supported hardware."""
        signature = base64.b64encode(bytes(64)).decode()
        feed = ET.fromstring(APPCAST.make_feed("v1.2.3", signature, 123, "test-date"))
        item = feed.find("channel/item")
        self.assertIsNotNone(item)
        enclosure = item.find("enclosure")
        self.assertEqual(
            enclosure.get("url"),
            "https://github.com/OldPanda/bamboo/releases/download/v1.2.3/Bamboo-1.2.3-macOS-arm64.dmg",
        )
        self.assertEqual(enclosure.get("length"), "123")
        self.assertEqual(enclosure.get(f"{{{APPCAST.SPARKLE}}}edSignature"), signature)
        self.assertEqual(item.findtext(f"{{{APPCAST.SPARKLE}}}version"), "1.2.3")
        self.assertEqual(
            item.findtext(f"{{{APPCAST.SPARKLE}}}hardwareRequirements"), "arm64"
        )

    def test_reject_unsigned_or_invalid_metadata(self):
        """Reject empty archives, invalid signature lengths and tag injection."""
        for version, signature, size in (
            ("v1.2.3", "AA==", 100),
            ("v1.2.3", base64.b64encode(bytes(64)).decode(), 0),
            ("v1.2.3/../../payload", base64.b64encode(bytes(64)).decode(), 100),
        ):
            with (
                self.subTest(version=version, size=size),
                self.assertRaises(ValueError),
            ):
                APPCAST.make_feed(version, signature, size, "date")

    def test_ci_never_falls_back_to_ambient_keychain(self):
        """A missing or malformed secret fails before any signing tool is run."""
        for secret in (None, "", "not-base64", base64.b64encode(bytes(64)).decode()):
            env = {"GITHUB_ACTIONS": "true"}
            if secret is not None:
                env["SPARKLE_PRIVATE_KEY"] = secret
            with patch.dict(os.environ, env, clear=True), self.assertRaises(ValueError):
                APPCAST.key_options()

    def test_ci_key_must_match_bundle(self):
        """Derive the public key through stdin and reject a wrong private identity."""
        secret = base64.b64encode(bytes(32)).decode()
        expected = (APPCAST.ROOT / "assets/update-public-key.txt").read_text().strip()
        with patch.dict(os.environ, {"SPARKLE_PRIVATE_KEY": secret}, clear=True):
            with patch.object(
                APPCAST.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 0, expected + "\n"),
            ) as run:
                options, value = APPCAST.key_options()
                self.assertEqual(options, ["--ed-key-file", "-"])
                self.assertEqual(value, secret)
                self.assertEqual(run.call_args.kwargs["input"], secret)
                self.assertNotIn(secret, str(run.call_args.args[0]))
            with (
                patch.object(
                    APPCAST.subprocess,
                    "run",
                    return_value=subprocess.CompletedProcess([], 0, "wrong-key"),
                ),
                self.assertRaises(ValueError),
            ):
                APPCAST.key_options()

    def test_local_keychain_identity(self):
        """Local signing uses the dedicated account and verifies its public key."""
        expected = (APPCAST.ROOT / "assets/update-public-key.txt").read_text().strip()
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(APPCAST.subprocess, "check_output", return_value=expected),
        ):
            options, secret = APPCAST.key_options()
            self.assertEqual(options, ["--account", "Bamboo-OldPanda"])
            self.assertIsNone(secret)


if __name__ == "__main__":
    unittest.main()
