"""Regression tests for the PR coverage gate's fail-closed behavior."""

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "check_coverage.py"
spec = importlib.util.spec_from_file_location("check_coverage", SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
BLOCK = "bamboo/main.go:1.1,2.1"


class CoverageGateTests(unittest.TestCase):
    """Reject missing, stale, incomplete and below-threshold coverage evidence."""

    def setUp(self):
        """Create an isolated repository-shaped fixture for each check."""
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        (self.root / "frontend/src").mkdir(parents=True)
        (self.root / "frontend/src/main.ts").write_text("export const value = 1;\n")
        (self.root / "main.go").write_text("package main\n")

    def summary(self, covered=95, total=100):
        """Build a report with independently summable per-file counts."""
        values = {key: {"covered": covered, "total": total} for key in gate.METRICS}
        return {"total": values.copy(), "frontend/src/main.ts": values.copy()}

    def test_threshold_uses_exact_counts(self):
        """Do not let rounding turn a value just below 95% into a pass."""
        self.assertTrue(gate.metric(95, 100)["passed"])
        self.assertFalse(gate.metric(94999, 100000)["passed"])
        for covered, total in [(0, 0), (-1, 100), (101, 100), (True, 1), (95.0, 100)]:
            with self.assertRaises(ValueError):
                gate.metric(covered, total)

    def test_duplicate_blocks_are_unioned_once(self):
        """Cross-package instrumentation must not inflate the denominator."""
        path = self.root / "coverage.out"
        path.write_text(f"mode: atomic\n{BLOCK} 5 0\n{BLOCK} 5 3\n")
        self.assertEqual(gate.read_profile(path), {BLOCK: (5, True)})
        path.write_text(f"mode: set\n{BLOCK} 5 0\n{BLOCK} 6 1\n")
        with self.assertRaises(ValueError):
            gate.read_profile(path)

    def test_empty_and_malformed_profiles_fail(self):
        """Missing measurements and invalid counters must fail rather than skip."""
        path = self.root / "coverage.out"
        for body in ["", "mode: set\n", f"mode: set\n{BLOCK} 5 -1\n", "invalid"]:
            path.write_text(body)
            with self.assertRaises(ValueError):
                gate.read_profile(path)

    def test_desktop_profile_must_match_unit_blocks(self):
        """Native counters supplement hits, never introduce mismatched source blocks."""
        unit = {BLOCK: (5, False), "bamboo/other.go:1.1,2.1": (5, False)}
        combined = gate.combine_profiles(unit, {BLOCK: (5, True)})
        self.assertEqual(gate.go_metric(combined)["percent"], 50)
        self.assertFalse(unit[BLOCK][1])
        for desktop in [{BLOCK: (6, True)}, {"bamboo/stale.go:1.1,2.1": (5, True)}]:
            with self.assertRaises(ValueError):
                gate.combine_profiles(unit, desktop)

    def test_frontend_requires_all_sources_and_honest_totals(self):
        """Fail for omitted application files or fabricated aggregate percentages."""
        summary = self.summary()
        self.assertTrue(gate.frontend_metrics(summary, self.root)["branches"]["passed"])
        summary["total"] = self.summary(100)["total"]
        with self.assertRaises(ValueError):
            gate.frontend_metrics(summary, self.root)
        (self.root / "frontend/src/new.ts").write_text("export const untouched = 1;\n")
        with self.assertRaises(ValueError):
            gate.frontend_metrics(self.summary(), self.root)

    def test_manifest_rejects_changed_or_missing_sources(self):
        """Profiles must describe the source bytes that are actually being checked."""
        names = ["main.go", "frontend/src/main.ts"]
        manifest = {
            "sourceSHA256": {
                name: hashlib.sha256((self.root / name).read_bytes()).hexdigest()
                for name in names
            }
        }
        gate.verify_sources(manifest, self.root, {BLOCK: (5, True)})
        (self.root / "main.go").write_text("package changed\n")
        with self.assertRaises(ValueError):
            gate.verify_sources(manifest, self.root, {BLOCK: (5, True)})
        with self.assertRaises(ValueError):
            gate.verify_sources({"sourceSHA256": {}}, self.root, {BLOCK: (5, True)})

    def test_cli_exit_status_and_summary(self):
        """Exercise the actual entry point on passing, failing and missing evidence."""
        out = self.root / "coverage"
        (out / "frontend").mkdir(parents=True)
        manifest = {
            "sourceSHA256": {
                name: hashlib.sha256((self.root / name).read_bytes()).hexdigest()
                for name in ["main.go", "frontend/src/main.ts"]
            }
        }
        (out / "source-manifest.json").write_text(json.dumps(manifest))
        (out / "frontend/coverage-summary.json").write_text(json.dumps(self.summary()))
        missing = "bamboo/main.go:3.1,4.1"
        (out / "go-unit.out").write_text(f"mode: set\n{BLOCK} 95 1\n{missing} 5 0\n")
        (out / "go-desktop.out").write_text(f"mode: atomic\n{BLOCK} 95 1\n")
        with (
            patch.object(gate, "ROOT", self.root),
            patch("sys.argv", [str(SCRIPT), "--directory", str(out)]),
            patch.dict("os.environ", {"GITHUB_STEP_SUMMARY": str(out / "job.md")}),
        ):
            self.assertEqual(gate.main(), 0)
            self.assertIn("PASS", (out / "job.md").read_text())
            (out / "go-unit.out").write_text(
                f"mode: set\n{BLOCK} 94 1\n{missing} 6 0\n"
            )
            (out / "go-desktop.out").write_text(f"mode: set\n{BLOCK} 94 1\n")
            self.assertEqual(gate.main(), 1)
            self.assertFalse(
                json.loads((out / "ci-summary.json").read_text())["passed"]
            )
            (out / "go-desktop.out").unlink()
            self.assertEqual(gate.main(), 1)


if __name__ == "__main__":
    unittest.main()
