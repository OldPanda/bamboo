#!/usr/bin/env python3
"""Run real tests; desktop measurements require a logged-in macOS GUI session."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from threading import Thread

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts/coverage"
ENV = {**os.environ, "GOTOOLCHAIN": "go1.27.3", "BAMBOO_LARGE_TEST": "1", "BAMBOO_KEYCHAIN_TEST": "1"}


def sources():
    paths = list(ROOT.glob("*.go"))
    for folder, pattern in [("internal", "*.go"), ("cmd", "*.go"),
                            ("frontend", "*.ts"), ("scripts", "*.py"), ("scripts", "*.mjs"), ("scripts", "*.js"), ("scripts", "*.sh")]:
        paths += list((ROOT / folder).rglob(pattern))
    paths += list((ROOT / "frontend/src").rglob("*.css"))
    paths += list((ROOT / "frontend/src/assets").glob("*.png"))
    paths += [ROOT / "assets/bamboo.png"]
    paths += [ROOT / name for name in ["go.mod", "go.sum", "package.json", "package-lock.json", "vitest.config.ts"]]
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}


def run(args, log, *, cwd=ROOT, env=None, timeout=300):
    print("+", " ".join(map(str, args)), flush=True)
    result = subprocess.run(args, cwd=cwd, env=env or ENV, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    (OUT / log).write_text(result.stdout)
    print(result.stdout, end="", flush=True)
    result.check_returncode()


def smoke(binary, fixture, cwd, destination, expected=None, covered=True, frontend_url=None, launch_args=None, extra_env=None, expected_checks=19):
    destination.mkdir(parents=True, exist_ok=True)
    report_path = destination / "desktop-smoke.json"
    report_path.unlink(missing_ok=True)
    env = {**ENV, "BAMBOO_SMOKE": str(destination), "BAMBOO_CONFIG_DIR": str(destination / "config"), **(extra_env or {})}
    if frontend_url:
        env["MYGO_DEV_URL"] = frontend_url
    if covered:
        env["GOCOVERDIR"] = str(OUT / "desktop/raw")
    run([str(binary)] + (launch_args if launch_args is not None else ["--file", str(fixture)]), str(destination.relative_to(OUT) / "process.log"),
        cwd=cwd, env=env, timeout=45)
    result = json.loads(report_path.read_text())
    if expected:
        assert expected in result.get("error", ""), result
    else:
        assert "error" not in result and "captureError" not in result, result
        assert len(result["result"]["checks"]) == expected_checks, result
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
    run(["go", "test", "-p=1", "-coverpkg=./...", "-ldflags=-s -w", "-count=1", "-json",
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
        (fixture.parent / "nested").mkdir(exist_ok=True)
        shutil.copyfile(fixture, fixture.parent / "nested/orders-copy.parquet")
        with tempfile.TemporaryDirectory(prefix="bamboo-workspace-config-") as config:
            for phase, args, count in [("create", ["--workspace", str(fixture.parent)], 15), ("restore", [], 9)]:
                smoke(ROOT / "build/bamboo-covered", fixture, ROOT, desktop / ("workspace-" + phase),
                      launch_args=args, extra_env={"BAMBOO_CONFIG_DIR": config, "BAMBOO_WORKSPACE_SMOKE": phase}, expected_checks=count)
        # Two independent real folders and a real outside file; all are throwaway fixtures.
        with tempfile.TemporaryDirectory(prefix="bamboo-multiple-") as temp:
            base = Path(temp).resolve()
            roots = [base / "Sales", base / "Inventory"]
            profiles = {}
            for root in roots:
                root.mkdir()
                shutil.copyfile(fixture, root / "orders.parquet")
                profiles[str(root)] = {"root": str(root), "name": root.name, "active": "", "queries": {}}
            shutil.copyfile(fixture, base / "external.parquet")
            config = base / "settings"
            config.mkdir()
            seed = {"version": 1, "open": list(profiles), "last": str(roots[0]), "profiles": profiles}
            for binary, target, covered in [(ROOT / "build/bamboo-covered", desktop, True),
                                            (ROOT / "build/Bamboo.app/Contents/MacOS/Bamboo", OUT / "app-desktop", False)]:
                (config / "workspaces.json").write_text(json.dumps(seed))
                for phase, count in [("multi", 24), ("multi-restore", 8)]:
                    smoke(binary, fixture, ROOT, target / phase, covered=covered, launch_args=[],
                          extra_env={"BAMBOO_CONFIG_DIR": str(config), "BAMBOO_WORKSPACE_SMOKE": phase}, expected_checks=count)
        for binary, target, covered in [(ROOT / "build/bamboo-covered", desktop, True),
                                        (ROOT / "build/Bamboo.app/Contents/MacOS/Bamboo", OUT / "app-desktop", False)]:
            for phase in ["stable", "stable-narrow"]:
                smoke(binary, fixture, ROOT, target / phase, covered=covered,
                      launch_args=["--workspace", str(fixture.parent)],
                      extra_env={"BAMBOO_WORKSPACE_SMOKE": phase}, expected_checks=12)
        for binary, target, covered in [(ROOT / "build/bamboo-covered", desktop, True),
                                        (ROOT / "build/Bamboo.app/Contents/MacOS/Bamboo", OUT / "app-desktop", False)]:
            with tempfile.TemporaryDirectory(prefix="bamboo-cross-config-") as config:
                for phase, args, count in [("cross", ["--workspace", str(fixture.parent)], 10), ("cross-restore", [], 3), ("root-query", [], 8), ("root-query-restore", [], 4)]:
                    smoke(binary, fixture, ROOT, target / phase, covered=covered, launch_args=args,
                          extra_env={"BAMBOO_WORKSPACE_SMOKE": phase, "BAMBOO_CONFIG_DIR": config}, expected_checks=count)
        for name, expected in [("missing-script", "no such file"), ("script-error", "expected smoke failure")]:
            with tempfile.TemporaryDirectory(prefix="bamboo-smoke-") as d:
                if name == "script-error":
                    scripts = Path(d) / "scripts"
                    scripts.mkdir()
                    (scripts / "smoke.js").write_text("throw new Error('expected smoke failure');")
                smoke(ROOT / "build/bamboo-covered", fixture, Path(d), desktop / name, expected)
        # A real native process must report an unready frontend instead of hanging.
        # This local, intentionally blank fixture contains no data or mocked IPC.
        class UnreadyFrontend(BaseHTTPRequestHandler):
            def do_GET(self):
                body = b"<!doctype html><title>Intentional startup failure fixture</title>"
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), UnreadyFrontend) as server:
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                smoke(ROOT / "build/bamboo-covered", fixture, ROOT, desktop / "frontend-not-ready",
                      expected="frontend did not become ready",
                      frontend_url=f"http://127.0.0.1:{server.server_port}/")
            finally:
                server.shutdown()
                thread.join()
        run(["go", "tool", "covdata", "textfmt", "-i=artifacts/coverage/desktop/raw",
             "-o=artifacts/coverage/go-desktop.out"], "covdata.log")
        # Also validate the delivered signed, uninstrumented app bundle.
        smoke(ROOT / "build/Bamboo.app/Contents/MacOS/Bamboo", fixture, ROOT, OUT / "app-desktop", covered=False)
        run(["codesign", "--verify", "--deep", "--strict", "build/Bamboo.app"], "signature.log")
    run(["go", "vet", "./..."], "go-vet.log")
    run(["npm", "exec", "tsc", "--", "--noEmit"], "tsc.log")
    if not unit:
        run([sys.executable, "scripts/validate-r2.py"], "r2-native.log")
        run([sys.executable, "scripts/validate-s3.py"], "s3-native.log")
    run(["npm", "audit", "--json"], "npm-audit.json")
    run(["go", "run", "golang.org/x/vuln/cmd/govulncheck@v1.9.0", "./..."], "govulncheck.log")
    assert sources() == source_hashes, "Sources changed while coverage was running; rerun the workflow."
    (OUT / "source-manifest.json").write_text(json.dumps({"sourceSHA256": source_hashes}, indent=2) + "\n")
    run([sys.executable, "scripts/coverage_report.py", "--unit" if unit else "--check"], "report.log")


if __name__ == "__main__":
    main()
