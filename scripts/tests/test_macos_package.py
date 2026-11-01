"""Check signed-feed metadata and fail closed before mounting or native launch."""

import base64
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))


def module(name, filename):
    """Load an existing command-line helper without running its main function."""
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


VERIFY = module("verify_macos_package", "verify-macos-package.py")
APPCAST = module("macos_package_appcast", "sign-appcast.py")


class MacOSPackageTests(unittest.TestCase):
    """Bind signatures to exact bytes, declared size, architecture and version."""

    def test_public_verifier_and_feed_boundaries(self):
        """Use the real Sparkle signer with a public fixture seed; reject tampering."""
        seed = base64.b64encode(bytes(32)).decode()
        key = base64.b64encode(
            bytes.fromhex(
                "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29"
            )
        ).decode()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "Bamboo-0.2.0-macOS-arm64.dmg"
            archive.write_bytes(b"Synthetic archive, never installable")
            signer = [str(ROOT / "build/sparkle/bin/sign_update"), "--ed-key-file", "-"]
            signature = subprocess.check_output(
                [*signer, "-p", str(archive)], input=seed, text=True
            ).strip()
            feed = root / "appcast.xml"
            feed.write_bytes(
                APPCAST.make_feed("0.2.0", signature, archive.stat().st_size, "test")
            )
            subprocess.run(
                [*signer, str(feed)],
                input=seed,
                text=True,
                check=True,
                capture_output=True,
            )
            data = feed.read_bytes()
            prefix, feed_signature, archive_signature = VERIFY.feed_signatures(
                data, "0.2.0", archive
            )
            signed = root / "prefix.xml"
            signed.write_bytes(prefix)
            verifier = root / "verify"
            subprocess.run(
                [
                    "swiftc",
                    str(ROOT / "scripts/verify-update-signature.swift"),
                    "-o",
                    str(verifier),
                ],
                check=True,
                capture_output=True,
            )
            for path, value in ((archive, archive_signature), (signed, feed_signature)):
                subprocess.run(
                    [str(verifier), key, str(path), value],
                    check=True,
                    capture_output=True,
                )
                path.write_bytes(path.read_bytes() + b"tampered")
                result = subprocess.run(
                    [str(verifier), key, str(path), value], capture_output=True
                )
                self.assertNotEqual(result.returncode, 0)
            archive.write_bytes(b"Synthetic archive, never installable")
            for invalid in (
                data.replace(b"0.2.0", b"9.9.9"),
                data.replace(b"arm64", b"amd64"),
                data.replace(b"length: ", b"length: 9"),
                data + b"unexpected",
            ):
                with self.assertRaises(ValueError):
                    VERIFY.feed_signatures(invalid, "0.2.0", archive)

    def test_launch_requires_ci_before_other_actions(self):
        """Calling launch verification locally must not open a window or mount."""
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(sys, "argv", ["verify-macos-package.py", "--launch"]),
            patch.object(VERIFY.subprocess, "run") as run,
            self.assertRaises(SystemExit),
        ):
            VERIFY.main()
        run.assert_not_called()
