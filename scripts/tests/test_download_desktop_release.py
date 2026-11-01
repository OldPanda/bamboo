"""Check public asset selection and fail-closed handling without network access."""

import importlib.util
import io
import json
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

    def test_latest_metadata_rejects_invalid_or_oversized_responses(self):
        """An invalid latest-tag response cannot disable the feed comparison."""
        for data in (b'{"tag_name":"../0.2.0"}', b"x" * (1024 * 1024 + 1)):
            with (
                self.subTest(bytes=len(data)),
                patch.object(
                    DOWNLOAD.urllib.request, "urlopen", return_value=io.BytesIO(data)
                ),
                self.assertRaises(ValueError),
            ):
                DOWNLOAD.latest_release_version()

    def test_macos_and_latest_feed(self):
        """Download the DMG plus both versioned and configured latest feed bytes."""
        with tempfile.TemporaryDirectory() as temp:
            with (
                patch.object(DOWNLOAD, "ROOT", Path(temp)),
                patch.object(DOWNLOAD.platform, "system", return_value="Darwin"),
                patch.dict(os.environ, GITHUB_ACTIONS="true", BAMBOO_VERSION="v0.2.0"),
                patch.object(DOWNLOAD.urllib.request, "urlretrieve") as retrieve,
                patch.object(
                    DOWNLOAD.urllib.request,
                    "urlopen",
                    return_value=io.BytesIO(
                        json.dumps({"tag_name": "v0.3.0"}).encode()
                    ),
                ),
            ):
                DOWNLOAD.main()
                self.assertEqual(
                    (
                        Path(temp) / "build/releases/latest-release-version.txt"
                    ).read_text(),
                    "0.3.0\n",
                )
            self.assertEqual(
                [call.args[1].name for call in retrieve.call_args_list],
                [
                    "Bamboo-0.2.0-macOS-arm64.dmg",
                    "Bamboo-0.2.0-macOS-arm64.dmg.sha256",
                    "appcast.xml",
                    "latest-appcast.xml",
                ],
            )
            self.assertEqual(
                retrieve.call_args.args[0],
                "https://github.com/OldPanda/bamboo/releases/latest/download/appcast.xml",
            )

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
