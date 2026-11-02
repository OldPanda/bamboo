"""Conservatively select website checks from an exact local Git comparison."""

import json
import os
import re
import subprocess
from pathlib import Path


def git(*args):
    """Read Git metadata with bounded execution and propagate missing history."""
    return subprocess.check_output(["git", *args], timeout=30)


def classify(event_name, event, head):
    """Only regular website additions/modifications can avoid native checks.

    Unknown events, incomplete history, renames, deletions and mixed changes
    intentionally use the full suite. PR comparisons include the merge result.
    """
    try:
        if event_name == "pull_request":
            pr = event["pull_request"]
            base, source = pr["base"]["sha"], pr["head"]["sha"]
            parents = git("show", "-s", "--format=%P", head).decode().split()
            if parents != [base, source]:
                return "full"
        elif event_name == "push" and event.get("ref") == "refs/heads/main":
            base = event["before"]
            if head != event["after"]:
                return "full"
        else:
            return "full"
        if not all(re.fullmatch(r"[0-9a-f]{40}", sha) for sha in (base, head)):
            return "full"
        git("merge-base", "--is-ancestor", base, head)
        entries = git("diff", "--raw", "-z", "--no-abbrev", "-M", base, head).split(
            b"\0"
        )
        if entries[-1] != b"" or len(entries) < 3:
            return "full"
        entries.pop()
        if len(entries) % 2:
            return "full"
        for metadata, path in zip(entries[::2], entries[1::2], strict=True):
            old_mode, mode, _, _, status = metadata.split()
            if (
                status not in (b"A", b"M")
                or mode != b"100644"
                or old_mode not in (b":000000", b":100644")
                or not path.startswith(b"website/")
                or b".." in path.split(b"/")
            ):
                return "full"
        return "website"
    except (
        KeyError,
        ValueError,
        TypeError,
        AttributeError,
        OSError,
        subprocess.SubprocessError,
    ):
        return "full"


def main():
    """Emit a scope even when event/history inspection cannot be completed."""
    try:
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
        scope = classify(
            os.environ["GITHUB_EVENT_NAME"], event, os.environ["GITHUB_SHA"]
        )
    except (KeyError, ValueError, OSError):
        scope = "full"
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        output.write(f"scope={scope}\n")
    print(f"Required validation: {scope}")


if __name__ == "__main__":
    main()
