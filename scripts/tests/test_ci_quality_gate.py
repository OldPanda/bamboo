"""Exercise the actual workflow aggregation scripts against all gate outcomes."""

import itertools
import os
import subprocess
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
