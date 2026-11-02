"""Keep native-test failures diagnosable without running a desktop application."""

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "coverage.py"
SPEC = importlib.util.spec_from_file_location("coverage_runner", SCRIPT)
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class CoverageRunnerTests(unittest.TestCase):
    """Preserve output and propagate real child-process failures to the gate."""

    def test_timeout_keeps_partial_output_and_fails(self):
        """A killed test must leave its last output and still raise the timeout."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(RUNNER, "OUT", root):
                with self.assertRaises(subprocess.TimeoutExpired):
                    RUNNER.run(
                        [
                            sys.executable,
                            "-c",
                            "import time; print('test started', flush=True); time.sleep(60)",
                        ],
                        "timeout.log",
                        timeout=2,
                    )
            self.assertEqual((root / "timeout.log").read_text(), "test started\n")

    def test_nonzero_exit_keeps_output_and_fails(self):
        """Writing a diagnostic log must not turn an unsuccessful child green."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(RUNNER, "OUT", root):
                with self.assertRaises(subprocess.CalledProcessError) as failure:
                    RUNNER.run(
                        [sys.executable, "-c", "print('assertion failed'); exit(7)"],
                        "failure.log",
                    )
            self.assertEqual(failure.exception.returncode, 7)
            self.assertEqual((root / "failure.log").read_text(), "assertion failed\n")


if __name__ == "__main__":
    unittest.main()
