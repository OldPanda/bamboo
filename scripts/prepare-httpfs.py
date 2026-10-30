#!/usr/bin/env python3
"""Fetch only the pinned, official DuckDB extension during an explicit build."""

import gzip
import hashlib
import io
import pathlib
import platform
import subprocess

targets = {
    ("Darwin", "arm64"): (
        "osx_arm64",
        "c2d72a98ad081bf4d62c908b8d9f60b70ab1b83faa9141fc7e7d53526658761d",
    ),
    ("Linux", "x86_64"): (
        "linux_amd64",
        "77e6c429aa04f25da7962572f12b19113e0ce46080fa1365ad66017aadcdb68d",
    ),
    ("Windows", "amd64"): (
        "windows_amd64",
        "fc9bca12ff438f944c7d08ec424fce0d09e6b04379502ac9a7d8ee53df8a15c6",
    ),
}
try:
    extension_platform, sha = targets[(platform.system(), platform.machine().lower())]
except KeyError:
    raise SystemExit("Unsupported native extension platform") from None
target = pathlib.Path("build/extensions/httpfs.duckdb_extension")
if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == sha:
    raise SystemExit(0)
url = f"https://extensions.duckdb.org/v2.0.0/{extension_platform}/httpfs.duckdb_extension.gz"
compressed_limit = (
    24 * 1024 * 1024 if extension_platform == "windows_amd64" else 16 * 1024 * 1024
)
expanded_limit = (
    64 * 1024 * 1024 if extension_platform == "windows_amd64" else 32 * 1024 * 1024
)
compressed = subprocess.run(
    [
        "curl",
        "--fail",
        "--location",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--max-time",
        "60",
        "--max-filesize",
        str(compressed_limit),
        url,
    ],
    check=True,
    stdout=subprocess.PIPE,
).stdout
if len(compressed) > compressed_limit:
    raise SystemExit("Extension download exceeds limit")
with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
    blob = stream.read(expanded_limit + 1)
if len(blob) > expanded_limit:
    raise SystemExit("Uncompressed extension exceeds limit")
if hashlib.sha256(blob).hexdigest() != sha:
    raise SystemExit("Extension checksum mismatch")
target.parent.mkdir(parents=True, exist_ok=True)
temp = target.with_suffix(".tmp")
temp.write_bytes(blob)
temp.replace(target)
print(f"Verified DuckDB 2.0.0 httpfs for {extension_platform}")
