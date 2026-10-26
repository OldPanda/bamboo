#!/usr/bin/env python3
"""Run real tests; desktop measurements require a logged-in macOS GUI session."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts/coverage"
ENV = {**os.environ, "GOTOOLCHAIN": "go1.27.3", "BAMBOO_LARGE_TEST": "1"}


def sources():
    paths = list(ROOT.glob("*.go"))
    for folder, pattern in [("internal", "*.go"), ("cmd", "*.go"),
                            ("frontend", "*.ts"), ("scripts", "*.py"), ("scripts", "*.mjs")]:
        paths += list((ROOT / folder).rglob(pattern))
    paths += [ROOT / name for name in ["go.mod", "go.sum", "package.json", "package-lock.json", "vitest.config.ts"]]
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}


def run(args, log, *, cwd=ROOT, env=None, timeout=300):
    print("+", " ".join(map(str, args)), flush=True)
    result = subprocess.run(args, cwd=cwd, env=env or ENV, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    (OUT / log).write_text(result.stdout)
    print(result.stdout, end="", flush=True)
    result.check_returncode()


def smoke(binary, fixture, cwd, destination, expected=None, covered=True):
    destination.mkdir(parents=True, exist_ok=True)
    report_path = destination / "desktop-smoke.json"
    report_path.unlink(missing_ok=True)
    env = {**ENV, "BAMBOO_SMOKE": str(destination)}
    if covered:
        env["GOCOVERDIR"] = str(OUT / "desktop/raw")
    run([str(binary), "--file", str(fixture)], str(destination.relative_to(OUT) / "process.log"),
        cwd=cwd, env=env, timeout=45)
    result = json.loads(report_path.read_text())
    if expected:
        assert expected in result.get("error", ""), result
    else:
        assert "error" not in result and "captureError" not in result, result
        assert len(result["result"]["checks"]) == 16, result
        assert not result["narrowLayout"]["overflow"] and result["narrowFooterReachable"], result
        assert not any(k.endswith(".png") or k.startswith("bamboo-") for k in result), result


def main():
    unit = "--unit" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    source_hashes = sources()
    # Never reuse a stale desktop report or profile for a new unit-only run.
    for name in ["go-combined.out", "go-desktop.out"]:
        (OUT / name).unlink(missing_ok=True)
    if not (ROOT / "frontend/dist/index.html").exists():
        run(["npm", "run", "build:web"], "bootstrap-web.log")
    # Each DuckDB-linked test binary is large; serialize package builds to keep
    # temporary disk use bounded without changing the coverage scope.
    run(["go", "test", "-p=1", "-ldflags=-s -w", "-count=1", "-json",
         "-coverprofile=artifacts/coverage/go-unit.out", "./..."], "go-tests.jsonl")
    raw = OUT / "v8-raw"
    if raw.exists():
        shutil.rmtree(raw)
    raw.mkdir()
    run(["npm", "run", "coverage:web"], "frontend-tests.log")
    if not unit:
        if sys.platform != "darwin":
            raise RuntimeError("Full coverage requires the real macOS desktop; use --unit for portable tests.")
        run(["npm", "run", "build"], "build.log")
        run(["go", "build", "-cover", "-ldflags=-s -w", "-o", "build/bamboo-covered", "."], "build-covered.log")
        desktop = OUT / "desktop"
        if desktop.exists():
            shutil.rmtree(desktop)
        (desktop / "raw").mkdir(parents=True)
        # Fixtures are generated locally, never taken from a user's dataset.
        fixture_dir = ROOT / "build/coverage-fixtures"
        run(["go", "run", "./cmd/fixtures", str(fixture_dir)], "fixtures.log")
        fixture = fixture_dir / "orders.parquet"
        smoke(ROOT / "build/bamboo-covered", fixture, ROOT, desktop)
        for name, expected in [("missing-script", "no such file"), ("script-error", "expected smoke failure")]:
            with tempfile.TemporaryDirectory(prefix="bamboo-smoke-") as d:
                if name == "script-error":
                    scripts = Path(d) / "scripts"
                    scripts.mkdir()
                    (scripts / "smoke.js").write_text("throw new Error('expected smoke failure');")
                smoke(ROOT / "build/bamboo-covered", fixture, Path(d), desktop / name, expected)
        run(["go", "tool", "covdata", "textfmt", "-i=artifacts/coverage/desktop/raw",
             "-o=artifacts/coverage/go-desktop.out"], "covdata.log")
        # Also validate the delivered signed, uninstrumented app bundle.
        smoke(ROOT / "build/Bamboo.app/Contents/MacOS/Bamboo", fixture, ROOT, OUT / "app-desktop", covered=False)
        run(["codesign", "--verify", "--deep", "--strict", "build/Bamboo.app"], "signature.log")
    run(["go", "vet", "./..."], "go-vet.log")
    run(["npm", "exec", "tsc", "--", "--noEmit"], "tsc.log")
    run(["npm", "audit", "--json"], "npm-audit.json")
    run(["go", "run", "golang.org/x/vuln/cmd/govulncheck@v1.9.0", "./..."], "govulncheck.log")
    assert sources() == source_hashes, "Sources changed while coverage was running; rerun the workflow."
    (OUT / "source-manifest.json").write_text(json.dumps({"sourceSHA256": source_hashes}, indent=2) + "\n")
    run([sys.executable, "scripts/coverage_report.py", "--unit" if unit else "--check"], "report.log")


if __name__ == "__main__":
    main()
