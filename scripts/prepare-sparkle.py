#!/usr/bin/env python3
"""Fetch and verify the pinned Sparkle distribution, preserving framework symlinks."""

import hashlib
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "2.10.1"
SHA256 = "1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27"


def main():
    """Verify cached archive bytes on every build and extract a fresh distribution."""
    target = ROOT / "build/sparkle"
    target.mkdir(parents=True, exist_ok=True)
    archive = target / f"Sparkle-{VERSION}.tar.xz"
    if (
        not archive.exists()
        or hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256
    ):
        with tempfile.NamedTemporaryFile(dir=target) as temporary:
            subprocess.run(
                [
                    "/usr/bin/curl",
                    "--fail",
                    "--location",
                    "--proto",
                    "=https",
                    "--proto-redir",
                    "=https",
                    "--max-time",
                    "90",
                    "--max-filesize",
                    str(32 * 1024 * 1024),
                    "--output",
                    temporary.name,
                    f"https://github.com/sparkle-project/Sparkle/releases/download/{VERSION}/{archive.name}",
                ],
                check=True,
            )
            blob = Path(temporary.name).read_bytes()
            if hashlib.sha256(blob).hexdigest() != SHA256:
                raise SystemExit("Sparkle archive checksum mismatch")
            archive.write_bytes(blob)
    # Never trust a previously extracted framework, including unexpected extra files.
    with tempfile.TemporaryDirectory(dir=target) as temporary:
        staging = Path(temporary)
        with tarfile.open(archive) as bundle:
            bundle.extractall(staging, filter="data")
        for name in ("Sparkle.framework", "bin", "LICENSE"):
            destination = target / name
            if destination.is_symlink() or destination.is_file():
                destination.unlink()
            elif destination.exists():
                shutil.rmtree(destination)
            shutil.move(str(staging / name), destination)
    print(f"Verified Sparkle {VERSION}")


if __name__ == "__main__":
    main()
