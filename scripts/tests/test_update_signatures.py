"""Verify real Sparkle signatures using a disposable, public test-only seed."""

import base64
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location(
    "signature_appcast", ROOT / "scripts/sign-appcast.py"
)
assert SPEC and SPEC.loader
APPCAST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APPCAST)
# This all-zero test fixture is not Bamboo's real signing identity.
SEED = base64.b64encode(bytes(32)).decode()


class SparkleSignatureTests(unittest.TestCase):
    """Reject tampered update bytes and feeds with the actual pinned verifier."""

    def invoke(self, *arguments):
        """Send the test seed through stdin, never through argv or Keychain."""
        return subprocess.run(
            [
                str(ROOT / "build/sparkle/bin/sign_update"),
                "--ed-key-file",
                "-",
                *map(str, arguments),
            ],
            input=SEED,
            text=True,
            capture_output=True,
            check=False,
            timeout=20,
        )

    def test_signed_archive_and_feed_reject_tampering(self):
        """Require correct signatures for both archive bytes and release metadata."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "synthetic-update.dmg"
            archive.write_bytes(b"Synthetic update signature fixture")
            signed = self.invoke("-p", archive)
            self.assertEqual(signed.returncode, 0, signed.stderr)
            signature = signed.stdout.strip()
            self.assertEqual(self.invoke("--verify", archive, signature).returncode, 0)
            archive.write_bytes(archive.read_bytes() + b"tampered")
            self.assertNotEqual(
                self.invoke("--verify", archive, signature).returncode, 0
            )
            feed = root / "appcast.xml"
            feed.write_bytes(APPCAST.make_feed("v1.2.3", signature, 123, "test"))
            result = self.invoke(feed)
            self.assertEqual(result.returncode, 0, result.stderr)
            verified = self.invoke("--verify", feed)
            self.assertEqual(verified.returncode, 0, verified.stderr)
            feed.write_bytes(
                feed.read_bytes().replace(b"Bamboo 1.2.3", b"Bamboo 9.9.9")
            )
            self.assertNotEqual(self.invoke("--verify", feed).returncode, 0)

    def test_swift_derivation_matches_known_public_key(self):
        """Verify the CI identity comparison uses the correct Ed25519 derivation."""
        result = subprocess.run(
            ["swift", "scripts/update-key.swift"],
            cwd=ROOT,
            input=SEED,
            text=True,
            capture_output=True,
            check=True,
            timeout=60,
        )
        expected = bytes.fromhex(
            "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29"
        )
        self.assertEqual(base64.b64decode(result.stdout.strip()), expected)


if __name__ == "__main__":
    unittest.main()
