#!/usr/bin/env python3
"""Build/test the macOS arm64 release link without changing the module cache.

Use --with-smoke for a separate developer acceptance binary, never distribution.
The pinned bindings document this supported static-library registration path.
"""

import hashlib
import os
import platform
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REMOVED = ("autocomplete", "tpch", "tpcds")
LIBRARIES = (
    "duckdb_httplib",
    "duckdb_loadable_extensions",
    "core_functions_extension",
    "icu_extension",
    "json_extension",
    "parquet_extension",
    "duckdb_static",
)


def main():
    """Build, test or vet with the pinned static DuckDB libraries and selected build tags."""
    args = sys.argv[1:]
    with_smoke = "--with-smoke" in args
    if with_smoke:
        args.remove("--with-smoke")
    if not args or args[0] not in ("build", "test", "vet"):
        raise SystemExit(
            "Usage: python3 scripts/go-release.py [--with-smoke] build|test|vet [go arguments]"
        )
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise SystemExit("The release link currently supports macOS arm64 only.")
    env = {**os.environ, "GOTOOLCHAIN": "go1.27.3", "CGO_ENABLED": "1"}
    module = Path(
        subprocess.check_output(
            [
                "go",
                "list",
                "-m",
                "-f",
                "{{.Dir}}",
                "go.duckdb.org/libduckdb/darwin-arm64",
            ],
            cwd=ROOT,
            env=env,
            text=True,
        ).strip()
    )
    loader = (module / "static_extension_loader.c").read_text()
    # Fail closed if an upstream loader changes: do not silently change capabilities.
    for name in (
        *REMOVED,
        "httplib",
        "loadable_extensions",
        "core_functions",
        "icu",
        "json",
        "parquet",
    ):
        if loader.count("duckdb_extension_" + name + "_describe") != 2:
            raise SystemExit("Unexpected DuckDB static loader: " + name)
    loader = (
        "\n".join(
            line
            for line in loader.splitlines()
            if not any(
                "duckdb_extension_" + name + "_describe" in line for name in REMOVED
            )
        )
        + "\n"
    )
    output = ROOT / "build/release-link"
    output.mkdir(parents=True, exist_ok=True)
    source, obj, archive = (
        output / name for name in ("loader.c", "loader.o", "libbamboo_loader.a")
    )
    # Recompile after a module/header change, otherwise retain cgo's cache.
    fingerprint = hashlib.sha256(
        loader.encode()
        + (module / "duckdb_static_extension.h").read_bytes()
        + str(module).encode()
    ).hexdigest()
    stamp = output / "inputs.sha256"
    if (
        not archive.exists()
        or not source.exists()
        or source.read_text() != loader
        or not obj.exists()
        or not stamp.exists()
        or stamp.read_text() != fingerprint
    ):
        source.write_text(loader)
        subprocess.run(
            [
                "xcrun",
                "clang",
                "-Os",
                "-I",
                str(module),
                "-c",
                str(source),
                "-o",
                str(obj),
            ],
            check=True,
        )
        subprocess.run(["ar", "rcs", str(archive), str(obj)], check=True)
        stamp.write_text(fingerprint)
    libraries = [module / ("lib" + name + ".a") for name in LIBRARIES]
    for library in libraries:
        if not library.is_file():
            raise SystemExit("Missing pinned DuckDB library: " + str(library))
    env["CGO_LDFLAGS"] = shlex.join(
        [
            str(archive),
            *map(str, libraries),
            "-lc++",
            *shlex.split(env.get("CGO_LDFLAGS", "")),
        ]
    )
    tags = ["duckdb_use_static_lib"] + ([] if with_smoke else ["bamboo_release"])
    # Merge optional caller tags (e.g. synthetic R2 transport) with the release link.
    remaining = []
    i = 1
    while i < len(args):
        arg = args[i]
        if arg == "-tags":
            i += 1
            if i == len(args):
                raise SystemExit("-tags requires a value")
            tags.append(args[i])
        elif arg.startswith("-tags="):
            tags.append(arg[6:])
        else:
            remaining.append(arg)
        i += 1
    command = ["go", args[0], "-tags=" + ",".join(tags)]
    if args[0] != "vet":
        command.append("-ldflags=-s -w -extldflags=-Wl,-dead_strip")
    command.extend(remaining)
    raise SystemExit(subprocess.run(command, cwd=ROOT, env=env).returncode)


if __name__ == "__main__":
    main()
