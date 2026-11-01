# Cloud connection settings

Open **Settings** at the bottom of the sidebar, or **Open data → Cloud storage → Manage connections**. The cloud connections list is separate from the workspace tree. Only implemented providers are offered; Cloudflare R2 and Amazon S3 are currently supported.

- **Add connection** tests and saves the selected provider configuration without opening a workspace.
- **Open** selects an existing workspace or opens the saved connection using Keychain credentials. Saved connections also appear under Open data → Cloud storage.
- **Edit** changes the display name or replaces credentials. All credential inputs are blank; leaving them all blank keeps the existing keys and any session token. Provider is fixed after creation. Endpoint/region/bucket/prefix are read-only while its workspace is open. Close that workspace before moving the connection to another location; changing location resets saved SQL.
- **Test** performs a read-only listing. Cancel operation or Escape cancels an in-flight Settings operation.
- **Delete** asks for confirmation, forgets metadata/SQL and Keychain credentials, and closes associated files. It never deletes cloud objects.

Closing a cloud workspace preserves its saved connection and SQL. Existing records without a closed flag are interpreted as open, maintaining prior restoration behavior. Adding the same location reuses its connection identity; edits cannot collide with another saved location.

Metadata writes are atomic. If writing settings fails, the store attempts to restore the prior credential entry; OS credential-store failures can also affect rollback. Invalid stored settings are reported rather than overwritten. Public connection metadata contains no credential fields; the form clears secrets when submitted or dismissed. Test failures retain prior valid configuration.

Validation uses real DuckDB/Parquet and a local S3 protocol fixture, synthetic credentials, actual native Settings controls, two-process restoration, failed saves, rotation, scope boundaries and race checks. Live Cloudflare/AWS bucket acceptance and native OS picker/Finder gestures remain manual. Native R2 fixtures run in a separate test-only build; production has no fixture transport hook.

## Previous Settings delivery

34 frontend scenarios and 29 native R2/Settings checks passed, including saved-but-closed connections across restart and re-adding an original location after editing a connection. Race checks, dependency scanning, type/static checks and production signature verification passed. Go combined coverage is 95.39%; frontend branch coverage is 95.78%. Actual screenshots and a self-contained mobile preview are in `artifacts/settings/`; exact binary hash and evidence are in its `delivery.json` and logs.

## AWS S3 addition

The same form now offers a provider selector. Amazon S3 asks for Region instead of a Cloudflare endpoint and supports optional Session Token credentials. Current provider-specific results and screenshots are in `artifacts/s3/`; current whole-repository coverage is in `artifacts/coverage/`.

## Temporary disk budgets

Performance settings provide an Auto switch and a slider with exact numeric input.
New settings use Auto: 25% of currently available space on the system temporary
volume after reserving 1 GiB, rounded down to whole GiB. Custom mode ranges from
0 (no spill) to the currently available space minus that reserve, replacing the
old 64 GiB ceiling. The display refreshes when Settings opens. Existing custom
budgets, including 0, remain custom when upgrading.

A new query reader measures free space again and caps its spill quota accordingly;
saved preferences are retained if free space later shrinks. Saving a custom value
above the current allowance is rejected. Automatic mode grants no spill space
when detection fails. The existing periodic free-space guard, cancellation and
private temporary-directory cleanup remain in effect. The reserve is best effort
when other processes write concurrently; this does not reserve disk space upfront.

## Text and zoom

Settings → General → Text and zoom saves app zoom (75–200%) and data text size
(12–20 px). Defaults are 100% and 13 px; the SQL editor remains one pixel larger
than table text. Apply saves first, then updates the calling native WebView; a
failed save retains the previous display. Reset display saves the defaults.

Zoom uses MyGo's platform page-zoom API on macOS arm64, Windows x64 and Linux x64.
It affects the whole interface without resizing the application window. The next
launch sets native zoom before the page opens and restores the data font. Settings
keeps a fixed outer size for a given viewport, scrolling inside; the editor and
table retain their independent scrolling at large sizes. Invalid display settings
fall back to normal size. Preferences are private in `display.json`.

“设置 → 通用 → 字号与缩放”提供 75–200% 应用缩放和 12–20 像素数据字号。默认
为 100% 与 13 像素，SQL 编辑器比表格大 1 像素。保存后应用原生 WebView 缩放，
失败时保留原显示；“重置显示设置”恢复并保存默认值。重启后自动恢复，设置内部、
查询编辑器和表格保持可滚动。

Native CI runs `scripts/display-smoke.js` in two processes with isolated settings,
verifying the actual native zoom factor, the effective viewport, maximum zoom,
reset, persisted fonts and subsequent queries on all three desktop platforms.
Headless browser checks separately cover bilingual themes, an effective 350×260
CSS-pixel viewport and real keyboard input with a deferred save response.
