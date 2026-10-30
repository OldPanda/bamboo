"""Ensure the CI aggregation step fails closed for unsuccessful macOS checks."""

import os
import subprocess
import textwrap
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/ci.yml"


class QualityGateTests(unittest.TestCase):
    """Exercise the actual workflow shell step without launching desktop tests."""

    def test_only_success_passes(self):
        """Failure, cancellation, skipped jobs and missing results block the gate."""
        script = textwrap.dedent(WORKFLOW.read_text().split("        run: |\n")[1])
        for result in ("success", "failure", "cancelled", "skipped", "", "unknown"):
            with self.subTest(result=result):
                process = subprocess.run(
                    ["bash", "-e", "-c", script],
                    env={**os.environ, "MACOS_RESULT": result},
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(process.returncode == 0, result == "success")
                if result != "success":
                    self.assertIn(
                        "::error::macOS checks did not succeed", process.stdout
                    )


if __name__ == "__main__":
    unittest.main()
