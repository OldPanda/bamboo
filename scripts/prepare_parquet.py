"""Build the narrowly patched Parquet component against the pinned DuckDB core.

Only explicit build/test/vet commands call this module. The app never downloads
source, patches user files or invokes a compiler. Module-cache libraries remain
untouched; every platform uses the same source patch and upstream CMake target.
"""

import hashlib
import json
import platform
import shlex
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "d54cbbe3df17e8e5ce68312f483b4155836112aa"
SOURCE_SHA256 = "93e3d1f9c84b6ec3493237d21565c01c2c19b9862e54e5552d3d7999ccc3bbb4"
PATCH = ROOT / "scripts/duckdb/decimal.patch"


def digest(path):
    """Hash build inputs and outputs without retaining an archive in memory."""
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def apply_patch(source, patch):
    """Apply our single-file unified hunk exactly, rejecting upstream drift."""
    lines = patch.splitlines(keepends=True)
    if (
        lines[:2]
        != [
            "--- a/extension/parquet/parquet_reader.cpp\n",
            "+++ b/extension/parquet/parquet_reader.cpp\n",
        ]
        or sum(line.startswith("@@ ") for line in lines) != 1
    ):
        raise ValueError("Unexpected Parquet patch format")
    body = lines[3:]
    if any(line[:1] not in (" ", "+", "-") for line in body):
        raise ValueError("Unexpected Parquet patch content")
    old = "".join(line[1:] for line in body if line[0] in " -")
    new = "".join(line[1:] for line in body if line[0] in " +")
    if not old or source.count(old) != 1:
        raise ValueError("Pinned DuckDB reader does not match the decimal patch")
    return source.replace(old, new, 1)


def unpack(archive, destination):
    """Extract verified regular files/directories within one bounded source tree."""
    with tarfile.open(archive, "r:gz") as tar:
        members = tar.getmembers()
        prefix = "duckdb-" + SOURCE
        if len(members) > 50000 or sum(m.size for m in members) > 2 * 1024**3:
            raise ValueError("DuckDB source archive exceeds build bounds")
        selected = []
        for member in members:
            parts = Path(member.name).parts
            if not parts or parts[0] != prefix or ".." in parts:
                raise ValueError("Unexpected DuckDB source archive entry")
            # Upstream's unrelated CSV test corpus includes deliberate symlinks.
            # It is not a build input; do not materialize any of that corpus.
            if len(parts) > 1 and parts[1] == "data":
                continue
            if not (member.isfile() or member.isdir()):
                raise ValueError("Unexpected DuckDB source archive entry type")
            selected.append(member)
        tar.extractall(destination, members=selected, filter="data")
    return destination / prefix


def source_archive():
    """Fetch and verify the exact upstream source, retaining only a verified cache."""
    directory = ROOT / "build/downloads"
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / ("duckdb-" + SOURCE + ".tar.gz")
    if archive.exists():
        if digest(archive) != SOURCE_SHA256:
            raise ValueError(
                "Cached DuckDB source SHA-256 mismatch; remove that cache and retry"
            )
        return archive
    with tempfile.TemporaryDirectory(dir=directory) as temporary:
        downloaded = Path(temporary) / "source.tar.gz"
        subprocess.run(
            [
                "curl",
                "--fail",
                "--location",
                "--proto",
                "=https",
                "--proto-redir",
                "=https",
                "--max-time",
                "120",
                "--max-filesize",
                "150000000",
                "https://codeload.github.com/duckdb/duckdb/tar.gz/" + SOURCE,
                "--output",
                str(downloaded),
            ],
            check=True,
        )
        if digest(downloaded) != SOURCE_SHA256:
            raise ValueError("Downloaded DuckDB source SHA-256 mismatch")
        downloaded.replace(archive)
    return archive


