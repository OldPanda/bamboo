#!/usr/bin/env python3
"""Opt-in, headless production-size Parquet benchmarks; no credentials or uploads.

Each sample uses a new process and release-linked engine. Fixture generation is
separate. Kernel filesystem caches are NOT purged: fresh process != cold disk.
"""

import argparse
import datetime
import hashlib
import json
import platform
import shutil
import statistics
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIB = 1024**2
CASES = {
    "128m": (128 * MIB, 1),
    "512m": (512 * MIB, 1),
    "1g": (1024 * MIB, 1),
    "2g": (2048 * MIB, 1),
    "small-files": (MIB, 1000),
}


def write_json(path, value):
    """Write an indented machine-readable benchmark result."""
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def render(out, results, status):
    """Write the performance report from measured runs and completion status."""
    rows = []
    for case in dict.fromkeys(r["case"] for r in results):
        for mode in ("local", "remote"):
            samples = [r for r in results if r["case"] == case and r["mode"] == mode]
            good = [r for r in samples if not r.get("error")]
            if not good:
                rows.append(f"| {case} | {mode} | — | — | — | — | FAIL |")
                continue
            first = statistics.median(r["open_and_first_page_ms"] for r in good)
            size = good[0]["fixture"]["bytes"] / good[0]["fixture"]["files"] / MIB
            peak = max(r["process_peak_rss_bytes"] for r in good) / MIB
            transferred = "N/A"
            if mode == "remote":
                transferred = f"{statistics.median(sum(p['network']['object_bytes'] for p in r['phases'] if p['name'] in ('open_metadata', 'first_page')) for r in good) / MIB:.2f}"
            rows.append(
                f"| {case} | {mode} | {size:.2f} | {first:.1f} | {transferred} | {peak:.1f} | {len(good)}/{len(samples)} |"
            )
    text = """# Bamboo Parquet performance results

Status: **%s**

| Case | Transport | Actual MiB/file | Median open + first 100 rows (ms) | Median first-page object MiB | Max process RSS MiB | Passed samples |
|---|---|---:|---:|---:|---:|---|
%s

## Scope and interpretation

- Real ZSTD Parquet at actual compressed target sizes (+/-10%%), deterministic hash-derived binary payload, numeric/category/timestamp fields. Not sparse/padded files or repeated-string compression tricks. Small-file case has 1,000 independently written ~1 MiB files (quick mode: 20).
- Each sample starts a fresh process using the same engine and static library selection as the release. Generation/build memory and time are excluded. OS filesystem caches are not flushed; these are **not cold-storage measurements**.
- Open + first page means engine metadata loading plus returning 100 rows, **not native IPC or UI paint time**. Separate phases cover cached repeat, next page, projection, last-row filter, aggregate and small-file listing/32-file count. Each result is checked against known data.
- Remote is the real signed R2 client -> scoped gateway -> DuckDB httpfs path against a **local synthetic S3 protocol service**, with the configured delay per upstream request; no bandwidth cap or real WAN/TLS model. This is **not live R2/S3 latency**. Synthetic keys only, no uploads or user credentials/settings.
- Remote bytes count actual ranged object response bodies, excluding headers/list XML/TLS. Local physical disk bytes are **not measured** (N/A), since cached logical reads and physical I/O differ.
- RSS is macOS getrusage process high-water memory, including DuckDB native allocations and the local fixture server's streaming buffers. Per-phase RSS is cumulative, not a phase-specific peak; table peak covers all phases in that sample. It is not the full desktop application's RAM usage.
- Time samples are observations, not machine-independent pass/fail thresholds. Functional checks and fixture size bounds fail the command; a first page fetching over half a large object (>=128 MiB) also fails. Repeat/next-page reads of these fixtures must transfer zero additional object bytes. Source/binary hashes are rechecked at completion. Engine query timeout defaults to 300 seconds; timeouts/errors are retained as failed samples. No p95 is inferred from three runs.
- Large fixtures are generated one case at a time in owned temporary directories and removed afterward; they never enter the app bundle or git. Raw JSON/JSONL, commands, stderr and source/binary hashes are retained alongside this report.
""" % (status, "\n".join(rows))
    text += "\n## Phase medians\n\n| Case | Transport | Phase | Median ms | Median object MiB | Median requests |\n|---|---|---|---:|---:|---:|\n"
    groups = {}
    for r in results:
        for p in r.get("phases", []):
            if not p.get("error"):
                groups.setdefault((r["case"], r["mode"], p["name"]), []).append(p)
    for (case, mode, phase), samples in groups.items():
        ms = statistics.median(p["ms"] for p in samples)
        bytes_text = requests = "N/A"
        if mode == "remote":
            bytes_text = f"{statistics.median(p['network']['object_bytes'] for p in samples) / MIB:.3f}"
            requests = str(statistics.median(p["network"]["requests"] for p in samples))
        text += (
            f"| {case} | {mode} | {phase} | {ms:.2f} | {bytes_text} | {requests} |\n"
        )
    (out / "REPORT.md").write_text(text)


