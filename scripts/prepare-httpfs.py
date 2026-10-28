#!/usr/bin/env python3
"""Fetch only the pinned, official DuckDB extension during an explicit build."""

import gzip
import hashlib
import io
import pathlib
import platform
import subprocess

if platform.system() != "Darwin" or platform.machine() != "arm64":
    raise SystemExit("This cloud-reader build currently supports macOS arm64 only.")
sha = "c2d72a98ad081bf4d62c908b8d9f60b70ab1b83faa9141fc7e7d53526658761d"
target = pathlib.Path("build/extensions/httpfs.duckdb_extension")
if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == sha:
    raise SystemExit(0)
url = "https://extensions.duckdb.org/v2.0.0/osx_arm64/httpfs.duckdb_extension.gz"
compressed = subprocess.run(
    [
        "/usr/bin/curl",
        "--fail",
        "--location",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--max-time",
        "60",
        "--max-filesize",
        str(16 * 1024 * 1024),
        url,
    ],
    check=True,
    stdout=subprocess.PIPE,
).stdout
if len(compressed) > 16 * 1024 * 1024:
    raise SystemExit("Extension download exceeds limit")
with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
    blob = stream.read(32 * 1024 * 1024 + 1)
if len(blob) > 32 * 1024 * 1024:
    raise SystemExit("Uncompressed extension exceeds limit")
if hashlib.sha256(blob).hexdigest() != sha:
    raise SystemExit("Extension checksum mismatch")
target.parent.mkdir(parents=True, exist_ok=True)
temp = target.with_suffix(".tmp")
temp.write_bytes(blob)
temp.replace(target)
print("Verified DuckDB 2.0.0 httpfs for macOS arm64")
