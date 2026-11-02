"""Transfer a verified DMG within one Actions run, or request a clean rebuild.

The trusted producer supplies both the immutable artifact ID and DMG digest as
job outputs. A downloaded manifest/checksum alone is never proof of identity.
No app bundle is unpacked during transfer, preserving symlinks and executable
permissions inside the already verified disk image.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
from pathlib import Path

from release_version import parse_version


def digest(path):
    """Hash a package with bounded memory."""
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def identity(env):
    """Bind packages to this repository, source commit, run and exact version."""
    return {
        "repository": env["GITHUB_REPOSITORY"],
        "commit": env["GITHUB_SHA"],
        "run": env["GITHUB_RUN_ID"],
        "version": parse_version(env["BAMBOO_VERSION"])[0],
        "platform": "darwin-arm64",
    }


def record(directory, env):
    """Record provenance only after the producer's native package check passed."""
    metadata = identity(env)
    archive = directory / f"Bamboo-{metadata['version']}-macOS-arm64.dmg"
    metadata.update(sha256=digest(archive), attempt=int(env["GITHUB_RUN_ATTEMPT"]))
    (directory / "candidate.json").write_text(json.dumps(metadata) + "\n")
    return metadata["sha256"]


def reusable(directory, expected_digest, env):
    """Reject absent, altered, foreign, old-version or malformed candidate files."""
    try:
        expected = identity(env)
        name = f"Bamboo-{expected['version']}-macOS-arm64.dmg"
        names = {name, name + ".sha256", "candidate.json"}
        if {p.name for p in directory.iterdir()} != names:
            return False
        if any(
            not (directory / n).is_file() or (directory / n).is_symlink() for n in names
        ):
            return False
        manifest = json.loads((directory / "candidate.json").read_text())
        attempt = manifest.get("attempt")
        if (
            type(attempt) is not int
            or not 1 <= attempt <= int(env["GITHUB_RUN_ATTEMPT"])
            or any(manifest.get(k) != v for k, v in expected.items())
            or not re.fullmatch(r"[0-9a-f]{64}", expected_digest)
            or manifest.get("sha256") != expected_digest
            or digest(directory / name) != expected_digest
            or (directory / (name + ".sha256")).read_text().strip()
            != f"{expected_digest}  {name}"
        ):
            return False
        return True
    except (ValueError, TypeError, KeyError, AttributeError, OSError):
        return False


def main():
    """Emit reuse decision; fallback always starts with an empty release directory."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("record", "restore"))
    parser.add_argument("--download", type=Path, default=Path("build/candidate"))
    args = parser.parse_args()
    releases = Path("build/releases")
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        if args.operation == "record":
            output.write(f"sha256={record(releases, os.environ)}\n")
            return
        reuse = reusable(
            args.download, os.environ.get("CANDIDATE_SHA256", ""), os.environ
        )
        if releases.exists():
            shutil.rmtree(releases)
        releases.mkdir(parents=True)
        if reuse:
            for path in args.download.glob("*.dmg*"):
                shutil.copyfile(path, releases / path.name)
        output.write(f"reused={str(reuse).lower()}\n")
        print(
            "Verified same-run candidate"
            if reuse
            else "Candidate unavailable or mismatched; full rebuild required"
        )


if __name__ == "__main__":
    main()
