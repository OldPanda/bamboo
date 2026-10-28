# Bamboo analyst workbench redesign

2026-10-26. Baseline: b92f28f. Hallmark 2.0.0, upstream 7ec868225c6caa040558c321ee0fefa0e73f83a8. The already-installed companion skill was used; no global skill or CLI installation changed.

## What changed

The file title, path and four true metadata values now share a compact context row. Export moves into the existing top bar. The result table runs edge to edge below the views and filter toolbar, with a stable footer. Sidebar fields use a readable two-line name/type treatment; numeric values and their headings/types align right. SQL editing and its results share one vertical workflow. Schema is a plain readable table.
Bamboo keeps its 竹 identity and green. Console contributes neutral stepped surfaces and hairlines; native system fonts keep the desktop offline. No cloud, multi-file tabs, saved-query controls, charts or invented metrics were added.
At the same real 1280×788 viewport, the table starts at y=221 instead of y=386. Complete visible rows increase from 7 to 15. These are geometry measurements, not performance claims.
Colors/fonts are centralized in tokens.css. The app retains system light/dark mode, keyboard focus, reduced motion, disabled/loading/cancel behavior, previous results after errors, full-value inspection and distinction between null/empty.

## Reviewable evidence

- Self-contained comparison (`artifacts/redesign/comparison.html`, local only), including Data, SQL, Schema and 700 px captures.
- Historical comparison screenshots are kept locally under `artifacts/` because they contain development paths.
- Final signed app captures (`artifacts/coverage/app-desktop/desktop-smoke.json`, local only); screenshots in the same folder.
- Before captures (`artifacts/redesign/before/desktop-smoke.json`, local only).
- Controls and IPC inventory (`artifacts/redesign/wiring.json`, local only).
- Coverage summary (`artifacts/coverage/SUMMARY.md`, local only) and offline coverage report (`artifacts/coverage/report.html`, local only).
- Hallmark review (`artifacts/redesign/review.md`, local only), actual run limitations (`artifacts/redesign/validation-run-notes.md`, local only), source/app hashes (`artifacts/redesign/artifact-manifest.json`, local only).

## Validation

Go all-repository tests plus actual desktop: 95.71% (357/373). Core: 97.69% (254/260). Frontend statements/functions/lines: 100%; branches: 98.64% (73/74). All 95% gates pass. New smoke capture calls remain in the Go denominator.
The signed embedded-frontend app and instrumented executable each pass all 16 existing DOM/IPC assertions. Extra native failure runs cover missing/throwing smoke scripts and a deliberately unready frontend. The unready-frontend test is included in the standard coverage runner. Earlier diagnostic attempts are retained separately from the final clean-run counters.
Go vet, TypeScript, npm audit and govulncheck pass; scanners report no known vulnerabilities in their inspected scopes. No native-library safety guarantee is implied.
After recovering writable space, the full npm run coverage command completed successfully from the original worktree, with command-local temporary/build/cache paths on RAM. The final reports and counters come from that clean run. Earlier interrupted attempts remain as diagnostic logs. Report text was corrected to describe the added native captures and readiness-failure check; no coverage counts were changed.
Native picker, native save dialog and actual Finder drop are still unaccepted; DOM/mocked tests do not substitute for them. Screen-reader behavior, other operating systems and notarization are not newly validated.

## Hallmark outcome

Before: 54 FAIL / 67 REFLEX / 9 WARN. Successful post-redesign browser render: 1 FAIL / 0 REFLEX / 1 WARN; preserved fields 4/4 and figures 102/102.
Gate 73 counts clipped off-screen table rows underneath the sibling footer; actual scroll bounds and independent screenshot review identify this as a detector limitation. The raw FAIL remains disclosed, not waived or called zero.
F25 at 375 px concerns horizontal table scrolling; the identifying column is pinned, the full schema is accessible, and the supported desktop minimum remains 700 px.
After independent review, native select heights and numeric type-label alignment were fixed and re-captured in the signed app. An intermediate Chrome retry could not run while the disk was full. After disk writes resumed, the final render completed and reported the same disclosed gate 73 FAIL and F25 WARN; raw output is in hallmark-after.log.
The successful contrast probe checks ten pairings per theme, all passing. Keyboard focus and reduced-motion behavior pass the probe. Typography/control sizes are designed for desktop; no general WCAG certification is claimed.

## Copy changes

| Before                                                                                                                   | After                                                | Reason                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------ |
| LOCAL DATA WORKBENCH / WORKSPACE / COLUMNS                                                                               | Local data workbench / Active file / Columns         | Untracked sentence-case labels, single-file truth                  |
| A LITTLE CLARITY FOR YOUR DATA; Big files. Room to explore.                                                              | Explore a Parquet file                               | Replace eyebrow and figurative welcome heading with actual task    |
| Browse comfortably / Follow your curiosity                                                                               | Browse rows / Query with SQL                         | Name the existing actions                                          |
| PARQUET FILE                                                                                                             | File name and exact metadata directly                | File extension already states the format; remove redundant eyebrow |
| ROWS / COLUMNS / FILE SIZE / ROW GROUPS                                                                                  | rows / columns / file size / row groups              | Preserve all metadata with quieter labels                          |
| QUERY EDITOR; CELL INSPECTOR                                                                                             | Query editor; Cell inspector                         | Sentence-case labels                                               |
| Arrow-prefixed export/run/tab glyphs; decorative status dot                                                              | Plain action labels                                  | Preserve actions, remove decoration                                |
| Middle-dot-joined metadata/status/inspector strings                                                                      | Slash-separated equivalents                          | Gate 63; all facts retained                                        |
| Placeholder Contains text…                                                                                               | Visible Contains label and Text to match placeholder | Field identification independent of placeholder                    |
| The empty-result test still asserts the entire string, updated only for its separator. All behavioral assertions remain. |

## Integration status

The final source, app, reports and comparison are prepared and validated. Integration uses a fast-forward only after verifying main remains clean at the expected baseline; app signature and source hashes are checked after copying to the main project.
