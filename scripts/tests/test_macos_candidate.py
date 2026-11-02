"""Test package transfer identity, tampering and clean fallback without native tools."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location(
    "candidate", SCRIPTS / "macos_candidate.py"
)
CANDIDATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CANDIDATE)


class CandidateTests(unittest.TestCase):
    """Never rely on a downloaded checksum/manifest as its own trust anchor."""

    def setUp(self):
        """Create isolated source and package fixtures."""
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.download = self.root / "build/candidate"
        self.download.mkdir(parents=True)
        self.env = {
            **os.environ,
            "GITHUB_REPOSITORY": "example/bamboo",
            "GITHUB_SHA": "a" * 40,
            "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "1",
            "BAMBOO_VERSION": "v1.2.3",
        }
        self.archive = self.download / "Bamboo-1.2.3-macOS-arm64.dmg"
        self.archive.write_bytes(b"synthetic verified disk image")
        self.sha = CANDIDATE.record(self.download, self.env)
        self.checksum = self.archive.with_suffix(".dmg.sha256")
        self.checksum.write_text(f"{self.sha}  {self.archive.name}\n")

    def test_reuse_and_failed_only_rerun(self):
        """A successful producer remains usable when only downstream jobs rerun."""
        self.assertTrue(CANDIDATE.reusable(self.download, self.sha, self.env))
        # An unchanged successful producer can feed a retried downstream consumer.
        self.env["GITHUB_RUN_ATTEMPT"] = "2"
        self.assertTrue(CANDIDATE.reusable(self.download, self.sha, self.env))

    def test_identity_mismatches(self):
        """Repository, commit, run and version changes require a new package."""
        for key, value in (
            ("GITHUB_SHA", "b" * 40),
            ("GITHUB_RUN_ID", "124"),
            ("GITHUB_REPOSITORY", "fork/bamboo"),
            ("BAMBOO_VERSION", "1.2.4"),
            ("GITHUB_RUN_ATTEMPT", "0"),
        ):
            with self.subTest(key=key):
                self.assertFalse(
                    CANDIDATE.reusable(
                        self.download, self.sha, {**self.env, key: value}
                    )
                )

    def test_rewritten_archive_and_checksum_cannot_override_trusted_digest(self):
        """Changing all downloaded claims cannot forge the producer job output."""
        self.archive.write_bytes(b"tampered")
        digest = CANDIDATE.record(self.download, self.env)
        self.checksum.write_text(f"{digest}  {self.archive.name}\n")
        self.assertFalse(CANDIDATE.reusable(self.download, self.sha, self.env))

    def test_absent_corrupt_extra_and_link_files(self):
        """Malformed downloads and symlinks select a clean rebuild."""
        self.assertFalse(CANDIDATE.reusable(self.root / "absent", self.sha, self.env))
        self.assertFalse(CANDIDATE.reusable(self.download, "", self.env))
        manifest = self.download / "candidate.json"
        original = manifest.read_text()
        manifest.write_text("{")
        self.assertFalse(CANDIDATE.reusable(self.download, self.sha, self.env))
        manifest.write_text(original)
        extra = self.download / "unexpected"
        extra.write_text("x")
        self.assertFalse(CANDIDATE.reusable(self.download, self.sha, self.env))
        extra.unlink()
        self.checksum.unlink()
        self.checksum.symlink_to(manifest)
        self.assertFalse(CANDIDATE.reusable(self.download, self.sha, self.env))

    def test_future_attempt_and_wrong_platform(self):
        """Reject manifests from a future attempt or incompatible native platform."""
        manifest = self.download / "candidate.json"
        original = json.loads(manifest.read_text())
        for key, value in (
            ("attempt", 2),
            ("attempt", True),
            ("platform", "linux-x64"),
        ):
            manifest.write_text(json.dumps({**original, key: value}))
            self.assertFalse(CANDIDATE.reusable(self.download, self.sha, self.env))

    def test_cli_restores_only_verified_files_and_cleans_fallback(self):
        """The real restore command copies verified bytes and removes stale releases."""
        output = self.root / "output"
        releases = self.root / "build/releases"
        for digest, expected in ((self.sha, "true"), ("", "false")):
            result = subprocess.run(
                [sys.executable, str(SCRIPTS / "macos_candidate.py"), "restore"],
                cwd=self.root,
                env={
                    **self.env,
                    "GITHUB_OUTPUT": str(output),
                    "CANDIDATE_SHA256": digest,
                },
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(output.read_text().endswith(f"reused={expected}\n"))
            self.assertEqual(
                len(list(releases.iterdir())), 2 if expected == "true" else 0
            )


if __name__ == "__main__":
    unittest.main()
