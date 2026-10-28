#!/usr/bin/env python3
"""Enforce fresh, full-scope Go and frontend coverage without a local baseline."""

import argparse
import hashlib
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METRICS = ("statements", "branches", "functions", "lines")
THRESHOLD = 95
LOCATION = re.compile(r"bamboo/[^:]+\.go:\d+\.\d+,\d+\.\d+$")


def read_profile(path):
    """Parse Go blocks, union duplicate hits and reject malformed measurements."""
    lines = path.read_text().splitlines()
    if not lines or lines[0] not in ("mode: set", "mode: count", "mode: atomic"):
        raise ValueError(f"Invalid coverage profile: {path}")
    blocks = {}
    for line in lines[1:]:
        location, count, hits = line.split()
        count, hits = int(count), int(hits)
        if not LOCATION.fullmatch(location) or count < 0 or hits < 0:
            raise ValueError(f"Invalid coverage block: {line}")
        old_count, old_hit = blocks.get(location, (count, False))
        if old_count != count:
            raise ValueError(f"Incompatible duplicate block: {location}")
        blocks[location] = (count, old_hit or hits > 0)
    if not blocks or not sum(n for n, _ in blocks.values()):
        raise ValueError("Empty Go coverage scope")
    return blocks


def combine_profiles(unit, desktop):
    """Union actual desktop hits only against matching current test-profile blocks."""
    combined = dict(unit)
    for location, (count, hit) in desktop.items():
        if location not in unit or unit[location][0] != count:
            raise ValueError(f"Stale or incompatible desktop block: {location}")
        combined[location] = (count, hit or unit[location][1])
    return combined


def metric(covered, total):
    """Compare exact counts to the threshold before rounding for display."""
    if type(covered) is not int or type(total) is not int:
        raise ValueError("Coverage counts must be integers")
    if total <= 0 or covered < 0 or covered > total:
        raise ValueError("Invalid or empty coverage counts")
    return {
        "covered": covered,
        "total": total,
        "percent": covered * 100 / total,
        "passed": covered * 100 >= total * THRESHOLD,
    }


def go_metric(blocks):
    """Measure all Go blocks, including startup, fixture helpers and smoke code."""
    return metric(
        sum(n for n, hit in blocks.values() if hit),
        sum(n for n, _ in blocks.values()),
    )


def frontend_metrics(summary, root):
    """Verify every application TS file is present and recompute aggregate counts."""
    expected = {
        p.resolve()
        for p in (root / "frontend/src").rglob("*.ts")
        if not p.name.endswith(".d.ts")
    }
    measured = {
        (root / p).resolve(): values for p, values in summary.items() if p != "total"
    }
    if not expected or measured.keys() != expected:
        raise ValueError("Frontend coverage scope does not match application TS files")
    result = {}
    for key in METRICS:
        covered = total = 0
        for values in measured.values():
            c, n = values[key]["covered"], values[key]["total"]
            if type(c) is not int or type(n) is not int or not 0 <= c <= n:
                raise ValueError(f"Invalid frontend {key} counts")
            covered += c
            total += n
        reported = summary["total"][key]
        if (covered, total) != (reported["covered"], reported["total"]):
            raise ValueError(f"Frontend {key} total differs from file counts")
        result[key] = metric(covered, total)
    return result


def verify_sources(manifest, root, blocks):
    """Reject stale profiles and require recorded hashes for every measured source."""
    hashes = manifest["sourceSHA256"]
    if not hashes:
        raise ValueError("Empty source manifest")
    required = {loc.split(":")[0].removeprefix("bamboo/") for loc in blocks}
    required.update(
        str(p.relative_to(root)) for p in (root / "frontend/src").rglob("*.ts")
    )
    if not required <= hashes.keys():
        raise ValueError("Source manifest is missing measured files")
    for name, digest in hashes.items():
        path = (root / name).resolve()
        if not path.is_relative_to(root.resolve()):
            raise ValueError("Source manifest path escapes repository")
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError(f"Sources changed after coverage collection: {name}")


def main():
    """Write PR evidence and fail unless Go and all four frontend metrics reach 95%."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=ROOT / "artifacts/coverage")
    args = parser.parse_args()
    directory = args.directory
    try:
        unit = read_profile(directory / "go-unit.out")
        desktop = read_profile(directory / "go-desktop.out")
        combined = combine_profiles(unit, desktop)
        verify_sources(
            json.loads((directory / "source-manifest.json").read_text()), ROOT, combined
        )
        front = frontend_metrics(
            json.loads((directory / "frontend/coverage-summary.json").read_text()), ROOT
        )
        measurements = {"Go statements (tests + native desktop)": go_metric(combined)}
        measurements.update({f"Frontend {key}": value for key, value in front.items()})
        result = {
            "threshold": THRESHOLD,
            "goTestsOnly": go_metric(unit),
            "measurements": measurements,
            "passed": all(value["passed"] for value in measurements.values()),
        }
        (directory / "ci-summary.json").write_text(json.dumps(result, indent=2) + "\n")
        (directory / "go-combined.out").write_text(
            "mode: set\n"
            + "".join(
                f"{loc} {n} {int(hit)}\n" for loc, (n, hit) in sorted(combined.items())
            )
        )
        lines = [
            "# PR coverage gate",
            "",
            "Required: **at least 95%**, measured separately for Go and frontend.",
            "",
            "| Metric | Covered / total | Coverage | Result |",
            "| --- | ---: | ---: | --- |",
        ]
        for name, value in measurements.items():
            lines.append(
                f"| {name} | {value['covered']} / {value['total']} | "
                f"{value['percent']:.2f}% | {'PASS' if value['passed'] else 'FAIL'} |"
            )
        lines += [
            "",
            "Go includes every block in the current test profile, including startup,",
            "fixture helpers and native smoke code. Desktop hits are unioned only",
            "when block locations and statement counts agree. No historical baseline",
            "is required. Frontend includes generated IPC bindings and all application",
            "TypeScript. Go and frontend percentages are never averaged together.",
            "",
            "Native picker, Finder gestures and live cloud-account acceptance remain",
            "manual; mocked transport and DOM checks do not certify those interactions.",
        ]
        report = "\n".join(lines) + "\n"
        (directory / "CI-SUMMARY.md").write_text(report)
        if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(summary, "a") as stream:
                stream.write(report)
        print(report)
        return 0 if result["passed"] else 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Coverage gate failed: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
