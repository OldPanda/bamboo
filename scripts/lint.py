#!/usr/bin/env python3
"""Check maintained source files without launching the desktop application.

Use --format to apply deterministic formatters only. Tool installation is
explicit; see CONTRIBUTING.md. Generated code and local artifacts are excluded.
"""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "GOTOOLCHAIN": "go1.27.3"}


def main():
    """Run every language check, reporting all failed stages with a nonzero exit."""
    os.chdir(ROOT)
    write = "--format" in sys.argv[1:]
    go_files = sorted(
        [*ROOT.glob("*.go"), *ROOT.glob("internal/**/*.go"), *ROOT.glob("cmd/**/*.go")]
    )
    go_paths = [str(path.relative_to(ROOT)) for path in go_files]
    commands = [
        ["gofmt", "-w" if write else "-l", *go_paths],
        ["node_modules/.bin/prettier", "--write" if write else "--check", "."],
        ["node", "scripts/format-smoke.mjs", *(["--write"] if write else [])],
        [".venv/bin/ruff", "format", *([] if write else ["--check"]), "scripts"],
        [
            "xcrun",
            "swift-format",
            "format" if write else "lint",
            "-i" if write else "--strict",
            "scripts/package-icon.swift",
        ],
    ]
    if not write:
        commands += [
            [
                "build/tools/revive",
                "-set_exit_status",
                "-config",
                "revive.toml",
                "-formatter",
                "unix",
                ".",
                "./internal/...",
                "./cmd/...",
            ],
            ["node_modules/.bin/eslint", ".", "--max-warnings=0"],
            ["node_modules/.bin/tsc", "--noEmit"],
            [".venv/bin/ruff", "check", "scripts"],
            [".venv/bin/shellcheck", *map(str, sorted(Path("scripts").rglob("*.sh")))],
            ["bash", "-n", "scripts/build.sh"],
            [
                sys.executable,
                "scripts/go-release.py",
                "vet",
                ".",
                "./internal/...",
                "./cmd/...",
            ],
            [
                sys.executable,
                "scripts/go-release.py",
                "--with-smoke",
                "vet",
                "-tags=cloudsmoke,bamboo_perf",
                ".",
                "./internal/...",
                "./cmd/...",
            ],
        ]
    failed = []
    for command in commands:
        print(
            "+ " + " ".join(command[:5]) + (" …" if len(command) > 5 else ""),
            flush=True,
        )
        try:
            result = subprocess.run(
                command,
                env=ENV,
                capture_output=command[0] == "gofmt",
                text=True,
                check=False,
            )
        except FileNotFoundError:
            print(
                f"Missing {command[0]}; follow the setup in CONTRIBUTING.md.",
                file=sys.stderr,
            )
            failed.append(command[0])
            continue
        if result.returncode or (command[0] == "gofmt" and not write and result.stdout):
            failed.append(command[0])
        if command[0] == "gofmt" and result.stdout:
            print(result.stdout, end="")
        if command[0] == "gofmt" and result.stderr:
            print(result.stderr, end="", file=sys.stderr)
    if failed:
        raise SystemExit("Failed checks: " + ", ".join(failed))
    print("Formatting complete." if write else "All lint checks passed.")


if __name__ == "__main__":
    main()
