# Stable file switching

Switching files now keeps the old coherent preview visible until the next query finishes, then commits metadata, editor, view and table in one synchronous update. Controls remain disabled for concurrency safety but no longer dim the whole workbench during every operation. The loading overlay waits 150 ms before becoming visible, and the filter column selector has a stable width. Saved-query fallback still preserves the draft; a failed fallback clears stale data and disables export rather than showing the old rows under the new file.

## Evidence

The supplied recording was inspected locally. The pre-fix native reproduction captured navigation opacity changing from 1 to 0.55 and a transient empty table when switching from ordinary data to the million-row fixture. Sampled anchor geometry did not move: the reproduced problem was flicker, not a measured change to the actual OS window bounds.

- [Original build identity](artifacts/file-switching/before-build.json), [baseline samples](artifacts/file-switching/before-desktop.json), and [baseline sampler](artifacts/file-switching/before-sampler.js).
- [Signed-app normal-width samples](artifacts/coverage/app-desktop/stable/desktop-smoke.json) and [700px samples](artifacts/coverage/app-desktop/stable-narrow/desktop-smoke.json).
- Four transitions per width: ordinary → million-row → special types → empty → ordinary. All use real local Parquet files, production IPC and DuckDB.
- Across the final samples, eight layout anchors had **0 CSS px maximum observed drift**, navigation opacity stayed **1**, and every observed title matched its table's rows and columns. Both signed-app runs passed 12 assertions each.
- Timed 16ms sampling and MutationObserver snapshots are used; this is not a claim to have captured every display frame. WKWebView can suspend requestAnimationFrame in automation. A separate delayed-result frontend test verifies that the previous title/table/view remain intact until completion, and a failed-preview test verifies stale rows cannot be exported.

Full `npm run coverage` passed: 19 frontend scenarios, 99 instrumented desktop assertions and 75 separately measured signed-app assertions, Go/DuckDB tests, TypeScript, go vet, dependency scans and bundle signature verification. Full Go statements: **95.94% (661/689)** with desktop measurements, **80.84% (557/689)** for ordinary tests alone. Frontend statements/functions/lines: **100%**; branches: **97.25%**. No production exclusions were added.

The delivered application is `build/Bamboo.app`; quit the old window and reopen it. Native picker/save/Finder gestures, multi-GB production datasets and non-arm64/non-macOS platforms remain outside this automated acceptance scope. No source dataset is modified, and the recording is not copied into the repository or uploaded.
