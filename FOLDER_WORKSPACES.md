# Folder workspaces

> Historical single-workspace delivery record. The current multiple-root/file behavior and fresh validation are documented in [MULTIPLE_FILES.md](MULTIPLE_FILES.md). Coverage links below now point to the latest measurement; figures in this record describe the original folder-workspace release.

Bamboo now opens a directory as a real workspace. Open Folder selects the root, the sidebar lazily lists its directories and Parquet files, and clicking a file opens Explore Data. The pencil edits the workspace display name without renaming the source folder. Single-file mode remains available and uses a File breadcrumb.

Workspace names, recent active file and per-file draft/successful SQL are saved privately in the Bamboo config directory. The app restores the last workspace on restart. File switching flushes pending edits; failed saves stop the switch and show an error. A saved query that no longer runs falls back to the file preview while keeping the draft.

## Verified

- Complete `npm run coverage` passed, including real DuckDB fixtures, 12 frontend scenarios, TypeScript, go vet, dependency scanners, and signed native app validation.
- Go tests alone: 79.77% (493/618). Tests plus native processes: **95.47% (590/618)**. Core including folder services/store: **97.13% (473/487)**. All production including startup: **95.56% (495/518)**.
- Workspace store: **96.4%** statement coverage. Frontend statements/functions/lines: **100%**; branches: **98.34%**.
- Native validation: 19 single-file assertions, 15 workspace-create assertions, 9 separate-process restore assertions. Workspace scenarios also passed against the delivered signed app, separately from coverage instrumentation.
- Verified real directory expansion and nested file selection, workspace rename, bounded previews, switching between files with saved SQL, and restart restoration of name/file/query/results. Light, dark and narrow-window screenshots were inspected.
- Storage tests cover path traversal, symlink escapes, bounded pages, unreadable/missing paths, corrupt/oversized settings, limits and failed writes that preserve previous state.
- npm audit and govulncheck found no known vulnerabilities. No separate security-audit skill was available; negative boundary tests, static checks and scanners were used. Native DuckDB/MyGo libraries are not exhaustively covered by these advisory scans.

## Evidence and limits

Coverage report (`artifacts/coverage/report.html`, local only) and raw source-bound profiles are under artifacts/coverage. Delivered-app creation checks (`artifacts/folder-workspace/create/desktop-smoke.json`, local only) and restart checks (`artifacts/folder-workspace/restore/desktop-smoke.json`, local only) use isolated test config, not the user's settings. The delivery manifest records source/script and app binary hashes.

Only folders and Parquet files are listed; hidden entries and symbolic links are omitted. Listing reads 200 raw entries per page without an upfront recursive walk. This first version has one active data file, no multi-file SQL, no custom cross-directory collection, no filesystem watcher, and no simultaneous app-instance config coordination. Expanded directory branches are not restored; the active file and query are. Refresh reloads changes. Drafts debounce for 350 ms: wait for Saved locally before quitting. Limits and config location are documented in README.md.

Native file/folder picker interaction, save dialog and Finder drag-and-drop remain manual acceptance steps. The folder picker uses MyGo's documented Directory option and a dialog-double test; CLI/DOM/IPC tests do not claim to exercise macOS picker gestures. Multi-GB datasets, Windows/Linux and screen readers remain unverified.

## Try it

Quit the old Bamboo window, open build/Bamboo.app, choose Open Folder, then click a Parquet file in the left sidebar. Rename using the pencil, run a query, wait for Saved locally, and reopen Bamboo to resume.
