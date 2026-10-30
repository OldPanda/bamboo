"""Exercise the actual publish step with a fake GitHub CLI and no network."""

import hashlib
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/release.yml"


class ReleasePublishTests(unittest.TestCase):
    """Ensure failures cannot expose an incomplete release or replace a public one."""

    def run_publish(self, scenario):
        """Run the workflow's shell block against isolated deterministic commands."""
        script = textwrap.dedent(WORKFLOW.read_text().rsplit("        run: |\n", 1)[1])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "appcast.xml").write_text("signed-test-feed")
            (root / "release-notes.md").write_text("Product overview")
            for suffix in (
                "macOS-arm64.dmg",
                "windows-x64-setup.exe",
                "windows-x64.zip",
                "linux-x64.deb",
                "linux-x64.tar.gz",
            ):
                name = f"Bamboo-1.2.3-rc.1-{suffix}"
                data = ("synthetic " + suffix).encode()
                (root / name).write_bytes(data)
                (root / (name + ".sha256")).write_text(
                    f"{hashlib.sha256(data).hexdigest()}  {name}\n"
                )
            if scenario == "missing_linux":
                (root / "Bamboo-1.2.3-rc.1-linux-x64.deb").unlink()
            if scenario == "corrupt_windows":
                (root / "Bamboo-1.2.3-rc.1-windows-x64.zip").write_bytes(b"tampered")
            log = root / "calls"
            gh = root / "gh"
            gh.write_text(
                "#!/bin/bash\n"
                'echo "$*" >> "$CALL_LOG"\n'
                'case "$2" in\n'
                "  view)\n"
                '    case "$SCENARIO" in\n'
                "      published) echo false;;\n"
                "      draft) echo true;;\n"
                "      *) exit 1;;\n"
                "    esac;;\n"
                '  upload) [ "$SCENARIO" != upload_failure ];;\n'
                '  create) [ "$SCENARIO" != create_failure ];;\n'
                "  edit) exit 0;;\n"
                "  *) exit 99;;\n"
                "esac\n"
            )
            checksum = root / "sha256sum"
            checksum.write_text(
                f"#!{sys.executable}\n"
                "import hashlib, os, pathlib, sys\n"
                "digest, name = pathlib.Path(sys.argv[2]).read_text().strip().split('  ', 1)\n"
                "valid = hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest() == digest\n"
                "sys.exit(0 if valid and os.environ['SCENARIO'] != 'checksum_failure' else 1)\n"
            )
            gh.chmod(0o700)
            checksum.chmod(0o700)
            result = subprocess.run(
                ["bash", "-c", script],
                cwd=root,
                env={
                    **os.environ,
                    "PATH": f"{root}:/usr/bin:/bin",
                    "CALL_LOG": str(log),
                    "SCENARIO": scenario,
                    "TAG": "v1.2.3-rc.1",
                    "VERSION": "1.2.3-rc.1",
                    "PRERELEASE": "true",
                    "GH_TOKEN": "synthetic-test-token",
                    "GH_REPO": "example/bamboo",
                },
                capture_output=True,
                text=True,
                check=False,
            )
            calls = log.read_text().splitlines() if log.exists() else []
            return result.returncode, calls

    def test_new_release_publishes_after_upload(self):
        """Create a draft and publish only after the assets have uploaded."""
        code, calls = self.run_publish("new")
        self.assertEqual(code, 0)
        self.assertEqual(
            [call.split()[1] for call in calls], ["view", "create", "upload", "edit"]
        )
        self.assertIn("--draft ", calls[1])
        self.assertIn("--verify-tag", calls[1])
        self.assertIn("--notes-file release-notes.md", calls[1])
        self.assertIn("--prerelease=true", calls[1])
        self.assertIn("--draft=false", calls[-1])
        for suffix in (
            "macOS-arm64.dmg",
            "windows-x64-setup.exe",
            "windows-x64.zip",
            "linux-x64.deb",
            "linux-x64.tar.gz",
        ):
            self.assertIn(f"Bamboo-1.2.3-rc.1-{suffix} ", calls[-2])
            self.assertIn(f"Bamboo-1.2.3-rc.1-{suffix}.sha256", calls[-2])

    def test_draft_is_resumed(self):
        """Retry an interrupted draft without trying to create it again."""
        code, calls = self.run_publish("draft")
        self.assertEqual(code, 0)
        self.assertEqual(
            [call.split()[1] for call in calls], ["view", "upload", "edit"]
        )

    def test_published_release_is_untouched(self):
        """A rerun cannot replace assets that users already downloaded."""
        code, calls = self.run_publish("published")
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 1)

    def test_upload_failure_does_not_publish(self):
        """A partial upload leaves a recoverable draft, never a public release."""
        code, calls = self.run_publish("upload_failure")
        self.assertNotEqual(code, 0)
        self.assertFalse(any(call.startswith("release edit") for call in calls))

    def test_create_failure_stops_upload(self):
        """Authentication or API errors do not trigger later release mutations."""
        code, calls = self.run_publish("create_failure")
        self.assertNotEqual(code, 0)
        self.assertFalse(any(call.startswith("release upload") for call in calls))

    def test_incomplete_platform_set_stops_before_api_calls(self):
        """A missing Linux installer prevents even creating a draft."""
        code, calls = self.run_publish("missing_linux")
        self.assertNotEqual(code, 0)
        self.assertEqual(calls, [])

    def test_corrupt_windows_archive_stops_before_api_calls(self):
        """Verify the x64 checksums as well as the macOS checksum."""
        code, calls = self.run_publish("corrupt_windows")
        self.assertNotEqual(code, 0)
        self.assertEqual(calls, [])

    def test_invalid_checksum_stops_before_api_calls(self):
        """Corrupted build artifacts must not reach GitHub release APIs."""
        code, calls = self.run_publish("checksum_failure")
        self.assertNotEqual(code, 0)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
