"""Exercise the actual workflow aggregation scripts against all gate outcomes."""

import itertools
import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github/workflows"


class QualityGateTests(unittest.TestCase):
    """Failure, cancellation, unknown scope and missing required results fail closed."""

    def test_only_selected_success_passes(self):
        """Reject every unsuccessful required result, including skipped native jobs."""
        results = ("success", "failure", "cancelled", "skipped", "", "unknown")
        for filename, native_key in (
            ("ci.yml", "MACOS_RESULT"),
            ("desktop-x64.yml", "NATIVE_RESULT"),
        ):
            script = textwrap.dedent(
                (WORKFLOWS / filename).read_text().rsplit("        run: |\n", 1)[1]
            )
            for scope, native, classifier, website in itertools.product(
                ("full", "website", ""),
                results,
                ("success", "failure"),
                ("success", "skipped"),
            ):
                with self.subTest(
                    file=filename,
                    scope=scope,
                    native=native,
                    classifier=classifier,
                    website=website,
                ):
                    result = subprocess.run(
                        ["bash", "-e", "-c", script],
                        env={
                            **os.environ,
                            "SCOPE": scope,
                            "SCOPE_RESULT": classifier,
                            native_key: native,
                            "WEBSITE_RESULT": website,
                        },
                        capture_output=True,
                        check=False,
                    )
                    expected = (
                        classifier == "success"
                        and (
                            (scope == "full" and native == "success")
                            or (scope == "website" and native == "skipped")
                        )
                        and (filename != "ci.yml" or website == "success")
                    )
                    self.assertEqual(result.returncode == 0, expected)

    def test_negative_acceptance_requires_transfer_and_rejection(self):
        """A green negative test proves both actual transfer and mismatch rejection."""
        workflow = (WORKFLOWS / "release.yml").read_text()
        step = workflow.split(
            "      - name: Verify real reuse before the deliberate mismatch\n", 1
        )[1].split("      - name:", 1)[0]
        self.assertIn("if: inputs.rebuild\n", step)
        script = textwrap.dedent(step.split("        run: |\n", 1)[1])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log = root / "calls"
            python = root / "python3"
            python.write_text('#!/bin/bash\necho "$*" >> "$CALLS"\n')
            python.chmod(0o700)
            for result in ("success", "failure", "skipped", "cancelled", ""):
                log.unlink(missing_ok=True)
                process = subprocess.run(
                    ["bash", "-e", "-c", script],
                    env={
                        **os.environ,
                        "PATH": str(root) + os.pathsep + os.environ["PATH"],
                        "CALLS": str(log),
                        "DOWNLOAD_RESULT": result,
                    },
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(process.returncode == 0, result == "success")
                self.assertEqual(log.exists(), result == "success")
                if result == "success":
                    self.assertEqual(
                        log.read_text().splitlines(),
                        [
                            "scripts/macos_candidate.py restore",
                            "scripts/verify-macos-package.py",
                        ],
                    )
        step = workflow.split(
            "      - name: Require deliberate mismatch rejection\n", 1
        )[1].split("      - name:", 1)[0]
        self.assertIn("if: inputs.rebuild\n", step)
        script = step.split("        run: ", 1)[1].strip()
        for result in ("true", "false", "", "unknown"):
            process = subprocess.run(
                ["bash", "-e", "-c", script],
                env={**os.environ, "REUSED": result},
                capture_output=True,
                check=False,
            )
            self.assertEqual(process.returncode == 0, result == "false")

    def test_publish_explicitly_requires_all_platforms_and_tag_event(self):
        """Keep the write-capable job behind explicit quality, platform and tag gates."""
        workflow = (WORKFLOWS / "release.yml").read_text()
        publish = workflow.split("  publish:\n", 1)[1]
        self.assertIn("needs: [quality, build, desktop]", publish)
        for gate in ("quality", "build", "desktop"):
            self.assertIn(f"needs.{gate}.result == 'success'", publish)
        self.assertIn("github.event_name == 'push'", publish)
        self.assertIn("startsWith(github.ref, 'refs/tags/v')", publish)
        desktop = workflow.split("  desktop:\n", 1)[1].split("  build:\n", 1)[0]
        self.assertNotIn("needs: quality", desktop)
        download = workflow.split("      - name: Download verified candidate", 1)[
            1
        ].split("      - name: Build app", 1)[0]
        self.assertNotIn("!inputs.rebuild", download)
        self.assertIn("inputs.rebuild && '" + "0" * 64 + "'", download)


if __name__ == "__main__":
    unittest.main()
