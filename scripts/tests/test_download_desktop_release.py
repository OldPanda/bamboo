"""Check public asset selection and fail-closed handling without network access."""

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location(
    "download_desktop_release", SCRIPTS / "download-desktop-release.py"
)
DOWNLOAD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DOWNLOAD)


class DownloadReleaseTests(unittest.TestCase):
    """Only fresh, native, explicitly versioned public assets may reach acceptance."""

    def test_native_assets(self):
        """Fetch both formats and checksums from the versioned public release."""
        for system, suffixes in (
            ("Windows", ("-setup.exe", ".zip")),
            ("Linux", (".deb", ".tar.gz")),
        ):
            with self.subTest(system=system), tempfile.TemporaryDirectory() as temp:
                with (
                    patch.object(DOWNLOAD, "ROOT", Path(temp)),
                    patch.object(DOWNLOAD.platform, "system", return_value=system),
                    patch.dict(
                        os.environ, GITHUB_ACTIONS="true", BAMBOO_VERSION="v0.1.1"
                    ),
                    patch.object(DOWNLOAD.urllib.request, "urlretrieve") as retrieve,
                ):
                    DOWNLOAD.main()
                expected = []
                for suffix in suffixes:
                    name = f"Bamboo-0.1.1-{system.lower()}-x64{suffix}"
                    expected.extend((name, name + ".sha256"))
                self.assertEqual(
                    [call.args[0] for call in retrieve.call_args_list],
                    [
                        "https://github.com/OldPanda/bamboo/releases/download/v0.1.1/"
                        + name
                        for name in expected
                    ],
                )

    def test_existing_artifacts_are_rejected(self):
        """Never let local build bytes masquerade as downloaded release bytes."""
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            releases = root / "build/releases"
            releases.mkdir(parents=True)
            existing = releases / "old.zip"
            existing.write_bytes(b"keep")
            with (
                patch.object(DOWNLOAD, "ROOT", root),
                patch.object(DOWNLOAD.platform, "system", return_value="Windows"),
                patch.dict(os.environ, GITHUB_ACTIONS="true", BAMBOO_VERSION="v0.1.1"),
                patch.object(DOWNLOAD.urllib.request, "urlretrieve") as retrieve,
                self.assertRaises(SystemExit),
            ):
                DOWNLOAD.main()
            retrieve.assert_not_called()
            self.assertEqual(existing.read_bytes(), b"keep")

    def test_malformed_version_is_rejected(self):
        """Reject path injection before any download or filesystem mutation."""
        with (
            patch.dict(os.environ, GITHUB_ACTIONS="true", BAMBOO_VERSION="../0.1.1"),
            patch.object(DOWNLOAD.urllib.request, "urlretrieve") as retrieve,
            self.assertRaises(ValueError),
        ):
            DOWNLOAD.main()
        retrieve.assert_not_called()
