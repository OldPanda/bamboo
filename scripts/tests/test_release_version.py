"""Test untrusted tag validation and version stamping before release signing."""

import importlib.util
import os
import plistlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "release_version.py"
SPEC = importlib.util.spec_from_file_location("release_version", SCRIPT)
assert SPEC and SPEC.loader
VERSION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERSION)


class ReleaseVersionTests(unittest.TestCase):
    """Keep tag-derived paths, CI outputs and bundle metadata well formed."""

    def test_supported_versions(self):
        """Accept stable and prerelease versions without losing identifiers."""
        for value, expected in (
            ("v1.2.3", ("1.2.3", "1.2.3", False)),
            ("0.1.0", ("0.1.0", "0.1.0", False)),
            ("v2.0.0-rc.1", ("2.0.0-rc.1", "2.0.0", True)),
            ("v1.0.0-beta-2", ("1.0.0-beta-2", "1.0.0", True)),
        ):
            with self.subTest(value=value):
                self.assertEqual(VERSION.parse_version(value), expected)

    def test_invalid_tags(self):
        """Reject path traversal, output injection and malformed numeric versions."""
        for value in (
            "",
            "v1.2",
            "v01.2.3",
            "v1.2.3-01",
            "v1.2.3-rc..1",
            "v1.2.3/../../secret",
            "v1.2.3\nprerelease=false",
            "$(id)",
            "v1.2.3+build.1",
            "v1.2.3 ",
            "v1.2.3\n",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                VERSION.parse_version(value)

    def test_stamp_and_ci_output(self):
        """Use numeric Apple fields while retaining the prerelease and other keys."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plist = root / "Info.plist"
            output = root / "github-output"
            plist.write_bytes(
                plistlib.dumps(
                    {
                        "CFBundleName": "Bamboo",
                        "SUAutomaticallyUpdate": True,
                        "SUAllowsAutomaticUpdates": True,
                    }
                )
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--plist",
                    str(plist),
                    "--github-output",
                    str(output),
                ],
                env={**os.environ, "BAMBOO_VERSION": "v2.3.4-rc.1"},
                capture_output=True,
                text=True,
                check=True,
            )
            info = plistlib.loads(plist.read_bytes())
            self.assertEqual(info["CFBundleName"], "Bamboo")
            self.assertEqual(info["CFBundleVersion"], "2.3.4")
            self.assertEqual(info["CFBundleShortVersionString"], "2.3.4")
            self.assertEqual(info["BambooReleaseVersion"], "2.3.4-rc.1")
            self.assertIs(info["SUEnableAutomaticChecks"], True)
            self.assertIs(info["SUAutomaticallyUpdate"], False)
            self.assertIs(info["SUAllowsAutomaticUpdates"], False)
            self.assertEqual(result.stdout, "2.3.4-rc.1\n")
            self.assertEqual(
                output.read_text(), "version=2.3.4-rc.1\nprerelease=true\n"
            )

    def test_invalid_version_has_no_side_effects(self):
        """Fail before touching either bundle metadata or GitHub output files."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plist, output = root / "Info.plist", root / "output"
            plist.write_text("unchanged")
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--plist",
                    str(plist),
                    "--github-output",
                    str(output),
                ],
                env={**os.environ, "BAMBOO_VERSION": "v1.2.3\nunsafe=value"},
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(plist.read_text(), "unchanged")
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
