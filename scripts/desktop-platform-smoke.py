#!/usr/bin/env python3
"""Exercise real native WebView/IPC with synthetic Parquet on disposable CI runners."""

import hashlib
import json
import os
import platform
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    """Generate fixtures, run the native UI assertions, and verify source immutability."""
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise SystemExit(
            "Run native desktop acceptance in a disposable Actions session"
        )
    suffix = ".exe" if platform.system() == "Windows" else ""
    output = ROOT / "artifacts/platform-smoke"
    output.mkdir(parents=True, exist_ok=True)
    fixtures = output / "fixtures"
    subprocess.run(
        [str(ROOT / f"build/fixtures{suffix}"), str(fixtures)], cwd=ROOT, check=True
    )
    before = {
        str(p): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in fixtures.rglob("*.parquet")
    }
    env = {
        **os.environ,
        "BAMBOO_CONFIG_DIR": str(output / "config"),
        "BAMBOO_SMOKE": str(output),
        "LANG": "en_US.UTF-8",
    }
    with (output / "process.log").open("w") as log:
        subprocess.run(
            [
                str(ROOT / f"build/bamboo-smoke{suffix}"),
                "--file",
                str(fixtures / "orders.parquet"),
            ],
            cwd=ROOT,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            timeout=120,
            check=True,
        )
    report = json.loads((output / "desktop-smoke.json").read_text())
    if report.get("error") or not report.get("result"):
        raise SystemExit(f"Native UI acceptance failed: {report}")
    for name, digest in before.items():
        if hashlib.sha256(Path(name).read_bytes()).hexdigest() != digest:
            raise SystemExit("Source Parquet changed during UI acceptance")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
