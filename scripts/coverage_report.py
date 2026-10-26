#!/usr/bin/env python3
"""Union measured statement blocks without changing the full Go denominator."""
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts/coverage"


def profile(path):
    lines = path.read_text().splitlines()
    assert lines[0] in ("mode: set", "mode: count", "mode: atomic"), path
    result = {}
    for line in lines[1:]:
        location, statements, hits = line.split()
        assert location not in result, f"duplicate block: {location}"
        result[location] = (int(statements), int(hits) > 0)
    return result


def measure(blocks, predicate=lambda _: True):
    total = covered = 0
    for location, (statements, hit) in blocks.items():
        if predicate(location):
            total += statements
            covered += statements * hit
    assert total, "empty coverage scope"
    return {"covered": covered, "total": total, "pct": 100 * covered / total}


def fmt(result):
    if result is None: return "Not present in baseline"
    return f'{result["pct"]:.2f}% ({result["covered"]}/{result["total"]})'


def write_report():
    baseline = profile(OUT / "baseline/go.out")
    unit = profile(OUT / "go-unit.out")
    combined = dict(unit)
    desktop = (OUT / "go-desktop.out").exists() and "--unit" not in sys.argv
    if desktop:
        for location, (statements, hit) in profile(OUT / "go-desktop.out").items():
            # Refuse stale/incompatible data, including changed source block boundaries.
            assert location in unit and unit[location][0] == statements, location
            combined[location] = (statements, hit or unit[location][1])
        (OUT / "go-combined.out").write_text("mode: set\n" + "".join(
            f"{location} {n} {int(hit)}\n" for location, (n, hit) in sorted(combined.items())))
    packages = sorted({loc.split(":")[0].rsplit("/", 1)[0] for loc in unit})
    package_rows = []
    for package in packages:
        pred = lambda loc, p=package: loc.split(":")[0].rsplit("/", 1)[0] == p
        package_rows.append({"name": package, "before": measure(baseline, pred) if any(pred(loc) for loc in baseline) else None,
                             "unit": measure(unit, pred), "combined": measure(combined, pred)})
    core = lambda loc: loc.startswith(("bamboo/internal/engine/", "bamboo/internal/workspace/", "bamboo/folder.go:", "bamboo/workbench.go:"))
    production = lambda loc: loc.startswith(("bamboo/internal/engine/", "bamboo/internal/workspace/", "bamboo/folder.go:", "bamboo/workbench.go:", "bamboo/main.go:"))
    front = json.loads((OUT / "frontend/coverage-summary.json").read_text())
    source_paths = sorted({loc.split(":")[0].removeprefix("bamboo/") for loc in unit})
    source_paths += sorted(str(p.relative_to(ROOT)) for p in (ROOT / "frontend/src").glob("*.ts"))
    source_hashes = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in source_paths}
    manifest = json.loads((OUT / "source-manifest.json").read_text())["sourceSHA256"]
    for path, digest in manifest.items():
        assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == digest, f"stale coverage: {path}; rerun npm run coverage"
    assert all(manifest[p] == digest for p, digest in source_hashes.items())
    result = {
        "generatedUTC": datetime.now(timezone.utc).isoformat(),
        "sourceRevision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "sourceSHA256": source_hashes,
        "desktopIncluded": desktop,
        "go": {"baseline": measure(baseline), "unit": measure(unit),
               "combined": measure(combined) if desktop else None,
               "core": measure(unit, core), "production": measure(combined, production), "packages": package_rows},
        "frontend": {"total": front["total"], **{Path(p).name: v for p, v in front.items() if p != "total"}},
    }
    (OUT / "summary.json").write_text(json.dumps(result, indent=2) + "\n")
    uncovered = defaultdict(list)
    for loc, (n, hit) in combined.items():
        if not hit:
            path, span = loc.split(":")
            start = int(span.split(".")[0]); end = int(span.split(",")[1].split(".")[0])
            source = (ROOT / path.removeprefix("bamboo/")).read_text().splitlines()
            uncovered[path].append({"span": span, "statements": n, "source": "\n".join(source[start-1:end])})
    (OUT / "uncovered.json").write_text(json.dumps(uncovered, indent=2) + "\n")
    go = result["go"]
    rows = ["| Scope | Before | Go tests only | Tests + desktop |", "|---|---:|---:|---:|",
            f'| All repository Go | {fmt(go["baseline"])} | {fmt(go["unit"])} | {fmt(go["combined"]) if desktop else "Not measured"} |']
    for p in package_rows:
        rows.append(f'| {p["name"]} | {fmt(p["before"])} | {fmt(p["unit"])} | {fmt(p["combined"]) if desktop else "Not measured"} |')
    frows = ["| Frontend scope | Statements | Branches | Functions | Lines |", "|---|---:|---:|---:|---:|"]
    for name, data in result["frontend"].items():
        values = [f'{data[m]["pct"]}% ({data[m]["covered"]}/{data[m]["total"]})' for m in ["statements", "branches", "functions", "lines"]]
        frows.append("| " + " | ".join([name] + values) + " |")
    explanation = """The historical baseline is the preserved, unmodified profile from commit e1235f6 using `BAMBOO_LARGE_TEST=1 GOTOOLCHAIN=go1.27.3 go test -ldflags='-s -w' -count=1 -coverprofile=... ./...`. The same test-only measurement remains separate from desktop coverage. No frontend baseline existed; it is **unmeasured**, not 0%.

All Go files remain in the full repository denominator, including the fixture generator, fixture CLI, startup, and desktop smoke runner. The Workbench service was moved unchanged in behavior from main.go to workbench.go; a native-dialog interface and a file-creation adapter add two statements (359 → 361). The redesign and later folder-workspace feature add production and validation code; all new files remain counted. No coverage ignores or production-file exclusions were added. Core includes the engine, workspace persistence/navigation and Workbench services; production additionally includes main.go startup. The fixture generator creates deterministic test data; smoke.go is opt-in developer automation. These are separately described, never silently removed from the raw total.

The combined Go profile is the union of actually hit statement blocks from ordinary tests and instrumented native-app processes: the successful 19-check single-file DOM/IPC suite plus two actual workspace processes for creation and restart restoration, an intentionally missing smoke script, an intentionally throwing smoke script, and an intentionally unready frontend. Failure runs assert the specific structured error; they test the harness, not product dialog behavior. Blocks must exist with identical locations and statement counts in the unit profile before merging. Native covmeta/covcounters and both original profiles are retained. The final signed uninstrumented app also passes the 19-check suite, but its run adds no coverage counters.

Frontend tests execute the shipped main.ts and generated mygo.ts through a mocked mygo-runtime transport in jsdom. All TypeScript production files are explicitly included. Generated bindings are included and separately listed; dependencies, tests, CSS and build configuration are not application TypeScript. V8 supplies statement/branch/function/line measurements; Vitest's raw inspector payloads are preserved byte-for-byte as gzip files in v8-raw/ before its normal cleanup, and source-mapped counters are in frontend/coverage-final.json. The evidence reporter verifies that application scripts are present and does not alter counters or coverage calculation. The branch report is retained as emitted, including a conservative negative counter from V8 remapping at the open-result guard; it is not manually corrected.
"""
    checks = """- Real DuckDB tests: million-row fixture, exact integers/decimal/time/nested/null values, empty files, malformed and wide schemas, quoted paths and symlinks, SQL lexical/injection boundaries, inclusive resource limits, cancellation/deadlines, and recovery.
- Workbench: picker cancel/failure, concurrent operation rejection, failed-open/query state retention, export snapshot across a later query, exact JSON/permissions, extension checks, existing-file/symlink refusal, and cleanup after write/close failure.
- Frontend: single-file and folder-workspace behavioral scenarios covering state transitions, paging/filter/sort, schema, selectable cell text, literal hostile text, keyboard shortcuts/drop events, failed/null bridge returns, busy/cancel recovery, and export results.
- Production desktop: 19 single-file assertions plus workspace creation and process restart assertions; light, dark and narrow screenshots; narrow overflow/footer checks. Native-dialog doubles are not native-dialog acceptance.
- TypeScript, go vet, npm audit, pinned govulncheck, native build and bundle signature checks. No applicable security-audit skill was available; negative boundary tests and scanners are used. Go/npm advisories do not exhaustively scan statically linked DuckDB or native MyGo/platform libraries.
"""
    limits = """Remaining uncovered Go statements are recorded below and in uncovered.json: database-driver setup/scan/iteration and metadata error paths, process-fatal startup paths, native navigation/window-open callbacks, and smoke readiness/screenshot failures. Each remains in the denominator. Some are difficult to induce deterministically without replacing the real driver or platform.

Still requires manual native acceptance: open picker selection/cancel, save dialog selection/cancel and existing-filename handling, and actual Finder file drop. Also unverified: Windows/Linux, Intel builds, screen readers, multi-GB files and memory-pressure behavior. This coverage work does not certify those behaviors.
"""
    commands = """npm ci
npm run coverage                 # full Go + frontend + native desktop + scans; needs macOS GUI
npm run coverage:unit            # Go/core + frontend + scans, no desktop or full-Go 95% claim
npm run coverage:web             # all frontend TS; four 95% thresholds
GOTOOLCHAIN=go1.27.3 go tool cover -func=artifacts/coverage/go-combined.out
python3 scripts/coverage_report.py --check  # rebuild report from measured profiles, enforce thresholds"""
    md = f"""# Bamboo coverage report

Generated: {result['generatedUTC']}. Source revision: `{result['sourceRevision']}`; exact production-file SHA-256 values are in summary.json.

## Results

{chr(10).join(rows)}

Core production logic (engine + Workbench/export), tests only: **{fmt(go['core'])}**.
All Go production code including startup: **{fmt(go['production'])}** ({'with desktop' if desktop else 'tests only'}).

{chr(10).join(frows)}

## Measurement rules

{explanation}
## Behavior verified

{checks}
## Remaining gaps

{limits}
## Reproduce

```sh
{commands}
```

Full Go combined coverage, core Go, and frontend statements/branches/functions/lines each have a 95% gate. Unit-only runs check the core/frontend gates and explicitly omit the full-Go claim. The historical profile is kept verbatim under baseline/. Single-file phone-friendly report: report.html. Raw profiles: go-unit.out, go-desktop.out, go-combined.out; native counters: desktop/raw/. All source files remain counted. Build product: build/Bamboo.app (ad-hoc signed, local macOS arm64 build).
"""
    (OUT / "SUMMARY.md").write_text(md)
    esc = html.escape
    scope_label = "含真实桌面" if desktop else "仅普通测试"
    comparison_note = (f'全仓 {go["combined"]["pct"]:.2f}% 包含额外的真实桌面测量，不能称为纯单元测试覆盖率。' if desktop else '本次没有桌面测量，因此没有 Go 全仓达到 95% 的结论。')
    metric_cards = [(f"Go 全仓 · {scope_label}", go["combined"] if desktop else go["unit"]),
                    ("Go 核心 · 普通测试", go["core"]),
                    ("前端语句", {"pct": front["total"]["statements"]["pct"], "covered": front["total"]["statements"]["covered"], "total": front["total"]["statements"]["total"]})]
    cards = "".join(f'<article class="metric"><p>{label}</p><strong>{m["pct"]:.2f}<small>%</small></strong><span>{m["covered"]} / {m["total"]} statements</span><div class="track"><i style="width:{m["pct"]}%"></i></div></article>' for label, m in metric_cards)
    package_html = "".join(f'<article class="package"><h3>{esc(p["name"])}</h3><div class="numbers"><span>基线<b>{esc(fmt(p["before"]))}</b></span><span>普通测试<b>{p["unit"]["pct"]:.2f}%</b></span><span>{scope_label}<b>{p["combined"]["pct"]:.2f}%</b></span></div></article>' for p in package_rows)
    front_html = "".join(f'<article class="package"><h3>{esc(name)}</h3><div class="numbers four">' + "".join(f'<span>{label}<b>{data[key]["pct"]}%</b><small>{data[key]["covered"]}/{data[key]["total"]}</small></span>' for key, label in [("statements","语句"),("branches","分支"),("functions","函数"),("lines","行")]) + '</div></article>' for name, data in result["frontend"].items())
    gaps = "".join(f'<details><summary>{esc(path)} · {sum(x["statements"] for x in spans)} uncovered statements</summary>' + "".join(f'<p>Lines {esc(x["span"])} · {x["statements"]} statement(s)</p><pre>{esc(x["source"])}</pre>' for x in spans) + '</details>' for path, spans in uncovered.items())
    html_text = f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bamboo · 测试覆盖率</title>