def parquet_library(module, target, env):
    """Return a verified cached native archive, rebuilding when its inputs change."""
    provenance = json.loads((module / "provenance.json").read_text())
    if (
        provenance.get("source") != SOURCE
        or provenance.get("duckdb_version") != "v2.0.0"
    ):
        raise ValueError("Parquet patch requires the pinned DuckDB 2.0.0 core")
    system = platform.system()
    cmake = shutil.which("cmake")
    if not cmake:
        local = ROOT / ".venv/bin/cmake"
        if local.is_file():
            cmake = str(local)
    if not cmake:
        raise RuntimeError("Install requirements-build.txt before building Bamboo")
    cc = env.get("CC", "clang" if system == "Darwin" else "gcc")
    cxx = env.get("CXX", "clang++" if system == "Darwin" else "g++")
    versions = subprocess.check_output([cmake, "--version"])
    for compiler in (cc, cxx):
        versions += subprocess.check_output([*shlex.split(compiler), "--version"])
    fingerprint = hashlib.sha256(
        versions
        + target.encode()
        + str(module).encode()
        + SOURCE_SHA256.encode()
        + Path(__file__).read_bytes()
        + PATCH.read_bytes()
        + json.dumps(
            {k: env.get(k, "") for k in ("CC", "CXX", "CFLAGS", "CXXFLAGS")},
            sort_keys=True,
        ).encode()
    ).hexdigest()
    output = ROOT / "build/parquet-compat" / target / fingerprint[:20]
    archive = output / "libparquet_extension.a"
    stamp = output / "archive.sha256"
    if archive.is_file() and stamp.is_file() and digest(archive) == stamp.read_text():
        return archive
    output.mkdir(parents=True, exist_ok=True)
    # A failed/partial build never acquires a successful stamp. Fresh extraction
    # also prevents a changed cached header from entering the next rebuild.
    with tempfile.TemporaryDirectory(prefix="bamboo-parquet-") as temporary:
        source = unpack(source_archive(), Path(temporary))
        reader = source / "extension/parquet/parquet_reader.cpp"
        reader.write_text(apply_patch(reader.read_text(), PATCH.read_text()))
        build = Path(temporary) / "build"
        flags = [
            f"-ffile-prefix-map={source.as_posix()}=duckdb",
            f"-ffile-prefix-map={build.as_posix()}=duckdb-build",
        ]
        options = []
        if system == "Darwin":
            sdk = subprocess.check_output(
                ["xcrun", "--show-sdk-path"], text=True
            ).strip()
            flags += ["-isystem", sdk + "/usr/include/c++/v1"]
            options += [
                "-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0",
                "-DCMAKE_OSX_ARCHITECTURES=arm64",
            ]
        compiler_flags = (
            subprocess.list2cmdline(flags) if system == "Windows" else shlex.join(flags)
        )
        commands = [
            [
                cmake,
                "-S",
                str(source),
                "-B",
                str(build),
                "-G",
                "MinGW Makefiles" if system == "Windows" else "Unix Makefiles",
                "-DCMAKE_BUILD_TYPE=Release",
                "-DBUILD_SHELL=OFF",
                "-DBUILD_UNITTESTS=OFF",
                "-DDISABLE_UNITY=ON",
                "-DENABLE_SANITIZER=OFF",
                "-DENABLE_UBSAN=OFF",
                "-DDUCKDB_EXPLICIT_VERSION=v2.0.0",
                "-DGIT_COMMIT_HASH=" + SOURCE,
                "-DPREBUILT_BINARY=" + str(module / "libduckdb_static.a"),
                "-DCMAKE_C_COMPILER=" + cc,
                "-DCMAKE_CXX_COMPILER=" + cxx,
                "-DCMAKE_C_FLAGS=" + compiler_flags,
                "-DCMAKE_CXX_FLAGS=" + compiler_flags,
                *options,
            ],
            [
                cmake,
                "--build",
                str(build),
                "--target",
                "parquet_extension",
                "--parallel",
                "2",
            ],
        ]
        print(
            "Building pinned DuckDB Parquet decimal compatibility component", flush=True
        )
        log = output / "build.log"
        with log.open("w") as stream:
            try:
                for command in commands:
                    subprocess.run(
                        command,
                        env=env,
                        stdout=stream,
                        stderr=subprocess.STDOUT,
                        check=True,
                    )
            except subprocess.CalledProcessError:
                stream.flush()
                print("\n".join(log.read_text(errors="replace").splitlines()[-60:]))
                raise
        shutil.copyfile(build / "extension/parquet/libparquet_extension.a", archive)
        stamp.write_text(digest(archive))
    return archive
