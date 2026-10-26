# Multiple files and folder workspaces

Bamboo keeps an open-file list independent of its folder browsers. Open Folder adds another root without replacing existing roots or the current preview. Open Parquet and file selection add or activate files, deduplicated by canonical absolute path. Two files with the same basename remain separate. Workspace-owned files appear only in their directory tree. **Open files** contains only files outside every open root, under **Other files**, and the entire section hides when empty. Opened tree entries have a right-side **×**; closing the file removes this close control while leaving its directory entry available to reopen.

Every open filename has a right-side **×**. Closing an inactive file leaves the preview unchanged; closing the active file selects a neighbor. Closing the last file releases the engine, clears the preview and disables export. Closing a workspace removes its tree and all files owned by that workspace. They are not moved to Other files. Other workspaces and independent files stay open. If its active file closes, a remaining file becomes active, or the welcome screen appears when none remain. Ownership follows the most specific open root for overlapping folders. Pending query edits save before closure; a failed settings write leaves the workspace and its open files intact. None of these actions deletes source files.

Each open file retains its SQL draft separately from the successful query, plus its page, page size, sort, filter and Explore/Schema view during the session. Switching reopens the selected file and reruns its bounded preview through one engine. It does not load all files or cache complete datasets.

## Persistence

All open roots, workspace display names and per-file draft/successful SQL are saved privately in the app config. Restart restores one last file per still-open root, with the last-used root active. Older single-workspace settings migrate automatically. Closing a file clears its recent-file entry if it was that root's last file. Missing roots are reported without preventing other roots from opening.

The full list of open documents, outside-file queries, pagination, filters/sorts and expanded directory branches are session-only. This release does not restore every open file after quitting. No cross-file query or simultaneous app-instance configuration coordination is provided.

## Verified on macOS arm64

The full `npm run coverage` workflow passed against the final sources, rebuilding and signing `build/Bamboo.app`:

| Measurement | Result |
|---|---:|
| All Go, ordinary tests only | 81.43% (557/684) |
| All Go, tests + instrumented desktop | **95.91% (656/684)** |
| Core logic, ordinary tests | 97.46% (537/551) |
| All production Go including startup, tests + desktop | 96.05% (559/582) |
| Frontend statements | 100% (482/482) |
| Frontend branches | 97.22% (175/180) |
| Frontend functions / lines | 100% / 100% |

- 18 frontend behavioral scenarios passed. They cover independent drafts/results, pagination/view switching, duplicate opens, no duplicate sidebar entries, tree close controls after refresh, hiding the empty outside list, path boundaries, nested/root workspaces, cascading workspace closure with unrelated files retained and failed writes preserved, inactive/active/last-file closure and recovery when a neighboring file disappears.
- Real Go tests include multi-root authorization, selective closing, saved-file clearing, failed writes, old-config migration, missing-root restoration, and engine release/reuse. Existing DuckDB million-row, precise-value, query-boundary, cancellation and export tests also passed.
- Instrumented native runs passed 75 assertions: 19 standard, 15 folder creation, 9 process restart, 24 multi-file and 8 multi-root restart/closing checks.
- The delivered signed app separately passed the 19 standard and 32 new multi-file/restart assertions. Those runs add no coverage counters.
- New native checks use two real throwaway roots containing identically named real Parquet files plus a third real outside file. SQL and file operations use production IPC and DuckDB. The outside file enters through a synthetic already-delivered MyGo drop event; this is **not** actual Finder gesture validation.
- TypeScript, go vet, npm audit, pinned govulncheck and app signature verification passed. Dependency scans reported no known vulnerabilities. Native DuckDB/MyGo libraries are not exhaustively covered by these advisory scanners. No separate security-audit skill was available.
- Actual light, dark and 700px narrow screenshots were inspected. Both sidebar sections remain labeled, and workspace trees scroll independently. Native checks assert no document-width overflow and reachable result pagination.

## Evidence

- [Readable coverage report](artifacts/coverage/report.html), raw profiles and source hashes in the same directory.
- [Delivered-app multi-file assertions](artifacts/coverage/app-desktop/multi/desktop-smoke.json) and [restart/close assertions](artifacts/coverage/app-desktop/multi-restore/desktop-smoke.json).
- [Light screenshot](artifacts/coverage/app-desktop/multi/bamboo-light.png), [dark screenshot](artifacts/coverage/app-desktop/multi/bamboo-desktop.png), [narrow screenshot](artifacts/coverage/app-desktop/multi/bamboo-narrow.png).
- [Offline visual report](artifacts/multiple-files/bamboo-multiple-files.html) and [delivery hashes](artifacts/multiple-files/delivery-manifest.json).

Quit the old Bamboo window and reopen `build/Bamboo.app`. Choose Open Folder for each root, then open several files and switch using their workspace tree entries or the external Open files list. Use each file's × to close it; the workspace's × closes that workspace and its opened files.

Still manual: native folder/file picker selection and cancellation, native save dialogs, actual Finder drop gestures and screen-reader acceptance. Multi-GB production files, Intel, Windows/Linux and memory-pressure behavior are unverified. All automated runs use private temporary settings and deterministic fixtures; the user's workspace settings and source data are untouched.