<style>
:root{{color-scheme:light dark;--bg:#f5f7f3;--surface:#fff;--text:#20372d;--muted:#64776c;--line:#dbe3dc;--accent:#2e7153}}@media(prefers-color-scheme:dark){{:root{{--bg:#13201a;--surface:#1c2b23;--text:#e3eee5;--muted:#a2b8a9;--line:#354a3d;--accent:#91c8a5}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 system-ui,-apple-system,sans-serif}}main{{max-width:1000px;margin:auto;padding:44px 24px 64px}}header{{padding-bottom:28px;border-bottom:1px solid var(--line)}}.eyebrow{{font-size:12px;letter-spacing:.2em;color:var(--muted);font-weight:700}}h1{{font-size:clamp(30px,7vw,52px);line-height:1.15;letter-spacing:-.04em;margin:14px 0}}h2{{font-size:23px;margin:34px 0 16px}}h3{{font-size:15px;margin:0 0 12px;overflow-wrap:anywhere}}p{{margin:10px 0}}.muted,small{{color:var(--muted)}}.metrics{{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:26px 0}}.metric,.package{{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:20px}}.metric p{{font-size:13px;color:var(--muted);margin:0}}.metric strong{{display:block;font-size:48px;letter-spacing:-.05em;font-weight:600;line-height:1.6}}.metric strong small{{font-size:23px}}.metric>span{{font-size:12px;color:var(--muted)}}.track{{height:5px;border-radius:5px;background:var(--line);margin-top:17px;overflow:hidden}}.track i{{display:block;height:100%;background:var(--accent)}}.packages{{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}}.numbers{{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}}.numbers.four{{grid-template-columns:repeat(4,1fr)}}.numbers span{{font-size:12px;color:var(--muted)}}.numbers b{{display:block;font-size:20px;color:var(--text);font-weight:600}}.numbers small{{display:block;font-size:11px}}.note{{border-left:3px solid var(--accent);padding:4px 0 4px 18px;margin:22px 0}}details{{border-top:1px solid var(--line);padding:14px 0}}summary{{cursor:pointer;font-weight:600;overflow-wrap:anywhere}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface);padding:16px;border:1px solid var(--line);border-radius:12px;font:12px/1.65 ui-monospace,monospace}}li{{margin:9px 0}}code{{overflow-wrap:anywhere}}footer{{margin-top:36px;color:var(--muted);font-size:12px;overflow-wrap:anywhere}}@media(max-width:600px){{main{{padding:26px 16px 40px}}.metrics,.packages{{grid-template-columns:1fr}}.metric{{padding:18px}}.metric strong{{font-size:46px}}.numbers.four{{grid-template-columns:repeat(2,1fr);row-gap:16px}}}}
</style><main><header><div class="eyebrow">BAMBOO / QUALITY REPORT / 2026-10-26</div><h1>测试覆盖率，有据可查。</h1><p class="muted">真实 DuckDB、现有前端，以及实际 macOS 桌面运行。保留基线、原始计数与未覆盖区域。</p></header>
<section class="metrics">{cards}</section><div class="note"><b>同口径普通 Go 测试：{go['baseline']['pct']:.2f}% → {go['unit']['pct']:.2f}%</b><p>{comparison_note}前端此前未测量，不记为 0%。Go 与 TypeScript 不合并成一个百分比。</p></div>
<h2>Go · 每个包都保留</h2><div class="packages">{package_html}</div><p class="muted">核心逻辑（引擎 + Workbench/导出）：{fmt(go['core'])}。含启动的全部 Go 生产代码：{fmt(go['production'])}。夹具与 smoke 工具仍在全仓分母内。</p>
<h2>前端 · 四项指标</h2><div class="packages">{front_html}</div><p class="muted">jsdom 中执行现有页面，通过模拟传输层调用真实生成绑定。V8 原始数据与源码映射计数均已保存。</p>
<h2>验证了什么</h2><ul><li>SQL 注释、引号、括号与注入边界；文件路径、schema、分页和资源上限。</li><li>失败保留旧会话；竞争、取消、超时后恢复；整数、decimal、时间、嵌套值与 null 精度。</li><li>导出取消、格式错误、快照、拒绝覆盖、写入/关闭失败清理。</li><li>8 个前端行为场景；真实桌面 16 项 DOM/IPC 检查；浅色、深色和窄窗口截图。</li><li>TypeScript、go vet、依赖漏洞扫描、桌面构建与签名验证。</li></ul>
<h2>仍需人工原生验收</h2><p>原生打开/保存对话框、取消操作与实际 Finder 拖放。模拟对话框不代表这些已通过。Windows/Linux、Intel、多 GB 文件、内存压力和屏幕阅读器仍未验证。</p>
<h2>计数规则与证据</h2><details><summary>查看完整口径、验证与限制（English）</summary><pre>{esc(explanation + chr(10) + checks + chr(10) + limits)}</pre></details>
<details><summary>原始汇总与源码 SHA-256</summary><pre>{esc(json.dumps(result,ensure_ascii=False,indent=2))}</pre></details>
<h2>未覆盖区域 · 不隐藏分母</h2>{gaps}
<h2>复现与阈值</h2><p>完整 Go、Go 核心及前端四项指标均设 95% 门槛。完整流程需要 macOS 图形会话；unit 模式不会冒称 Go 全仓达标。</p><pre>{esc(commands)}</pre>
<footer>Generated {esc(result['generatedUTC'])}<br>Source {esc(result['sourceRevision'])}<br>单文件 · 无外部字体、脚本、图片或网络请求 · 浅色 / 深色自适应</footer></main></html>'''
    (OUT / "report.html").write_text(html_text)
    print("Go baseline:", fmt(go["baseline"]))
    print("Go tests only:", fmt(go["unit"]))
    print("Go combined:", fmt(go["combined"]) if desktop else "not measured")
    print("Go core:", fmt(go["core"]))
    print("Go production:", fmt(go["production"]))
    if "--check" in sys.argv or "--unit" in sys.argv:
        assert go["core"]["pct"] >= 95, "core Go below 95%"
        if "--check" in sys.argv:
            assert desktop and go["combined"]["pct"] >= 95, "full Go including desktop below 95%"
            assert go["production"]["pct"] >= 95, "production Go including startup below 95%"
        for scope, values in result["frontend"].items():
            for metric in ["statements", "branches", "functions", "lines"]:
                assert values[metric]["pct"] >= 95, f"{scope}/{metric} below 95%"


if __name__ == "__main__":
    write_report()
