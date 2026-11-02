"""Exercise scope selection against real temporary Git histories."""

import importlib.util
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "ci_scope.py"
SPEC = importlib.util.spec_from_file_location("ci_scope", SCRIPT)
SCOPE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCOPE)


class ScopeTests(unittest.TestCase):
    """Only an exact, inspectable website change may avoid native checks."""

    def setUp(self):
        """Create isolated source and package fixtures."""
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, self.previous)
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "Fixture")
        self.git("config", "commit.gpgsign", "false")
        (self.root / "website").mkdir()
        (self.root / "website/downloads.json").write_text("one")
        (self.root / "main.go").write_text("one")
        self.base = self.commit()

    def git(self, *args):
        """Keep all test mutations confined to the synthetic repository."""
        return (
            subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL)
            .decode()
            .strip()
        )

    def commit(self):
        """Commit current fixture state without relying on the user's signing key."""
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD")

    def scope(self, head):
        """Use the exact before/after main-push event contract."""
        return SCOPE.classify(
            "push", {"ref": "refs/heads/main", "before": self.base, "after": head}, head
        )

    def test_website_modification_and_addition(self):
        """Permit ordinary website-only additions and content updates."""
        (self.root / "website/downloads.json").write_text("two")
        (self.root / "website/page.html").write_text("page")
        self.assertEqual(self.scope(self.commit()), "website")

    def test_mixed_changes_require_full(self):
        """A native source edit forces all platforms even alongside website edits."""
        (self.root / "website/downloads.json").write_text("two")
        (self.root / "main.go").write_text("two")
        self.assertEqual(self.scope(self.commit()), "full")

    def test_deletion_rename_and_symlink_require_full(self):
        """Ambiguous file identity and type changes use full validation."""
        for operation in ("delete", "rename", "symlink"):
            with self.subTest(operation=operation):
                self.git("reset", "--hard", self.base)
                file = self.root / "website/downloads.json"
                if operation == "rename":
                    file.rename(file.with_name("new.json"))
                else:
                    file.unlink()
                    if operation == "symlink":
                        file.symlink_to("../main.go")
                self.assertEqual(self.scope(self.commit()), "full")

    def test_missing_history_empty_diff_and_unknown_event(self):
        """Missing comparison evidence and non-PR/main events never skip native work."""
        self.assertEqual(self.scope(self.base), "full")
        with patch.object(
            SCOPE, "git", side_effect=subprocess.CalledProcessError(1, "git")
        ):
            self.assertEqual(self.scope(self.base), "full")
        for event in (
            "merge_group",
            "workflow_dispatch",
            "workflow_call",
            "pull_request_target",
        ):
            self.assertEqual(SCOPE.classify(event, {}, self.base), "full")
        self.assertEqual(
            SCOPE.classify("push", {"ref": "refs/tags/v1.2.3"}, self.base), "full"
        )

    def test_pr_requires_exact_merge_parents(self):
        """Bind the classified diff to the PR base, source and checked-out merge."""
        self.git("checkout", "-qb", "feature")
        (self.root / "website/downloads.json").write_text("two")
        source = self.commit()
        self.git("checkout", "--detach", self.base)
        self.git("merge", "--no-ff", "--no-gpg-sign", "-m", "merge", source)
        head = self.git("rev-parse", "HEAD")
        event = {"pull_request": {"base": {"sha": self.base}, "head": {"sha": source}}}
        self.assertEqual(SCOPE.classify("pull_request", event, head), "website")
        self.assertEqual(SCOPE.classify("pull_request", event, source), "full")
        event["pull_request"]["base"]["sha"] = source
        self.assertEqual(SCOPE.classify("pull_request", event, head), "full")


if __name__ == "__main__":
    unittest.main()