def main():
    """Generate temporary fixtures, run bounded benchmarks and collect measured results."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--quick", action="store_true", help="8 MiB + 20 small files; smoke only"
    )
    parser.add_argument(
        "--cases", default=",".join(CASES), help="comma-separated full-size cases"
    )
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--delay-ms", type=int, default=20)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--fixture-parent",
        type=Path,
        default=ROOT / "build",
        help="volume for temporary fixtures",
    )
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="explicitly reuse existing perf binary",
    )
    args = parser.parse_args()
    if args.runs < 1 or args.delay_ms < 0:
        parser.error("runs >= 1 and delay-ms >= 0 required")
    names = args.cases.split(",")
    if any(n not in CASES for n in names):
        parser.error("unknown case; choose " + ",".join(CASES))
    selected = (
        {"quick-8m": (8 * MIB, 1), "quick-small-files": (MIB, 20)}
        if args.quick
        else {n: CASES[n] for n in names}
    )
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = (args.output or ROOT / "artifacts/performance" / stamp).resolve()
    out.mkdir(parents=True, exist_ok=False)  # Never overwrite previous evidence.
    args.fixture_parent.mkdir(parents=True, exist_ok=True)
    binary = ROOT / "build/bamboo-perf"
    results, failures = [], []
    status = "RUNNING"
    write_json(
        out / "run.json",
        {
            "started_utc": stamp,
            "platform": platform.platform(),
            "machine": platform.machine(),
            "runs": args.runs,
            "delay_ms": args.delay_ms,
            "cases": selected,
            "fresh_process": True,
            "cold_os_cache": False,
            "live_cloud": False,
            "skip_build": args.skip_build,
        },
    )
    try:
        if platform.system() != "Darwin" or platform.machine() != "arm64":
            raise RuntimeError(
                "This runner measures macOS arm64 release builds; RSS units are macOS bytes."
            )
        if not args.skip_build:
            with (out / "build.log").open("w") as log:
                subprocess.run(
                    [
                        "python3",
                        "scripts/go-release.py",
                        "build",
                        "-tags",
                        "bamboo_perf",
                        "-o",
                        str(binary),
                        "./cmd/perf",
                    ],
                    cwd=ROOT,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    check=True,
                )
        extension = ROOT / "build/extensions/httpfs.duckdb_extension"
        if not extension.is_file():
            raise RuntimeError(
                "Missing packaged httpfs extension; run scripts/prepare-httpfs.py first."
            )
        sources = [
            ROOT / "go.mod",
            ROOT / "go.sum",
            ROOT / "scripts/go-release.py",
            Path(__file__),
            *sorted((ROOT / "cmd/perf").glob("*.go")),
            *sorted((ROOT / "internal/engine").glob("*.go")),
            *sorted((ROOT / "internal/cloudstorage").glob("*.go")),
            *sorted((ROOT / "internal/cloudstoragetest").glob("*.go")),
            *sorted((ROOT / "internal/workspace").glob("*.go")),
            binary,
            extension,
        ]
        hashes = {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sources
        }
        write_json(out / "source-hashes.json", hashes)
        for case, (target, count) in selected.items():
            required = int(target * count * 1.15) + 512 * MIB
            free = shutil.disk_usage(args.fixture_parent).free
            if free < required:
                raise RuntimeError(
                    f"{case}: need {required / MIB:.0f} MiB free (including reserve), have {free / MIB:.0f}; use --fixture-parent on another volume."
                )
            print(f"{case}: generating {count} x ~{target / MIB:.0f} MiB", flush=True)
            with tempfile.TemporaryDirectory(
                prefix="bamboo-perf-", dir=args.fixture_parent.resolve()
            ) as temp:
                data = Path(temp) / "data"
                manifest = Path(temp) / "fixture.json"
                base = [str(binary), "-dir", str(data), "-manifest", str(manifest)]
                command = base + [
                    "-action",
                    "generate",
                    "-target",
                    str(target),
                    "-files",
                    str(count),
                ]
                with (out / "commands.jsonl").open("a") as f:
                    f.write(json.dumps(command) + "\n")
                with (out / (case + "-generate.log")).open("w") as log:
                    subprocess.run(
                        command,
                        cwd=ROOT,
                        stdout=log,
                        stderr=subprocess.STDOUT,
                        check=True,
                        timeout=1800,
                    )
                meta = json.loads(manifest.read_text())
                write_json(out / (case + "-fixture.json"), meta)
                for run in range(args.runs):
                    # Alternate ordering to avoid always giving one transport the first read.
                    modes = ("local", "remote") if run % 2 == 0 else ("remote", "local")
                    for mode in modes:
                        command = base + [
                            "-mode",
                            mode,
                            "-httpfs",
                            str(extension),
                            "-delay-ms",
                            str(args.delay_ms),
                        ]
                        with (out / "commands.jsonl").open("a") as f:
                            f.write(json.dumps(command) + "\n")
                        t = time.monotonic()
                        try:
                            p = subprocess.run(
                                command,
                                cwd=ROOT,
                                text=True,
                                capture_output=True,
                                timeout=240,
                            )
                            (out / f"{case}-{mode}-{run + 1}.stderr.log").write_text(
                                p.stderr
                            )
                            (out / f"{case}-{mode}-{run + 1}.stdout.json").write_text(
                                p.stdout
                            )
                            r = json.loads(p.stdout)
                            if p.returncode and not r.get("error"):
                                r["error"] = f"exit {p.returncode}"
                        except (subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
                            r = {"mode": mode, "fixture": meta, "error": str(exc)}
                        r.update(
                            case=case, run=run + 1, wall_seconds=time.monotonic() - t
                        )
                        results.append(r)
                        with (out / "samples.jsonl").open("a") as f:
                            f.write(json.dumps(r) + "\n")
                        if r.get("error"):
                            failures.append(f"{case}/{mode}/{run + 1}: {r['error']}")
                        print(
                            f"  {mode} {run + 1}/{args.runs}: "
                            + (
                                r.get("error")
                                or f"first page {r['open_and_first_page_ms']:.1f} ms; peak {r['process_peak_rss_bytes'] / MIB:.1f} MiB"
                            ),
                            flush=True,
                        )
                        render(out, results, "RUNNING")
        for name, expected in hashes.items():
            if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
                failures.append("Source/binary changed during run: " + name)
        status = "FAILED" if failures else "PASSED"
    except BaseException as exc:
        status = "FAILED"
        failures.append(str(exc))
        raise
    finally:
        write_json(
            out / "summary.json",
            {
                "status": status,
                "samples": len(results),
                "failures": failures,
                "results": results,
            },
        )
        render(out, results, status)
        print(f"{status}: {out / 'REPORT.md'}", flush=True)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
