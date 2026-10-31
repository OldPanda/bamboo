import {
  workspacePath,
  workspaceRelative,
  workspaceContains,
} from "./workspace-path";
import {
  Workbench,
  type File as DataFile,
  type Result,
  type Request,
  type Info,
  type Connection,
  type Resources,
  type MemoryLimits,
  type DiskLimits,
} from "./mygo";
import {
  localizeStatic,
  setLanguage,
  getLanguage,
  setText,
  setAttribute,
  t,
  pruneTranslations,
  rawText,
  type Language,
} from "./i18n";
import { onFileDrop } from "mygo-runtime";
import "./style.css";
import { attachSQLGhost } from "./sql-ghost";
import { attachResourceSlider } from "./resource-slider";
import type { SQLTable } from "./sql-completion";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const app = $("app");
const brandIcon = new URL("./assets/bamboo.png", import.meta.url).href;
function appearancePreview(mode: string) {
  const scene = (tone: string) =>
    `<svg class="appearance-scene preview-${tone}" viewBox="0 0 144 92" fill="none" aria-hidden="true"><rect class="preview-paper" width="144" height="92"/><path class="preview-sidebar" d="M0 0h32v92H0z"/><rect class="preview-accent" x="8" y="12" width="16" height="5" rx="2"/><path class="preview-lines" d="M8 29h15M8 39h11M8 49h15"/><rect class="preview-editor" x="42" y="12" width="92" height="24" rx="3"/><path class="preview-lines" d="M49 21h39M49 27h25"/><rect class="preview-accent" x="112" y="40" width="22" height="7" rx="2"/><path class="preview-grid" d="M42 54h92M42 64h92M42 74h92M42 84h92M71 54v30M104 54v30"/><path class="preview-lines" d="M47 59h14M77 59h18M110 59h17"/></svg>`;
  return `<span class="appearance-preview preview-${mode}">${mode === "dark" ? scene("dark") : scene("light")}${mode === "system" ? scene("dark") : ""}</span>`;
}
app.innerHTML = `
<aside class="sidebar">
  <div class="brand"><img class="brand-mark" src="${brandIcon}" width="36" height="36" alt="" /><div>Bamboo</div></div>
  <button id="open-data" hidden class="open-button primary" aria-haspopup="dialog" aria-controls="source-dialog" title="Open data"><svg class="button-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> Open data</button>
  <section id="open-files-panel" hidden><div class="section-label">Open files</div><div id="open-files"></div></section>
  <section id="folder-panel" hidden><div class="section-label">Workspaces</div><div id="workspace-roots"></div></section>
  <div id="file-card" hidden></div>
  <div id="columns-label" class="section-label columns-label" hidden>Columns <span id="column-count">—</span></div>
  <div id="column-list" class="column-list" hidden></div>
  <div class="sidebar-footer">
  <button id="update-reminder" class="update-reminder quiet" hidden title="Review and install update"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4m-4 4 4-4 4 4M5 15v5h14v-5"/></svg><span id="update-reminder-label"></span></button>
  <button id="settings" class="settings-button quiet" aria-haspopup="dialog" aria-controls="settings-dialog"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--side)"/><circle cx="15" cy="17" r="3" fill="var(--side)"/></svg><span>Settings</span></button>
  </div>
</aside>
<main>
  <header><div class="breadcrumb"><span id="scope-name">File</span> <span>/</span> <strong id="breadcrumb">Welcome</strong></div><div class="header-actions"><span class="local-badge" hidden></span><button id="export" title="Export the visible result page as JSON or CSV" aria-haspopup="dialog" aria-controls="export-dialog"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 15V3m-5 5 5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg><span>Export</span></button></div></header>
  <section id="welcome" class="welcome">
    <h1 id="welcome-title">Explore your data</h1>
    <div id="welcome-drop-zone" class="welcome-drop-zone" role="region" aria-labelledby="welcome-drop-title">
      <svg class="welcome-file-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M27 5H12a3 3 0 0 0-3 3v32a3 3 0 0 0 3 3h16M27 5v11h11L27 5Zm11 11v8M16 23h14M16 29h9M16 35h7M36 43V30m-6 6 6-6 6 6"/></svg>
      <h2 id="welcome-drop-title" aria-live="polite">Drop a Parquet file here</h2>
      <p id="welcome-description">Or open a file, folder, or cloud workspace.</p>
      <button id="welcome-data" class="primary" aria-haspopup="dialog" aria-controls="source-dialog">Open data</button>
    </div>
  </section>
  <section id="workspace" hidden>
    <div class="file-heading"><div class="file-identity"><h1 id="file-name"></h1><p id="file-path"></p></div><div class="metrics" aria-label="File metadata"><div><strong id="row-count">—</strong><span>rows</span></div><div><strong id="metric-columns">—</strong><span>columns</span></div><div><strong id="file-size">—</strong><span>file size</span></div><div><strong id="row-groups">—</strong><span>row groups</span></div></div></div>
    <nav class="tabs" aria-label="Views"><button id="tab-explore" class="active" aria-selected="true">Explore Data</button><button id="tab-schema" aria-selected="false">Schema</button><span id="query-badge">data</span></nav>
    <div id="sql-panel" class="sql-panel"><div class="editor-header"><label for="sql">Query editor <span id="query-scope">Read-only / table: data</span></label><button id="reset-sql" class="quiet">Reset</button></div><details id="workspace-tables" class="workspace-tables" hidden><summary>Workspace tables</summary><p id="workspace-table-help">Use <code>data</code> for the current file, or insert a workspace table below to JOIN or UNION files. Expand folders in the sidebar to see more tables. Only this workspace is available.</p><div id="workspace-table-list"></div></details><div class="sql-input-wrap"><textarea id="sql" spellcheck="false" aria-label="SQL query">SELECT * FROM data</textarea></div><div class="editor-footer"><span>Ctrl / ⌘ + Enter to run <small id="query-save" hidden></small></span><button id="run" class="primary">Run query</button></div></div>
    <div id="data-panel" class="data-panel">
      <form id="filter-form" class="toolbar"><label class="filter-field">Column<select id="filter-column" aria-label="Filter column"><option value="">Choose a column</option></select></label><label class="filter-field">Contains<input id="filter-value" aria-label="Filter value" placeholder="Text to match"></label><button id="apply-filter" type="submit">Apply filter</button><button id="clear-filter" type="button" class="quiet">Clear</button><span class="toolbar-spacer"></span><label>Rows <select id="page-size" aria-label="Rows per page"><option>50</option><option selected>100</option><option>250</option><option>500</option></select></label></form>
      <div id="grid-scroll" class="grid-scroll" tabindex="0" aria-label="Query results"><table id="grid"><thead></thead><tbody></tbody></table><div id="empty-result" class="empty-result" hidden>No matching rows.<small>Try another filter or query.</small></div></div>
      <footer class="table-footer"><span id="result-summary">Ready</span><div class="pagination"><button id="previous" aria-label="Previous page">←</button><span id="page-label">Page 1</span><button id="next" aria-label="Next page">→</button></div></footer>
    </div>
    <div id="schema-panel" class="schema-panel" hidden><div class="schema-note">Types are read directly from the Parquet file. Values stay exact across the desktop bridge.</div><table><thead><tr><th>#</th><th>Column</th><th>Logical type</th></tr></thead><tbody id="schema-body"></tbody></table></div>
  </section>
  <div id="notification" role="status" aria-live="polite" hidden></div>
  <div id="busy" class="busy" hidden><span class="spinner"></span><span id="busy-text">Reading your file…</span><button id="cancel">Cancel</button></div>
</main>
<dialog id="export-dialog" class="connection-dialog" aria-labelledby="export-title" aria-describedby="export-description">
 <div class="connection-heading"><div><h2 id="export-title" tabindex="-1">Export data</h2><p id="export-description">Export the current preview page. Choose a format.</p></div><button id="export-dismiss" class="quiet" aria-label="Close export chooser">×</button></div>
 <button id="export-json" class="source-option"><svg class="button-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M10 11H9a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1h1m4-6h1a1 1 0 0 1 1 1v1a1 1 0 0 0 1 1 1 1 0 0 0-1 1v1a1 1 0 0 1-1 1h-1"/></svg><span><strong>JSON</strong><small>Preserve column types, exact values and NULL.</small></span></button>
 <button id="export-csv" class="source-option"><svg class="button-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><rect x="7" y="11" width="10" height="7" rx=".5"/><path d="M7 14h10m-6-3v7"/></svg><span><strong>CSV</strong><small>Formula-like text gets a leading apostrophe. NULL and empty text export as empty fields. Use JSON for original values.</small></span></button>
</dialog>
<dialog id="source-dialog" class="connection-dialog source-dialog" aria-labelledby="source-title">
 <div class="connection-heading"><div><h2 id="source-title">Open data</h2><p>Choose where your data lives.</p></div><button id="source-dismiss" class="quiet" aria-label="Close data source chooser">×</button></div>
 <div class="source-tabs" role="tablist" aria-label="Data location"><button id="source-local" role="tab" aria-selected="true" aria-controls="sources-local"><svg class="tab-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></svg>This computer</button><button id="source-cloud" role="tab" aria-selected="false" aria-controls="sources-cloud" tabindex="-1"><svg class="tab-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 20 10a4 4 0 0 1 0 8H7Z"/></svg>Cloud storage</button></div>
 <div id="sources-local" role="tabpanel" aria-labelledby="source-local">
  <button id="open" class="source-option"><svg class="button-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg><span><strong>Open file</strong><small>Browse a Parquet file</small></span><kbd>Ctrl / ⌘ + O</kbd></button>
  <button id="open-folder" class="source-option"><svg class="button-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg><span><strong>Open folder</strong><small>Query files together as a workspace</small></span><span class="source-arrow" aria-hidden="true">›</span></button>
 </div>
 <div id="sources-cloud" role="tabpanel" aria-labelledby="source-cloud" hidden>
  <button id="open-r2" class="source-option"><span><strong>Cloudflare R2</strong><small>Connect a bucket or folder prefix</small></span><span class="source-arrow" aria-hidden="true">›</span></button>
  <button id="open-s3" class="source-option"><span><strong>Amazon S3</strong><small>Connect an AWS bucket</small></span><span class="source-arrow" aria-hidden="true">›</span></button>
  <button id="manage-connections" class="quiet"><svg width="18" height="18" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 3 6 0 .6 2.6 2.2 1.3 2.6-.8 3 5.2-2 1.8v2.6l2 1.8-3 5.2-2.6-.8-2.2 1.3L15 26H9l-.6-2.6-2.2-1.3-2.6.8-3-5.2 2-1.8v-2.6l-2-1.8 3-5.2 2.6.8 2.2-1.3Z" transform="translate(2 0) scale(.83)"/><circle cx="12" cy="12" r="3.3"/></svg><span>Manage connections</span></button>
  <p class="source-note">Read-only connections. Credentials stay in the system credential store.</p>
 </div>
</dialog>
<dialog id="settings-dialog" class="connection-dialog settings-dialog" aria-labelledby="settings-title">
 <button id="settings-dismiss" class="quiet" aria-label="Close settings">×</button>
 <div class="settings-layout">
  <aside class="settings-nav">
   <h2 id="settings-title" tabindex="-1">Settings</h2>
   <div role="tablist" aria-label="Settings categories" aria-orientation="vertical">
    <button id="settings-tab-general" role="tab" aria-controls="settings-panel-general" aria-selected="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 3 6 0 .6 2.6 2.2 1.3 2.6-.8 3 5.2-2 1.8v2.6l2 1.8-3 5.2-2.6-.8-2.2 1.3L15 26H9l-.6-2.6-2.2-1.3-2.6.8-3-5.2 2-1.8v-2.6l-2-1.8 3-5.2 2.6.8 2.2-1.3Z" transform="translate(2 0) scale(.83)"/><circle cx="12" cy="12" r="3.3"/></svg>General</button>
    <button id="settings-tab-connections" role="tab" aria-controls="settings-panel-connections" aria-selected="false" tabindex="-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M7 18a5 5 0 1 1 1-10 6 6 0 0 1 11 2 4 4 0 0 1-1 8Z"/></svg>Cloud connections</button>
    <button id="settings-tab-performance" role="tab" aria-controls="settings-panel-performance" aria-selected="false" tabindex="-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4M18 9h4m-4 6h4"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>Performance</button>
   </div>
  </aside>
  <div class="settings-content">
   <section id="settings-panel-connections" role="tabpanel" aria-labelledby="settings-tab-connections" tabindex="0" hidden>
    <h3 class="settings-page-title">Cloud connections</h3>
    <p class="settings-description">Manage your saved data connections.</p>
    <div class="settings-section-heading"><span class="connection-note">Available across workspaces</span><button id="settings-add" class="quiet connection-add-button" title="Add connection" aria-label="Add connection" aria-haspopup="dialog"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>
    <div id="connection-list"></div>
   </section>
   <section id="settings-panel-general" role="tabpanel" aria-labelledby="settings-tab-general" tabindex="0">
    <h3 class="settings-page-title">General</h3>
    <div class="general-appearance">
    <h4 id="appearance-title">Appearance</h4>
    <div class="appearance-choices" role="radiogroup" aria-labelledby="appearance-title">
     <button type="button" id="appearance-light" role="radio" data-appearance="light" aria-checked="false" tabindex="-1">${appearancePreview("light")}<span>Light</span></button>
     <button type="button" id="appearance-dark" role="radio" data-appearance="dark" aria-checked="false" tabindex="-1">${appearancePreview("dark")}<span>Dark</span></button>
     <button type="button" id="appearance-system" role="radio" data-appearance="system" aria-checked="true">${appearancePreview("system")}<span>Auto</span></button>
    </div>
    </div>
    <div class="general-language">
     <label class="language-field" for="interface-language">Language</label>
     <div class="language-select"><select id="interface-language"><option value="en" lang="en">English</option><option value="zh-CN" lang="zh-CN">简体中文</option></select><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></div>
    </div>
    <div class="general-updates">
     <div><h4>Software updates</h4><p id="update-version" class="muted"></p></div>
     <button id="check-updates" class="quiet" disabled>Check for updates</button>
     <label for="automatic-updates">Automatically check for updates</label>
     <label class="resource-toggle update-toggle"><input id="automatic-updates" type="checkbox" role="switch" aria-label="Automatically check for updates" disabled></label>
     <p id="update-message" class="muted" role="status" aria-live="polite"></p>
    </div>
   </section>
   <section id="settings-panel-performance" role="tabpanel" aria-labelledby="settings-tab-performance" tabindex="0" hidden>
    <h3 class="settings-page-title">Performance</h3>
    <form id="resources-form" class="resource-settings">
     <div class="resource-field"><label for="query-memory-mode">Query memory</label><label class="resource-toggle"><span>Auto</span><input id="query-memory-mode" type="checkbox" role="switch" aria-label="Automatic query memory"></label><p>Auto uses 25% of physical memory. Custom lets you choose the limit.</p></div>
     <div class="resource-field resource-budget"><label id="query-memory-label" for="query-memory">Query memory limit</label><div class="resource-budget-control"><div class="resource-range"><input id="query-memory-range" type="range" min="128" max="16384" step="1" aria-labelledby="query-memory-label" aria-describedby="query-memory-summary query-memory-warning"><div id="query-memory-ticks" class="resource-ticks" aria-hidden="true"></div></div><div class="resource-input"><input id="query-memory" type="number" min="128" step="1" required aria-describedby="query-memory-summary query-memory-warning"><span>MiB</span></div></div><p id="query-memory-summary"></p><p id="query-memory-warning" class="resource-warning" role="status" hidden>Above 75% of physical memory. This may slow down your computer and other apps.</p></div>
     <div class="resource-field"><label for="query-disk-mode">Temporary disk</label><label class="resource-toggle"><span>Auto</span><input id="query-disk-mode" type="checkbox" role="switch" aria-label="Automatic temporary disk"></label><p>Auto uses 25% of available space after reserving 1 GiB.</p></div>
     <div class="resource-field resource-budget"><label id="query-disk-label" for="query-disk">Temporary disk limit</label><div class="resource-budget-control"><div class="resource-range"><input id="query-disk-range" type="range" min="0" max="0" step="1" aria-labelledby="query-disk-label" aria-describedby="query-disk-summary query-disk-help"><div id="query-disk-ticks" class="resource-ticks" aria-hidden="true"></div></div><div class="resource-input"><input id="query-disk" type="number" min="0" max="0" step="1" required aria-describedby="query-disk-summary query-disk-help"><span>GiB</span></div></div><p id="query-disk-summary"></p><p id="query-disk-help">Set a custom limit of 0 to disable temporary disk use.</p></div>
     <div class="resource-field"><label for="query-timeout">Query timeout</label><div class="resource-input"><input id="query-timeout" type="number" min="15" max="3600" step="1" required><span>seconds</span></div></div>
     <div class="resource-actions"><button id="save-resources" type="submit" class="primary">Save changes</button><span id="resources-status" role="status"></span></div>
    </form>
   </section>
   <p id="settings-message" role="status" hidden></p><button id="settings-cancel" hidden>Cancel operation</button>
  </div>
 </div>
</dialog>
<dialog id="connection-picker" class="connection-dialog source-dialog" aria-labelledby="connection-picker-title">
 <div class="connection-heading"><div><h2 id="connection-picker-title">Add connection</h2></div><button id="connection-picker-dismiss" type="button" class="quiet" aria-label="Close cloud connection">×</button></div>
 <div id="connection-provider-options"></div>
</dialog>
<dialog id="r2-dialog" class="connection-dialog" aria-labelledby="r2-title">
 <form id="r2-form" autocomplete="off">
 <div class="connection-heading"><div><h2 id="r2-title">Connect Cloudflare R2</h2><p>Browse and query Parquet files in a read-only workspace.</p></div><button id="r2-dismiss" type="button" class="quiet" aria-label="Close cloud connection">×</button></div>
 <label>Workspace name <span class="optional">optional</span><input id="r2-name" maxlength="200" placeholder="Research data"></label>
 <label id="endpoint-field">S3 endpoint<input id="r2-endpoint" type="url" required placeholder="https://ACCOUNT_ID.r2.cloudflarestorage.com" spellcheck="false"></label>
 <label id="region-field" hidden>AWS Region<input id="s3-region" maxlength="40" placeholder="us-west-2" spellcheck="false"></label>
 <div class="connection-row"><label>Bucket<input id="r2-bucket" required maxlength="63" spellcheck="false" placeholder="analytics"></label><label>Folder prefix <span class="optional">optional</span><input id="r2-prefix" maxlength="1024" spellcheck="false" placeholder="orders/2026"></label></div>
 <p id="r2-edit-note" class="connection-note" hidden></p>
 <label>Access Key ID<input id="r2-access" required maxlength="256" autocomplete="off" spellcheck="false"></label>
 <label>Secret Access Key<input id="r2-secret" type="password" required maxlength="512" autocomplete="new-password" spellcheck="false"></label>
 <label id="token-field" hidden>Session Token <span class="optional">for temporary credentials</span><input id="s3-token" type="password" maxlength="16384" autocomplete="new-password" spellcheck="false"></label>
 <p id="cloud-credentials-note" class="connection-note">Use R2 Object Read only credentials scoped to this bucket. Keys are stored in the system credential store. Files are read from R2 as needed; queries run on this computer.</p>
 <p id="r2-error" role="alert" hidden></p>
 <div class="connection-actions"><button id="r2-back" type="button" class="quiet">Back</button><button id="r2-cancel" type="button">Cancel</button><button id="r2-submit" type="submit" class="primary">Test &amp; connect</button></div>
 </form>
</dialog>`;
localizeStatic(app);
const isCloudRoot = (root: string) =>
  root.startsWith("r2://") || root.startsWith("s3://");
const providerName = (provider: string) =>
  provider === "s3" ? "Amazon S3" : "Cloudflare R2";
let file: DataFile | null = null;
let result: Result | null = null;
let busy = false;
let view = "explore";
let appliedSQL = "SELECT * FROM data";
let request: Request = {
  sql: appliedSQL,
  offset: 0,
  limit: 100,
  sort: "",
  desc: false,
  filterColumn: "",
  filterValue: "",
};
let folder: Info | null = null;
let relativeFile = "";
let workspaceRoot = "";
const workspaceQueries = new Map<
  string,
  { draft: string; applied: string; request: Request }
>();
const folders = new Map<string, Info>();
let restoringSession = false;
type DocumentState = {
  pendingRestore?: boolean;
  file: DataFile;
  draft: string;
  applied: string;
  request: Request;
  view: string;
};
const documents = new Map<string, DocumentState>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave = Promise.resolve();
const displayRoot = (info: Info) => info.location || info.root;
function owner(path: string) {
  return (
    [...folders.values()]
      .filter((f) => workspaceContains(f.root, path))
      .sort((a, b) => b.root.length - a.root.length)[0] || null
  );
}
function rememberCurrent() {
  if (!file && folder)
    workspaceQueries.set(folder.root, {
      draft: $<HTMLTextAreaElement>("sql").value,
      applied: appliedSQL,
      request: { ...request },
    });
  if (file)
    documents.set(file.path, {
      file,
      draft: $<HTMLTextAreaElement>("sql").value,
      applied: appliedSQL,
      request: { ...request },
      view,
    });
}
function updateFolder() {
  $("open-data").hidden = !$("welcome").hidden;
  $("columns-label").hidden = !file;
  $("column-list").hidden = !file;
  folder = file ? owner(file.path) : folders.get(workspaceRoot) || null;
  relativeFile =
    folder && file
      ? workspaceRelative(folder.root, file.path)
      : folder
        ? "."
        : "";
  document.body.classList.toggle("folder-mode", folders.size > 0);
  document.body.classList.toggle("files-mode", documents.size > 0);
  $("folder-panel").hidden = folders.size === 0;
  if (folder) rawText($("scope-name"), folder.name);
  else setText($("scope-name"), "File");
  if (folder) $("scope-name").title = displayRoot(folder);
  else setAttribute($("scope-name"), "title", "Single file");
  $("query-save").hidden = !file && !folder;
  document.body.classList.toggle("workspace-query-mode", !file && !!folder);
  const sourceBadge = document.querySelector<HTMLElement>(".local-badge")!;
  sourceBadge.hidden = !folder || !isCloudRoot(folder.root);
  if (sourceBadge.hidden) rawText(sourceBadge, "");
  else
    setText(sourceBadge, "{provider} / read-only", {
      provider: folder!.root.startsWith("s3://") ? "S3" : "R2",
    });
  setText(
    $("query-scope"),
    file ? "Read-only / table: data" : "Read-only / workspace",
  );
  if (!file && folder) {
    setText($("breadcrumb"), "Explore Data");
    rawText($("file-name"), folder.name);
    rawText($("file-path"), displayRoot(folder));
    $("file-path").title = displayRoot(folder);
  }
  document
    .querySelectorAll<HTMLElement>(".workspace-group")
    .forEach((p) =>
      p
        .querySelector('[data-control="folder-name"]')!
        .setAttribute(
          "aria-current",
          String(!file && p.dataset.root === workspaceRoot),
        ),
    );
  if (file) {
    rawText($("breadcrumb"), folder ? relativeFile : file.name);
    if (folder?.location) {
      rawText($("file-path"), displayRoot(folder) + "/" + relativeFile);
      $("file-path").title = $("file-path").textContent;
    }
  }
  document.querySelectorAll<HTMLButtonElement>(".tree-file").forEach((b) => {
    const path = b.dataset.fullPath!,
      row = b.parentElement!;
    const doc = documents.get(path),
      active = file?.path === path;
    b.classList.toggle("selected", active);
    b.setAttribute("aria-current", String(active));
    row.classList.toggle("opened-file", !!doc);
    row.classList.toggle("selected", active);
    row.querySelector(".close-file")?.remove();
    if (doc) row.append(closeFileButton(path, doc.file.name));
  });
  updateQueryTables();
  const list = $("open-files");
  list.replaceChildren();
  const external = [...documents.values()].filter(
    (doc) => !owner(doc.file.path),
  );
  $("open-files-panel").hidden = external.length === 0;
  if (external.length) {
    const group = el("div", "", "opened-group external-files");
    group.append(ui("div", "Other files", "opened-group-name"));
    for (const doc of external) {
      const row = el("div", "", "opened-file");
      row.dataset.path = doc.file.path;
      const button = el(
        "button",
        doc.file.name,
        "activate-file",
      ) as HTMLButtonElement;
      button.title = doc.file.path;
      button.setAttribute("aria-current", String(file?.path === doc.file.path));
      row.classList.toggle("selected", file?.path === doc.file.path);
      button.onclick = () =>
        void task("Switching file…", async () => {
          await saveQuery();
          await switchFile(doc.file.path);
        });
      row.append(button, closeFileButton(doc.file.path, doc.file.name));
      group.append(row);
    }
    list.append(group);
  }
}
function tableReference(path: string) {
  return `workspace."${path.replaceAll('"', '""')}"`;
}
function updateQueryTables() {
  $("workspace-tables").hidden = !folder;
  const list = $("workspace-table-list");
  list.replaceChildren();
  if (!folder) return;
  setText(
    $("workspace-table-help"),
    file
      ? "Use data for the current file, or insert a workspace table below to JOIN or UNION files. Expand folders in the sidebar to see more tables."
      : 'Insert a table name below, or type workspace."relative/path.parquet". JOIN and UNION files without opening them. Expand folders in the sidebar to see more tables.',
  );
  const paths = new Set(file ? [relativeFile] : []);
  document.querySelectorAll<HTMLButtonElement>(".tree-file").forEach((b) => {
    if (b.dataset.root === folder!.root) paths.add(b.dataset.path!);
  });
  for (const path of paths) {
    const ref = tableReference(path);
    const button = el("button", ref, "table-reference") as HTMLButtonElement;
    setAttribute(button, "title", "Insert {ref} at cursor", { ref });
    button.onclick = () => {
      const editor = $<HTMLTextAreaElement>("sql");
      editor.setRangeText(
        ref,
        editor.selectionStart,
        editor.selectionEnd,
        "end",
      );
      editor.focus();
      queryEdited();
    };
    list.append(button);
  }
}
function closeFileButton(path: string, name: string) {
  const close = el("button", "×", "close-file") as HTMLButtonElement;
  setAttribute(close, "title", "Close {name}", { name });
  setAttribute(close, "aria-label", "Close {name}", { name });
  close.onclick = () => void task("Closing file…", () => closeDocument(path));
  return close;
}

function saveQuery() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  rememberCurrent();
  if (!folder || !relativeFile) {
    if (file) setText($("query-save"), "Kept for this session");
    return pendingSave;
  }
  const root = folder.root,
    path = relativeFile,
    draft = $<HTMLTextAreaElement>("sql").value,
    applied = appliedSQL;
  setText($("query-save"), "Saving…");
  pendingSave = pendingSave
    .catch(() => {})
    .then(() => Workbench.saveWorkspaceQuery(root, path, draft, applied));
  void pendingSave.then(
    () => {
      setText($("query-save"), "Saved locally");
    },
    (e) => {
      setText($("query-save"), "Not saved");
      notify("Could not save query: {error}", true, { error: String(e) });
    },
  );
  return pendingSave;
}
function queryEdited() {
  controls();
  rememberCurrent();
  if (!folder || !relativeFile) {
    if (file) setText($("query-save"), "Kept for this session");
    return;
  }
  setText($("query-save"), "Unsaved changes");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveQuery();
  }, 350);
}
async function directory(
  container: HTMLElement,
  info: Info,
  rel: string,
  offset = 0,
) {
  const page = await Workbench.listDirectory(info.root, rel, offset);
  if (!page) throw new Error("No directory listing returned");
  if (offset === 0) container.replaceChildren();
  container.querySelector(":scope > .tree-more")?.remove();
  for (const entry of page.entries) {
    const row = el(
      "div",
      "",
      entry.directory ? "tree-entry" : "tree-entry tree-file-row",
    );
    row.dataset.path = workspacePath(info.root, entry.path);
    const button = el(
      "button",
      `${entry.directory ? "▸" : "▧"} ${entry.name}`,
      entry.directory ? "tree-folder" : "tree-file activate-file",
    ) as HTMLButtonElement;
    button.title = entry.directory
      ? entry.path
      : `${entry.path} — SQL: ${tableReference(entry.path)}`;
    button.dataset.path = entry.path;
    button.dataset.root = info.root;
    button.dataset.fullPath = workspacePath(info.root, entry.path);
    row.append(button);
    container.append(row);
    if (entry.directory) {
      const children = el("div", "", "tree-children");
      children.hidden = true;
      row.append(children);
      button.setAttribute("aria-expanded", "false");
      button.onclick = () =>
        void task("Reading folder…", async () => {
          if (children.hidden) {
            await directory(children, info, entry.path);
            children.hidden = false;
            button.textContent = `▾ ${entry.name}`;
            button.setAttribute("aria-expanded", "true");
          } else {
            children.hidden = true;
            button.textContent = `▸ ${entry.name}`;
            button.setAttribute("aria-expanded", "false");
          }
        });
    } else
      button.onclick = () =>
        void task("Opening file…", async () => {
          await saveQuery();
          await openFolderFile(info, entry.path);
        });
  }
  if (page.more) {
    const more = ui("button", "Load more entries", "tree-more");
    more.onclick = () =>
      void task("Reading folder…", () =>
        directory(container, info, rel, page.next),
      );
    container.append(more);
  } else if (!container.children.length)
    container.append(
      ui("p", "No visible folders or Parquet files", "aside-hint"),
    );
  updateFolder();
}
async function activate(
  f: DataFile,
  saved?: { draft: string; applied: string },
) {
  const remembered = documents.get(f.path);
  const previewOnly = restoringSession || remembered?.pendingRestore;
  const cached = remembered?.pendingRestore ? undefined : remembered;
  const draft = cached
    ? cached.draft
    : saved
      ? saved.draft
      : "SELECT * FROM data";
  let applied = cached
    ? cached.applied
    : saved?.applied || "SELECT * FROM data";
  const initial: Request = {
    sql: "SELECT * FROM data",
    offset: 0,
    limit: Number($<HTMLSelectElement>("page-size").value),
    sort: "",
    desc: false,
    filterColumn: "",
    filterValue: "",
  };
  if (previewOnly) applied = initial.sql;
  let next =
    cached && !previewOnly
      ? { ...cached.request }
      : { ...initial, sql: applied };
  let loaded: Result,
    warning = "";
  try {
    loaded = await queryResult(next);
  } catch (e) {
    next = initial;
    applied = initial.sql;
    warning = t(
      "Saved query could not run; showing the file preview. Draft preserved. {error}",
      { error: String(e) },
    );
    try {
      loaded = await queryResult(next);
    } catch (error) {
      // The backend already opened this file. Never leave another file's rows
      // visible as if they belonged to the new engine after a failed preview.
      showFile(f);
      $<HTMLTextAreaElement>("sql").value = draft;
      rememberCurrent();
      updateFolder();
      throw error;
    }
  }
  // Commit metadata, editor, view and result together, without an IPC await
  // between clearing the previous table and painting its replacement.
  showFile(f);
  $<HTMLTextAreaElement>("sql").value = draft;
  appliedSQL = applied;
  request = next;
  $<HTMLSelectElement>("page-size").value = String(next.limit);
  $<HTMLInputElement>("filter-value").value = next.filterValue;
  render(loaded);
  setView(cached ? cached.view : "explore");
  rememberCurrent();
  updateFolder();
  setText($("query-save"), folder ? "Saved locally" : "Kept for this session");
  if (warning) notify(warning, true);
}

async function openFolderFile(info: Info, path: string) {
  const opened = await Workbench.openWorkspaceFile(info.root, path);
  if (!opened?.file) throw new Error("No file returned");
  await activate(opened.file, opened.query);
  if (opened.warning) notify(opened.warning, true);
}
async function switchFile(path: string) {
  const info = owner(path);
  if (info) await openFolderFile(info, workspaceRelative(info.root, path));
  else {
    const f = await Workbench.openPath(path);
    if (!f) throw new Error("No file returned");
    await activate(f);
  }
}
function showWelcome() {
  file = null;
  result = null;
  folder = null;
  relativeFile = "";
  workspaceRoot = "";
  $("workspace").hidden = true;
  $("welcome").hidden = false;
  setText($("breadcrumb"), "Welcome");
  $("column-list").replaceChildren();
  setText($("column-count"), "—");
  updateFolder();
}
async function showWorkspace(info: Info) {
  const saved = await Workbench.openWorkspaceQuery(info.root);
  const cached = workspaceQueries.get(info.root);
  const draft = cached?.draft ?? saved.draft;
  const applied = cached?.applied ?? saved.applied;
  const next: Request = cached
    ? { ...cached.request }
    : {
        sql: applied,
        offset: 0,
        limit: 100,
        sort: "",
        desc: false,
        filterColumn: "",
        filterValue: "",
      };
  await Workbench.clearPreview();
  let loaded: Result | null = null,
    warning = "";
  if (applied && !restoringSession) {
    try {
      loaded = await Workbench.queryWorkspace(info.root, next);
    } catch (e) {
      warning = t(
        "Saved workspace query could not run. Draft preserved. {error}",
        { error: String(e) },
      );
    }
  }
  file = null;
  folder = info;
  workspaceRoot = info.root;
  relativeFile = ".";
  result = null;
  appliedSQL = loaded ? applied : "";
  request = loaded
    ? next
    : {
        ...next,
        sql: "",
        offset: 0,
        filterColumn: "",
        filterValue: "",
        sort: "",
      };
  $("welcome").hidden = true;
  $("workspace").hidden = false;
  $("grid").querySelector("thead")!.replaceChildren();
  $("grid").querySelector("tbody")!.replaceChildren();
  $("column-list").replaceChildren();
  setText($("column-count"), "—");
  $("schema-body").replaceChildren();
  setText($("empty-result"), "Write a query to preview workspace data.");
  $("empty-result").hidden = false;
  setText($("result-summary"), "Ready to query");
  setText($("page-label"), "Page 1");
  setText($("query-badge"), "Workspace query");
  $<HTMLSelectElement>("filter-column").replaceChildren(
    Object.assign(ui("option", "Choose a column"), { value: "" }),
  );
  $<HTMLInputElement>("filter-value").value = request.filterValue;
  $<HTMLSelectElement>("page-size").value = String(request.limit);
  const editor = $<HTMLTextAreaElement>("sql");
  editor.value = draft;
  editor.placeholder = 'SELECT * FROM workspace."filename.parquet"';
  if (loaded) {
    render(loaded);
    setText($("empty-result"), "No matching rows.");
  }
  setView("explore");
  updateFolder();
  rememberCurrent();
  setText($("query-save"), "Saved locally");
  if (warning) notify(warning, true);
}
async function previewAfterClose(next?: string) {
  if (next) {
    try {
      await switchFile(next);
    } catch (e) {
      await Workbench.clearPreview();
      showWelcome();
      notify("File closed. Choose another file to continue. {error}", true, {
        error: String(e),
      });
    }
  } else {
    const info =
      folders.get(workspaceRoot) ||
      (folder && folders.get(folder.root)) ||
      folders.values().next().value;
    if (info) await showWorkspace(info);
    else {
      await Workbench.clearPreview();
      showWelcome();
    }
  }
}
async function closeDocument(path: string) {
  await saveQuery();
  const info = owner(path);
  if (info)
    await Workbench.closeWorkspaceFile(
      info.root,
      workspaceRelative(info.root, path),
    );
  else await Workbench.closeFile(path);
  const paths = [...documents.keys()],
    index = paths.indexOf(path),
    wasActive = file?.path === path;
  documents.delete(path);
  if (wasActive) {
    await previewAfterClose(paths[index + 1] || paths[index - 1]);
  }
  updateFolder();
}
async function removeWorkspaceUI(root: string) {
  const closing = [...documents.keys()].filter(
    (path) => owner(path)?.root === root,
  );
  const closesActive =
    (!!file && closing.includes(file.path)) ||
    (!file && workspaceRoot === root);
  for (const path of closing) documents.delete(path);
  folders.delete(root);
  workspaceQueries.delete(root);
  document.querySelectorAll<HTMLElement>(".workspace-group").forEach((p) => {
    if (p.dataset.root === root) p.remove();
  });
  if (closesActive) await previewAfterClose(documents.keys().next().value);
  updateFolder();
  if (file)
    setText(
      $("query-save"),
      folder ? "Saved locally" : "Kept for this session",
    );
}
async function showFolder(info: Info, restore = false) {
  if (folders.has(info.root)) {
    if (!restore) await showWorkspace(info);
    return;
  }
  folders.set(info.root, info);
  const panel = el("section", "", "workspace-group");
  panel.dataset.root = info.root;
  panel.innerHTML = `<div class="folder-heading"><button type="button" data-control="folder-toggle" class="workspace-toggle quiet" aria-expanded="true" title="Collapse workspace" aria-label="Collapse workspace"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7"/></svg></button><button class="workspace-name quiet" data-control="folder-name" title="Query this workspace"></button><div class="folder-actions"><button data-control="folder-refresh" class="quiet" title="Refresh" aria-label="Refresh"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 7v5h-5M4 17v-5h5M6.1 6.1a8 8 0 0 1 13.1 3L20 12M4 12l.8 2.9a8 8 0 0 0 13.1 3"/></svg></button><button data-control="folder-rename" class="quiet" title="Rename workspace" aria-label="Rename workspace"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m15 5 4 4M4 20l4-1 12-12a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></svg></button><button data-control="folder-close" class="quiet" title="Close workspace" aria-label="Close workspace"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div></div><p class="folder-path"></p><form data-control="folder-rename-form" hidden><input data-control="folder-name-input" aria-label="Workspace name" maxlength="200" required><button type="submit">Save</button><button data-control="folder-rename-cancel" type="button">Cancel</button></form><div class="folder-tree" aria-label="Workspace files"></div>`;
  localizeStatic(panel);
  const control = <T extends HTMLElement = HTMLElement>(name: string) =>
    panel.querySelector<T>(`[data-control="${name}"]`)!;
  control("folder-name").onclick = () =>
    void task("Opening workspace query…", async () => {
      await saveQuery();
      await showWorkspace(info);
    });
  const heading = () => {
    control("folder-name").textContent = info.name;
    control<HTMLInputElement>("folder-name-input").value = info.name;
  };
  heading();
  const path = panel.querySelector<HTMLElement>(".folder-path")!;
  path.textContent = displayRoot(info);
  path.title = displayRoot(info);
  const tree = panel.querySelector<HTMLElement>(".folder-tree")!;
  const toggle = control("folder-toggle");
  const sectionID = `workspace-${encodeURIComponent(info.root)}`;
  path.id = `${sectionID}-path`;
  tree.id = `${sectionID}-files`;
  toggle.setAttribute("aria-controls", `${path.id} ${tree.id}`);
  toggle.onclick = () => {
    const collapsed = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    path.hidden = collapsed;
    tree.hidden = collapsed;
    const label = collapsed ? "Expand workspace" : "Collapse workspace";
    setAttribute(toggle, "title", label);
    setAttribute(toggle, "aria-label", label);
  };

  control("folder-refresh").onclick = () =>
    void task("Refreshing folder…", () => directory(tree, info, "."));
  control("folder-rename").onclick = () => {
    control("folder-rename-form").hidden = false;
    control("folder-name-input").focus();
  };
  control("folder-rename-cancel").onclick = () => {
    control("folder-rename-form").hidden = true;
    heading();
  };
  control("folder-rename-form").onsubmit = (e) => {
    e.preventDefault();
    void task("Renaming workspace…", async () => {
      const renamed = await Workbench.renameWorkspace(
        info.root,
        control<HTMLInputElement>("folder-name-input").value,
      );
      if (!renamed) throw new Error("No workspace returned");
      info.name = renamed.name;
      heading();
      control("folder-rename-form").hidden = true;
      updateFolder();
    });
  };
  control("folder-close").onclick = () =>
    void task("Closing workspace…", async () => {
      await saveQuery();
      await Workbench.closeWorkspace(info.root);
      await removeWorkspaceUI(info.root);
    });
  $("workspace-roots").append(panel);
  updateFolder();
  try {
    await directory(tree, info, ".");
  } catch (e) {
    tree.replaceChildren(
      ui(
        "p",
        isCloudRoot(info.root)
          ? "Cloud storage is unavailable. Refresh to retry, or reconnect with updated credentials."
          : "Workspace is unavailable. Refresh to retry. Its saved state is preserved.",
        "aside-hint",
      ),
    );
    notify(String(e), true);
  }
  if (!restore) await showWorkspace(info);
}
async function openFolder() {
  await task("Opening workspace…", async () => {
    await saveQuery();
    const info = await Workbench.openWorkspace();
    if (info) await showFolder(info);
  });
}
const sourceDialog = $<HTMLDialogElement>("source-dialog");
let sourceReturn: HTMLElement;
function selectSource(kind: string) {
  for (const name of ["local", "cloud"]) {
    const selected = name === kind;
    $("source-" + name).setAttribute("aria-selected", String(selected));
    $("source-" + name).tabIndex = selected ? 0 : -1;
    $("sources-" + name).hidden = !selected;
  }
}
function showSources(trigger: HTMLElement) {
  sourceReturn = trigger;
  selectSource("local");
  sourceDialog.classList.add("initial-focus");
  sourceDialog.showModal();
  $("source-local").focus();
}
$("open-data").onclick = () => showSources($("open-data"));
$("welcome-data").onclick = () => showSources($("welcome-data"));
$("source-dismiss").onclick = () => sourceDialog.close();
sourceDialog.onclose = () => sourceReturn?.focus();
sourceDialog.addEventListener("keydown", () =>
  sourceDialog.classList.remove("initial-focus"),
);
for (const kind of ["local", "cloud"]) {
  $("source-" + kind).onclick = () => selectSource(kind);
  $("source-" + kind).onkeydown = (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const next =
        e.key === "Home"
          ? "local"
          : e.key === "End"
            ? "cloud"
            : kind === "local"
              ? "cloud"
              : "local";
      selectSource(next);
      $("source-" + next).focus();
    }
  };
}
const closeSources = () => {
  if (sourceDialog.open) sourceDialog.close();
};
$("open-folder").onclick = () => {
  closeSources();
  void openFolder();
};
const r2Dialog = $<HTMLDialogElement>("r2-dialog");
const clearR2Keys = () => {
  $<HTMLInputElement>("r2-access").value = "";
  $<HTMLInputElement>("r2-secret").value = "";
  $<HTMLInputElement>("s3-token").value = "";
};
let editingConnection = "";
let connectionProvider = "r2";
let connectionOrigin: "source" | "settings" = "source";
const settingsDialog = $<HTMLDialogElement>("settings-dialog");
const connectionPicker = $<HTMLDialogElement>("connection-picker");
let connectionLoad = 0;
function connectionLocation(c: Connection) {
  return (
    (c.provider || "r2") +
    "://" +
    c.config.bucket +
    (c.config.prefix ? "/" + c.config.prefix : "")
  );
}
const awsLogo = new URL("./assets/aws.png", import.meta.url).href;
function providerLogo(provider: string) {
  if (provider !== "s3") {
    const mark = el("span", "", "provider-logo cloudflare-mark");
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", "Cloudflare");
    return mark;
  }
  const logo = document.createElement("img");
  logo.className = "provider-logo";
  logo.src = awsLogo;
  logo.alt = "AWS";
  logo.width = 72;
  logo.height = 44;
  return logo;
}
for (const provider of ["r2", "s3"]) {
  $("open-" + provider).prepend(providerLogo(provider));
  const option = $("open-" + provider).cloneNode(true) as HTMLButtonElement;
  option.id = "settings-provider-" + provider;
  option.onclick = () => {
    connectionPicker.close();
    editR2(undefined, provider);
  };
  $("connection-provider-options").append(option);
  localizeStatic(option);
}
const connectionActionPaths = {
  Open: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h8a1 1 0 0 1 1 1v2M3 20h15l3-10H6L3 20Zm0 0V7"/>',
  Edit: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6 5-2"/>',
  Delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
};
async function refreshConnections() {
  const ticket = ++connectionLoad;
  $("connection-list").replaceChildren(
    ui("p", "Loading connections…", "settings-empty"),
  );
  try {
    const list = await Workbench.listConnections();
    if (ticket !== connectionLoad) return;
    $("connection-list").replaceChildren();
    if (!list.length)
      $("connection-list").append(
        ui(
          "p",
          "No saved connections yet. Add a cloud connection to get started.",
          "settings-empty",
        ),
      );
    for (const c of list) {
      const row = el("section", "", "connection-item");
      row.dataset.root = c.root;
      const details = el("div", "", "connection-detail");
      details.append(
        el("strong", c.config.name),
        ui(
          "small",
          c.open ? "{provider} / Workspace open" : "{provider} / Saved",
          "",
          { provider: providerName(c.provider) },
        ),
        el("p", connectionLocation(c)),
        el("small", c.config.endpoint),
      );
      const identity = el("div", "", "connection-identity");
      identity.append(providerLogo(c.provider), details);
      const actions = el("div", "", "connection-item-actions");
      const button = (
        label: keyof typeof connectionActionPaths,
        action: () => void,
      ) => {
        const b = el("button", "", "connection-action");
        setAttribute(b, "title", label + " connection");
        setAttribute(b, "aria-label", label + " connection: {name}", {
          name: c.config.name,
        });
        b.innerHTML =
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          connectionActionPaths[label] +
          "</svg>";
        b.onclick = action;
        actions.append(b);
        return b;
      };
      button("Open", () => void openSavedConnection(c)).dataset.action = "open";
      button("Edit", () => editR2(c)).dataset.action = "edit";
      const remove = button("Delete", () => {
        confirm.hidden = false;
        remove.setAttribute("aria-expanded", "true");
        cancel.focus();
      });
      remove.dataset.action = "delete";
      remove.classList.add("danger");
      remove.setAttribute("aria-expanded", "false");
      const confirm = el("div", "", "connection-delete");
      confirm.hidden = true;
      confirm.setAttribute("role", "group");
      setAttribute(confirm, "aria-label", "Confirm deletion of {name}", {
        name: c.config.name,
      });
      confirm.append(
        ui("strong", "Delete “{name}”?", "", { name: c.config.name }),
        ui(
          "p",
          "This removes the saved connection and credentials and closes its open files. Cloud files stay unchanged.",
        ),
      );
      const cancel = ui("button", "Cancel");
      cancel.onclick = () => {
        confirm.hidden = true;
        remove.setAttribute("aria-expanded", "false");
        remove.focus();
      };
      const yes = ui("button", "Delete connection", "danger");
      yes.dataset.action = "confirm-delete";
      yes.onclick = () =>
        void settingsTask("Deleting connection…", async () => {
          await saveQuery();
          await Workbench.deleteR2Connection(c.root);
          await removeWorkspaceUI(c.root);
          await refreshConnections();
        });
      confirm.append(cancel, yes);
      row.append(identity, actions, confirm);
      $("connection-list").append(row);
    }
    controls();
  } catch (e) {
    if (ticket !== connectionLoad) return;
    $("connection-list").replaceChildren();
    setText($("settings-message"), String(e));
    $("settings-message").hidden = false;
  }
}
async function settingsTask(label: string, fn: () => Promise<void>) {
  $("settings-message").hidden = true;
  await task(label, async () => {
    try {
      await fn();
    } catch (e) {
      setText($("settings-message"), String(e));
      $("settings-message").hidden = false;
      throw e;
    }
  });
}
const appearances = ["light", "dark", "system"] as const;
let appearance: (typeof appearances)[number] = "system";
function markAppearance(source: string) {
  for (const name of appearances) {
    const button = $(`appearance-${name}`);
    const selected = name === source;
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
}
async function chooseAppearance(source: (typeof appearances)[number]) {
  if (source === appearance) return;
  const previous = appearance;
  appearance = source;
  markAppearance(source);
  try {
    await Workbench.setAppearance(source);
  } catch (e) {
    appearance = previous;
    markAppearance(previous);
    setText($("settings-message"), String(e));
    $("settings-message").hidden = false;
  }
}
for (const name of appearances) {
  const button = $(`appearance-${name}`);
  button.onclick = () => void chooseAppearance(name);
  button.onkeydown = (e) => {
    const index = appearances.indexOf(name);
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? appearances[(index + 1) % 3]
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? appearances[(index + 2) % 3]
          : "";
    if (!next) return;
    e.preventDefault();
    $(`appearance-${next}`).focus();
    void chooseAppearance(next);
  };
}
const settingsPages = ["general", "connections", "performance"] as const;
function selectSettingsPage(page: (typeof settingsPages)[number]) {
  for (const name of settingsPages) {
    const selected = name === page;
    $(`settings-tab-${name}`).setAttribute("aria-selected", String(selected));
    $(`settings-tab-${name}`).tabIndex = selected ? 0 : -1;
    $(`settings-panel-${name}`).hidden = !selected;
  }
}
for (const name of settingsPages) {
  $(`settings-tab-${name}`).onclick = () => selectSettingsPage(name);
  $(`settings-tab-${name}`).onkeydown = (event) => {
    if (
      ![
        "ArrowDown",
        "ArrowUp",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    const index = settingsPages.indexOf(name);
    const next =
      event.key === "Home"
        ? settingsPages[0]
        : event.key === "End"
          ? settingsPages[settingsPages.length - 1]
          : settingsPages[
              (index +
                (["ArrowDown", "ArrowRight"].includes(event.key)
                  ? 1
                  : settingsPages.length - 1)) %
                settingsPages.length
            ];
    selectSettingsPage(next);
    $(`settings-tab-${next}`).focus();
  };
}
let resources: Resources = {
  memoryMiB: 256,
  memoryAuto: true,
  tempGiB: 4,
  tempAuto: true,
  timeoutSeconds: 300,
};
let memoryLimits: MemoryLimits = {
  physicalMiB: 0,
  maxMemoryMiB: 16384,
  autoMemoryMiB: 256,
};
let diskLimits: DiskLimits = {
  detected: false,
  availableGiB: 0,
  reserveGiB: 1,
  maxTempGiB: 0,
  autoTempGiB: 0,
};
let customTempGiB = 4;
let diskRefresh = 0;
let resourcesReady = false,
  savingResources = false,
  customMemoryMiB = 256;
function memorySummary() {
  const input = $<HTMLInputElement>("query-memory");
  const budget = Number(input.value),
    total = memoryLimits.physicalMiB;
  if (total > 0)
    setText(
      $("query-memory-summary"),
      "This computer: {total} GiB · Query budget: {budget} MiB ({percent}%).",
      {
        total: Number((total / 1024).toFixed(1)),
        budget: input.value,
        percent: Number(((budget / total) * 100).toFixed(1)),
      },
    );
  else
    setText(
      $("query-memory-summary"),
      "Memory detection unavailable. Auto uses 256 MiB; custom limit is 16384 MiB.",
    );
  $("query-memory-warning").hidden = !(
    total > 0 &&
    Number.isFinite(budget) &&
    budget > total * 0.75
  );
}
const memorySlider = attachResourceSlider(
  $<HTMLInputElement>("query-memory"),
  $<HTMLInputElement>("query-memory-range"),
  $("query-memory-ticks"),
  true,
  memorySummary,
);
function diskSummary() {
  if (diskLimits.detected)
    setText(
      $("query-disk-summary"),
      "Available: {available} GiB · Maximum: {maximum} GiB · Reserve: {reserve} GiB.",
      {
        available: diskLimits.availableGiB,
        maximum: diskLimits.maxTempGiB,
        reserve: diskLimits.reserveGiB,
      },
    );
  else
    setText(
      $("query-disk-summary"),
      "Disk space detection unavailable. Temporary disk use is disabled.",
    );
}
function markDisk() {
  const input = $<HTMLInputElement>("query-disk");
  input.max = String(diskLimits.maxTempGiB);
  if ($<HTMLInputElement>("query-disk-mode").checked)
    input.value = String(diskLimits.autoTempGiB);
  diskSlider.sync();
  diskSummary();
}
async function refreshDiskLimits() {
  const generation = ++diskRefresh;
  try {
    const limits = await Workbench.diskLimits();
    if (generation !== diskRefresh) return;
    diskLimits = limits;
  } catch {
    if (generation !== diskRefresh) return;
    diskLimits = {
      detected: false,
      availableGiB: 0,
      reserveGiB: 1,
      maxTempGiB: 0,
      autoTempGiB: 0,
    };
  }
  markDisk();
}
const diskSlider = attachResourceSlider(
  $<HTMLInputElement>("query-disk"),
  $<HTMLInputElement>("query-disk-range"),
  $("query-disk-ticks"),
  false,
);
function markResources() {
  customMemoryMiB = resources.memoryMiB;
  $<HTMLInputElement>("query-memory-mode").checked = resources.memoryAuto;
  const input = $<HTMLInputElement>("query-memory");
  input.max = String(memoryLimits.maxMemoryMiB);
  input.value = String(
    resources.memoryAuto ? memoryLimits.autoMemoryMiB : resources.memoryMiB,
  );
  customTempGiB = resources.tempGiB;
  $<HTMLInputElement>("query-disk-mode").checked = Boolean(resources.tempAuto);
  $<HTMLInputElement>("query-disk").value = String(resources.tempGiB);
  markDisk();
  $<HTMLInputElement>("query-timeout").value = String(resources.timeoutSeconds);
  memorySlider.sync();
  diskSlider.sync();
  memorySummary();
}
markResources();
$("query-memory-mode").onchange = () => {
  const auto = $<HTMLInputElement>("query-memory-mode").checked;
  const input = $<HTMLInputElement>("query-memory");
  if (auto) customMemoryMiB = Number(input.value);
  input.value = String(auto ? memoryLimits.autoMemoryMiB : customMemoryMiB);
  memorySlider.sync();
  memorySummary();
  controls();
};
$("query-disk-mode").onchange = () => {
  const auto = $<HTMLInputElement>("query-disk-mode").checked;
  const input = $<HTMLInputElement>("query-disk");
  if (auto) customTempGiB = Number(input.value);
  input.value = String(auto ? diskLimits.autoTempGiB : customTempGiB);
  diskSlider.sync();
  controls();
};
$("resources-form").onsubmit = async (event) => {
  event.preventDefault();
  if (
    savingResources ||
    !resourcesReady ||
    busy ||
    !$<HTMLFormElement>("resources-form").reportValidity()
  )
    return;
  const auto = $<HTMLInputElement>("query-memory-mode").checked;
  const next: Resources = {
    memoryAuto: auto,
    memoryMiB: auto
      ? resources.memoryMiB
      : Number($<HTMLInputElement>("query-memory").value),
    tempAuto: $<HTMLInputElement>("query-disk-mode").checked,
    tempGiB: $<HTMLInputElement>("query-disk-mode").checked
      ? customTempGiB
      : Number($<HTMLInputElement>("query-disk").value),
    timeoutSeconds: Number($<HTMLInputElement>("query-timeout").value),
  };
  savingResources = true;
  controls();
  setText($("resources-status"), "Saving…");
  $("settings-message").hidden = true;
  try {
    await Workbench.setResources(next);
    resources = next;
    markResources();
    setText($("resources-status"), "Saved. Applies to the next query.");
  } catch (error) {
    markResources();
    setText($("resources-status"), "Not saved");
    setText(
      $("settings-message"),
      error instanceof Error ? error.message : String(error),
    );
    $("settings-message").hidden = false;
  } finally {
    savingResources = false;
    controls();
  }
};
let savingLanguage = false;
$("interface-language").onchange = async () => {
  const select = $<HTMLSelectElement>("interface-language");
  if (savingLanguage) return;
  const next = select.value as Language,
    previous = getLanguage();
  if (next === previous) return;
  savingLanguage = true;
  select.disabled = true;
  $("settings-message").hidden = true;
  try {
    await Workbench.setLanguage(next);
    setLanguage(next);
  } catch (error) {
    select.value = previous;
    setText(
      $("settings-message"),
      error instanceof Error ? error.message : String(error),
    );
    $("settings-message").hidden = false;
  } finally {
    savingLanguage = false;
    select.disabled = busy;
  }
};
let updatingPreferences = false;
let updatesAvailable = false;
let manualUpdates = false;
let reminderReady = false;
let reminderTicket = 0;
async function refreshUpdateReminder() {
  const ticket = ++reminderTicket;
  try {
    const status = await Workbench.updateStatus();
    if (ticket !== reminderTicket) return;
    const version = status?.available ? status.updateVersion : "";
    $("update-reminder").hidden = !version;
    reminderReady = !!version && !!status?.canCheck;
    if (version) {
      setText($("update-reminder-label"), "Update to {version}", { version });
      setAttribute($("update-reminder"), "title", "Review and install update");
    }
  } catch {
    if (ticket !== reminderTicket) return;
    $("update-reminder").hidden = true;
    reminderReady = false;
  }
  updateControls();
}
function updateControls() {
  $("update-reminder").toggleAttribute(
    "disabled",
    busy || updatingPreferences || !reminderReady,
  );
  for (const id of ["check-updates", "automatic-updates"])
    $(id).toggleAttribute(
      "disabled",
      busy ||
        updatingPreferences ||
        !(updatesAvailable || (id === "check-updates" && manualUpdates)),
    );
}
let updateStatusTicket = 0;
async function refreshUpdateStatus() {
  const ticket = ++updateStatusTicket;
  const automatic = $<HTMLInputElement>("automatic-updates");
  updatesAvailable = false;
  manualUpdates = false;
  updateControls();
  try {
    const status = await Workbench.updateStatus();
    if (ticket !== updateStatusTicket) return;
    if (!status) throw new Error("updates are unavailable in this build");
    setText($("update-version"), "Version {version}", {
      version: status.version,
    });
    automatic.checked = status.automatic;
    updatesAvailable = status.available;
    manualUpdates = !status.available && status.canCheck;
    updateControls();
    setText(
      $("update-message"),
      status.available
        ? ""
        : manualUpdates
          ? "Updates open the releases page. Download and install manually; Bamboo will not restart."
          : "updates are unavailable in this build",
    );
  } catch (error) {
    if (ticket !== updateStatusTicket) return;
    setText(
      $("update-message"),
      error instanceof Error ? error.message : String(error),
    );
  }
}
$("automatic-updates").onchange = async () => {
  if (updatingPreferences) return;
  updatingPreferences = true;
  const input = $<HTMLInputElement>("automatic-updates");
  const previous = !input.checked;
  input.disabled = true;
  $<HTMLButtonElement>("check-updates").disabled = true;
  try {
    await Workbench.setAutomaticUpdates(input.checked);
    setText($("update-message"), "");
  } catch (error) {
    input.checked = previous;
    setText(
      $("update-message"),
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    updatingPreferences = false;
    updateControls();
  }
};
async function checkForUpdates() {
  if (updatingPreferences) return;
  updatingPreferences = true;
  $<HTMLButtonElement>("check-updates").disabled = true;
  $<HTMLInputElement>("automatic-updates").disabled = true;
  try {
    await Workbench.checkForUpdates();
    setText($("update-message"), "");
  } catch (error) {
    setText(
      $("update-message"),
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    updatingPreferences = false;
    updateControls();
    void refreshUpdateReminder();
  }
}
$("check-updates").onclick = checkForUpdates;
$("update-reminder").onclick = async () => {
  if (!reminderReady || busy) return;
  await checkForUpdates();
  if ($("update-message").textContent)
    notify($("update-message").textContent!, true);
};
function showSettings() {
  closeSources();
  $("settings-message").hidden = true;
  settingsDialog.showModal();
  void refreshDiskLimits();
  void refreshUpdateStatus();
  $("settings-title").focus();
  void refreshConnections();
}
$("settings").onclick = showSettings;
$("manage-connections").onclick = () => {
  selectSettingsPage("connections");
  showSettings();
};
$("settings-cancel").onclick = () => void Workbench.cancel();
settingsDialog.oncancel = (e) => {
  if (busy) {
    e.preventDefault();
    void Workbench.cancel();
  }
};
$("settings-dismiss").onclick = () => settingsDialog.close();
settingsDialog.onclose = () => $("settings").focus();
async function openSavedConnection(c: Connection) {
  await settingsTask("Opening connection…", async () => {
    await saveQuery();
    const info = await Workbench.openR2Connection(c.root);
    if (!info) throw new Error("No workspace returned");
    closeSources();
    if (settingsDialog.open) settingsDialog.close();
    await showFolder(info);
  });
}
function updateProviderFields() {
  const s3 = connectionProvider === "s3";
  $("endpoint-field").hidden = s3;
  $("region-field").hidden = !s3;
  $("token-field").hidden = !s3;
  $<HTMLInputElement>("r2-endpoint").required = !s3;
  $<HTMLInputElement>("s3-region").required = s3;
  setText(
    $("r2-title"),
    editingConnection ? "Edit {provider}" : "Connect {provider}",
    { provider: providerName(s3 ? "s3" : "r2") },
  );
  setText(
    $("cloud-credentials-note"),
    (s3
      ? "Use credentials with s3:ListBucket and s3:GetObject permissions. Temporary credentials also require a Session Token; replace them when they expire."
      : "Use R2 Object Read only credentials scoped to this bucket.") +
      " Credentials stay in the system credential store. Queries run on this computer.",
  );
}
function configureR2(c?: Connection, provider = "r2") {
  editingConnection = c?.root || "";
  clearR2Keys();
  connectionProvider = c?.provider || provider;
  $<HTMLInputElement>("s3-region").value = c?.config.region || "";
  $<HTMLInputElement>("s3-region").readOnly = !!c?.open;
  for (const [field, value] of Object.entries({
    name: c?.config.name || "",
    endpoint: c?.config.endpoint || "",
    bucket: c?.config.bucket || "",
    prefix: c?.config.prefix || "",
  }))
    $<HTMLInputElement>("r2-" + field).value = value;
  for (const field of ["endpoint", "bucket", "prefix"])
    $<HTMLInputElement>("r2-" + field).readOnly = !!c?.open;
  for (const field of ["access", "secret"])
    $<HTMLInputElement>("r2-" + field).required = !c;
  $("r2-edit-note").hidden = !c;
  setText(
    $("r2-edit-note"),
    "Leave all credential fields blank to keep saved credentials. Provide both keys and any Session Token to replace them." +
      (c?.open
        ? " Close the workspace before changing its location."
        : " Changing location resets saved queries."),
  );
  updateProviderFields();
  setText(
    $("r2-submit"),
    connectionOrigin === "settings" ? "Test & save" : "Test & connect",
  );
  $("r2-error").hidden = true;
  r2Dialog.showModal();
  $<HTMLInputElement>(
    c ? "r2-name" : connectionProvider === "s3" ? "s3-region" : "r2-endpoint",
  ).focus();
}
function editR2(c?: Connection, provider = "r2") {
  connectionOrigin = "settings";
  settingsDialog.close();
  configureR2(c, provider);
}
function showConnectionPicker() {
  settingsDialog.close();
  connectionPicker.showModal();
  $("settings-provider-r2").focus();
}
function closeConnectionPicker() {
  connectionPicker.close();
  showSettings();
  $("settings-add").focus();
}
$("settings-add").onclick = showConnectionPicker;
$("connection-picker-dismiss").onclick = closeConnectionPicker;
connectionPicker.oncancel = (e) => {
  e.preventDefault();
  closeConnectionPicker();
};
$("open-r2").onclick = () => {
  connectionOrigin = "source";
  closeSources();
  configureR2();
};
$("open-s3").onclick = () => {
  connectionOrigin = "source";
  closeSources();
  configureR2(undefined, "s3");
};
r2Dialog.onclose = () => {
  clearR2Keys();
  $("open-data").focus();
};
function leaveR2(back = false) {
  r2Dialog.close();
  if (connectionOrigin === "settings") {
    if (back && !editingConnection) showConnectionPicker();
    else showSettings();
  } else if (back) {
    showSources($("open-data"));
    selectSource("cloud");
    $("source-cloud").focus();
  }
}
$("r2-back").onclick = () => leaveR2(true);
r2Dialog.oncancel = (e) => {
  e.preventDefault();
  if (busy) void Workbench.cancel();
  else leaveR2();
};
$("r2-dismiss").onclick = () => leaveR2();
$("r2-cancel").onclick = () => {
  if (busy) void Workbench.cancel();
  else leaveR2();
};
$("r2-form").onsubmit = (e) => {
  e.preventDefault();
  if (busy) return;
  const provider = connectionProvider;
  const input = {
    provider,
    region: provider === "s3" ? $<HTMLInputElement>("s3-region").value : "",
    sessionToken:
      provider === "s3" ? $<HTMLInputElement>("s3-token").value : "",
    name: $<HTMLInputElement>("r2-name").value,
    endpoint: provider === "s3" ? "" : $<HTMLInputElement>("r2-endpoint").value,
    bucket: $<HTMLInputElement>("r2-bucket").value,
    prefix: $<HTMLInputElement>("r2-prefix").value,
    accessKey: $<HTMLInputElement>("r2-access").value,
    secretKey: $<HTMLInputElement>("r2-secret").value,
  };
  clearR2Keys();
  $("r2-error").hidden = true;
  setText($("r2-submit"), "Testing…");
  void task("Testing cloud connection…", async () => {
    try {
      await saveQuery();
      const info =
        connectionOrigin === "settings"
          ? await Workbench.saveR2Connection(editingConnection, input)
          : await Workbench.connectR2(input);
      if (!info) throw new Error("No cloud workspace returned");
      const existing = folders.get(info.root);
      if (existing) {
        Object.assign(existing, info);
        document
          .querySelectorAll<HTMLElement>(".workspace-group")
          .forEach((p) => {
            if (p.dataset.root === info.root)
              p.querySelector<HTMLElement>(
                '[data-control="folder-name"]',
              )!.textContent = info.name;
          });
        updateFolder();
      }
      r2Dialog.close();
      if (connectionOrigin === "settings") showSettings();
      else await showFolder(info);
    } catch (e) {
      setText($("r2-error"), String(e));
      $("r2-error").hidden = false;
      throw e;
    } finally {
      input.accessKey = "";
      input.secretKey = "";
      input.sessionToken = "";
      setText(
        $("r2-submit"),
        connectionOrigin === "settings" ? "Test & save" : "Test & connect",
      );
    }
  });
};
const sqlCompletion = attachSQLGhost(
  $<HTMLTextAreaElement>("sql"),
  () => {
    const tables: SQLTable[] = file
      ? [{ name: "data", columns: file.columns.map((c) => c.name) }]
      : [];
    if (folder) {
      const paths = new Set(file ? [relativeFile] : []);
      document
        .querySelectorAll<HTMLButtonElement>(".tree-file")
        .forEach((button) => {
          if (button.dataset.root === folder!.root)
            paths.add(button.dataset.path!);
        });
      for (const path of paths) {
        const opened = documents.get(workspacePath(folder.root, path))?.file;
        tables.push({
          name: tableReference(path),
          columns: opened?.columns.map((c) => c.name),
        });
      }
    }
    return { tables };
  },
  () => !busy && (!!file || !!folder) && view === "explore",
);
$("sql").oninput = queryEdited;
$("sql").onblur = () => {
  if (saveTimer) void saveQuery();
};

const fmt = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const size = (s: string) => {
  const n = Number(s);
  return n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
};
function el(tag: string, text: string, cls = "") {
  const n = document.createElement(tag);
  n.textContent = text;
  n.className = cls;
  return n;
}
function ui(
  tag: string,
  key: string,
  cls = "",
  params: Record<string, string | number> = {},
) {
  const n = el(tag, "", cls);
  setText(n, key, params);
  return n;
}
function notify(
  message: string,
  error = false,
  params: Record<string, string | number> = {},
) {
  const n = $("notification");
  setText(n, message, params);
  n.classList.toggle("error", error);
  n.hidden = false;
}
function controls() {
  pruneTranslations();
  $("settings-cancel").hidden = !busy;
  document
    .querySelectorAll<
      | HTMLButtonElement
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
    >("button,input,select,textarea")
    .forEach(
      (n) =>
        (n.disabled =
          busy &&
          n.id !== "cancel" &&
          n.id !== "r2-cancel" &&
          n.id !== "settings-cancel"),
    );
  updateControls();
  $("previous").toggleAttribute(
    "disabled",
    busy || !result || request.offset === 0,
  );
  $("next").toggleAttribute("disabled", busy || !result?.more);
  $("export").toggleAttribute("disabled", busy || !result);
  $("run").toggleAttribute(
    "disabled",
    busy || (!file && (!folder || !$<HTMLTextAreaElement>("sql").value.trim())),
  );
  for (const id of ["apply-filter", "clear-filter", "page-size"])
    $(id).toggleAttribute("disabled", busy || !result);
  for (const id of [
    "query-memory-mode",
    "query-memory",
    "query-memory-range",
    "query-disk-mode",
    "query-disk",
    "query-disk-range",
    "query-timeout",
    "save-resources",
  ])
    $(id).toggleAttribute(
      "disabled",
      busy || savingResources || !resourcesReady,
    );
  for (const id of ["query-memory", "query-memory-range"])
    $(id).toggleAttribute(
      "disabled",
      busy ||
        savingResources ||
        !resourcesReady ||
        $<HTMLInputElement>("query-memory-mode").checked,
    );
  for (const id of ["query-disk", "query-disk-range"])
    $(id).toggleAttribute(
      "disabled",
      busy ||
        savingResources ||
        !resourcesReady ||
        $<HTMLInputElement>("query-disk-mode").checked,
    );
  $("interface-language").toggleAttribute("disabled", busy || savingLanguage);
  sqlCompletion.refresh();
}
async function task(label: string, fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  document.body.classList.add("is-busy");
  $("workspace").setAttribute("aria-busy", "true");
  $("busy").hidden = false;
  setText($("busy-text"), label);
  $("notification").hidden = true;
  controls();
  try {
    await fn();
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e), true);
  } finally {
    busy = false;
    document.body.classList.remove("is-busy");
    $("workspace").setAttribute("aria-busy", "false");
    $("busy").hidden = true;
    controls();
  }
}
function setView(next: string) {
  if (next === "schema" && !file) return;
  view = next;
  for (const name of ["explore", "schema"]) {
    const b = $(`tab-${name}`);
    b.classList.toggle("active", name === view);
    b.setAttribute("aria-selected", String(name === view));
  }
  $("sql-panel").hidden = view === "schema";
  $("data-panel").hidden = view === "schema";
  $("schema-panel").hidden = view !== "schema";
}
function showFile(f: DataFile) {
  workspaceRoot = "";
  file = f;
  rawText($("empty-result"), "");
  $("empty-result").innerHTML =
    "No matching rows.<small>Try another filter or query.</small>";
  localizeStatic($("empty-result"));
  result = null;
  $("grid").querySelector("thead")!.replaceChildren();
  $("grid").querySelector("tbody")!.replaceChildren();
  appliedSQL = "SELECT * FROM data";
  request = {
    sql: appliedSQL,
    offset: 0,
    limit: Number($<HTMLSelectElement>("page-size").value),
    sort: "",
    desc: false,
    filterColumn: "",
    filterValue: "",
  };
  $("welcome").hidden = true;
  $("workspace").hidden = false;
  rawText($("breadcrumb"), f.name);
  rawText($("file-name"), f.name);
  rawText($("file-path"), f.path);
  $("file-path").title = f.path;
  $("row-count").textContent = fmt(f.rows);
  $("metric-columns").textContent = String(f.columns.length);
  $("file-size").textContent = size(f.bytes);
  $("row-groups").textContent = fmt(f.rowGroups);
  $("column-count").textContent = String(f.columns.length);
  const card = $("file-card");
  card.classList.remove("muted");
  card.replaceChildren(
    el("span", "▧", "file-icon"),
    el("strong", f.name),
    ui("small", "{rows} rows / {size}", "", {
      rows: fmt(f.rows),
      size: size(f.bytes),
    }),
  );
  const list = $("column-list");
  list.replaceChildren();
  const schema = $("schema-body");
  schema.replaceChildren();
  f.columns.forEach((c, i) => {
    const item = el("div", "", "column-item");
    item.append(
      el(
        "span",
        /INT|DECIMAL|FLOAT|DOUBLE/.test(c.type)
          ? "#"
          : c.type.includes("TIME")
            ? "◷"
            : "T",
        "type-icon",
      ),
      el("span", c.name),
      el("small", c.type),
    );
    item.title = `${c.name} / ${c.type}`;
    list.append(item);
    const tr = document.createElement("tr");
    tr.append(
      el("td", String(i + 1)),
      el("td", c.name),
      el("td", c.type, "type-cell"),
    );
    schema.append(tr);
  });
  $<HTMLTextAreaElement>("sql").value = appliedSQL;
  $<HTMLInputElement>("filter-value").value = "";
  setView("explore");
}
function render(r: Result) {
  rawText($("empty-result"), "");
  $("empty-result").innerHTML =
    "No matching rows.<small>Try another filter or query.</small>";
  localizeStatic($("empty-result"));
  result = r;
  const head = $("grid").querySelector("thead")!;
  const body = $("grid").querySelector("tbody")!;
  head.replaceChildren();
  body.replaceChildren();
  const tr = document.createElement("tr");
  tr.append(el("th", "#", "row-number"));
  r.columns.forEach((c) => {
    const th = document.createElement("th");
    th.dataset.type = c.type;
    const b = el(
      "button",
      c.name + (request.sort === c.name ? (request.desc ? " ↓" : " ↑") : ""),
    );
    setAttribute(b, "title", "Sort by {name}", { name: c.name });
    b.onclick = () =>
      void task("Sorting…", async () => {
        const next = {
          ...request,
          offset: 0,
          sort: c.name,
          desc: request.sort === c.name ? !request.desc : false,
        };
        await run(next);
      });
    th.append(b, el("small", c.type));
    tr.append(th);
  });
  head.append(tr);
  r.rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    tr.append(el("td", fmt(String(r.offset + i + 1)), "row-number"));
    row.forEach((v, j) => {
      const td = el(
        "td",
        v === null ? "NULL" : v === "" ? "empty" : v,
        v === null
          ? "null"
          : v === ""
            ? "empty-string"
            : /INT|DECIMAL|FLOAT|DOUBLE/.test(r.columns[j].type)
              ? "numeric"
              : "",
      );
      if (v === "") setText(td, "empty");
      td.dataset.type = r.columns[j].type;
      tr.append(td);
    });
    body.append(tr);
  });
  $("empty-result").hidden = r.rows.length !== 0;
  setText($("page-label"), "Page {page}", {
    page: Math.floor(r.offset / request.limit) + 1,
  });
  setText(
    $("result-summary"),
    r.rows.length
      ? r.more
        ? "{start}–{end} / more rows available / {ms} ms"
        : "{start}–{end} / end of results / {ms} ms"
      : "0 rows / {ms} ms",
    {
      start: fmt(String(r.offset + 1)),
      end: fmt(String(r.offset + r.rows.length)),
      ms: r.elapsedMS,
    },
  );
  setText(
    $("query-badge"),
    request.sql === "SELECT * FROM data" ? "data" : "SQL result",
  );
  const select = $<HTMLSelectElement>("filter-column");
  select.replaceChildren(
    Object.assign(ui("option", "Choose a column"), { value: "" }),
  );
  r.columns.forEach((c) => select.add(new Option(c.name, c.name)));
  select.value = request.filterColumn;
  $("grid-scroll").scrollTop = 0;
}
async function queryResult(next: Request) {
  const r = await Workbench.query(next);
  if (!r) throw new Error("No query result returned");
  return r;
}
async function run(next: Request) {
  const r =
    !file && folder
      ? await Workbench.queryWorkspace(folder.root, next)
      : await queryResult(next);
  if (!r) throw new Error("No query result returned");
  request = next;
  render(r);
}
async function open(path?: string) {
  await task("Opening Parquet…", async () => {
    await saveQuery();
    const f = path ? await Workbench.openPath(path) : await Workbench.open();
    if (f) {
      const info = owner(f.path);
      if (info)
        await openFolderFile(info, workspaceRelative(info.root, f.path));
      else await activate(f);
    }
  });
}
$("open").onclick = () => {
  closeSources();
  void open();
};
$("cancel").onclick = () => void Workbench.cancel();
for (const name of ["explore", "schema"])
  $(`tab-${name}`).onclick = () => setView(name);
$("run").onclick = () =>
  void task("Running query…", async () => {
    const sql = $<HTMLTextAreaElement>("sql").value;
    await run({
      ...request,
      sql,
      offset: 0,
      sort: "",
      desc: false,
      filterColumn: "",
      filterValue: "",
    });
    appliedSQL = sql;
    await saveQuery();
    $<HTMLInputElement>("filter-value").value = "";
  });
$("reset-sql").onclick = () => {
  $<HTMLTextAreaElement>("sql").value = file ? "SELECT * FROM data" : "";
  queryEdited();
};
$("filter-form").onsubmit = (e) => {
  e.preventDefault();
  void task("Filtering…", async () => {
    await run({
      ...request,
      offset: 0,
      filterColumn: $<HTMLSelectElement>("filter-column").value,
      filterValue: $<HTMLInputElement>("filter-value").value,
    });
  });
};
$("clear-filter").onclick = () =>
  void task("Clearing filter…", async () => {
    await run({ ...request, offset: 0, filterColumn: "", filterValue: "" });
    $<HTMLInputElement>("filter-value").value = "";
  });
$("previous").onclick = () =>
  void task("Reading page…", () =>
    run({ ...request, offset: Math.max(0, request.offset - request.limit) }),
  );
$("next").onclick = () =>
  void task("Reading page…", () =>
    run({ ...request, offset: request.offset + request.limit }),
  );
$("page-size").onchange = () =>
  void task("Reading page…", () =>
    run({
      ...request,
      offset: 0,
      limit: Number($<HTMLSelectElement>("page-size").value),
    }),
  );
const exportDialog = $<HTMLDialogElement>("export-dialog");
$("export").onclick = () => {
  if (busy || !result) return;
  exportDialog.showModal();
  $("export-title").focus();
};
$("export-dismiss").onclick = () => exportDialog.close();
exportDialog.onclose = () => $("export").focus();
for (const format of ["json", "csv"])
  $("export-" + format).onclick = () => {
    exportDialog.close();
    void task("Choose where to export…", async () => {
      const path = await Workbench.exportPageAs(format);
      if (path) notify("Exported visible page to {path}", false, { path });
    });
  };
document.addEventListener("keydown", (e) => {
  if (
    (r2Dialog.open ||
      settingsDialog.open ||
      connectionPicker.open ||
      exportDialog.open) &&
    (e.metaKey || e.ctrlKey) &&
    ["o", "enter"].includes(e.key.toLowerCase())
  ) {
    e.preventDefault();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
    e.preventDefault();
    closeSources();
    void open();
  }
  if (
    !sourceDialog.open &&
    (e.metaKey || e.ctrlKey) &&
    e.key === "Enter" &&
    (file || folder)
  ) {
    e.preventDefault();
    $("run").click();
  }
});
// Observe DOM drag events without canceling them: MyGo's native bridge
// needs the unhandled drop to deliver the real filesystem path.
const dropFeedback = document.createElement("div");
dropFeedback.id = "drop-feedback";
dropFeedback.hidden = true;
dropFeedback.setAttribute("popover", "manual");
dropFeedback.setAttribute("role", "status");
dropFeedback.innerHTML =
  '<div class="drop-feedback-card"><strong>Drop to open Parquet</strong><span>Release the file anywhere in this window.</span></div>';
localizeStatic(dropFeedback);
app.append(dropFeedback);
const welcomeDropZone = $("welcome-drop-zone");
const isWelcome = () => !$("welcome").hidden;
function insideWelcomeDrop(x: number, y: number) {
  const rect = welcomeDropZone.getBoundingClientRect();
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    rect.width > 0 &&
    rect.height > 0 &&
    x >= rect.left &&
    x < rect.right &&
    y >= rect.top &&
    y < rect.bottom
  );
}
function markWelcomeDrop(active: boolean) {
  welcomeDropZone.classList.toggle("drag-active", active);
  setText(
    $("welcome-drop-title"),
    active ? "Release to open Parquet" : "Drop a Parquet file here",
  );
}
let dragDepth = 0;
const acceptsDrop = () =>
  !busy &&
  !r2Dialog.open &&
  !settingsDialog.open &&
  !connectionPicker.open &&
  !exportDialog.open;
const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes("Files");
function clearDropFeedback() {
  dragDepth = 0;
  markWelcomeDrop(false);
  dropFeedback.hidePopover?.();
  dropFeedback.hidden = true;
}
function showDropFeedback() {
  if (!dropFeedback.hidden) return;
  dropFeedback.hidden = false;
  dropFeedback.showPopover?.();
}
function updateDropFeedback(event: DragEvent) {
  if (!hasFiles(event) || !acceptsDrop()) {
    clearDropFeedback();
    return;
  }
  if (isWelcome()) {
    markWelcomeDrop(
      !sourceDialog.open && insideWelcomeDrop(event.clientX, event.clientY),
    );
  } else showDropFeedback();
}
app.addEventListener("dragenter", (event) => {
  if (!hasFiles(event) || !acceptsDrop()) return;
  dragDepth++;
  updateDropFeedback(event);
});
app.addEventListener("dragover", updateDropFeedback);
welcomeDropZone.addEventListener("dragleave", (event) => {
  if (
    !(event.relatedTarget instanceof Node) ||
    !welcomeDropZone.contains(event.relatedTarget)
  )
    markWelcomeDrop(false);
});
app.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) clearDropFeedback();
});
document.addEventListener("drop", clearDropFeedback);
document.addEventListener("dragend", clearDropFeedback);
document.addEventListener("visibilitychange", clearDropFeedback);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") clearDropFeedback();
});
onFileDrop(({ paths, x, y }) => {
  // Native coordinates remain authoritative even after the DOM drop clears feedback.
  const accepted =
    acceptsDrop() &&
    (!isWelcome() || (!sourceDialog.open && insideWelcomeDrop(x, y)));
  clearDropFeedback();
  if (paths[0] && accepted) {
    closeSources();
    void open(paths[0]);
  }
});
async function boot() {
  try {
    const [saved, limits, disk] = await Promise.all([
      Workbench.resources(),
      Workbench.resourceLimits(),
      Workbench.diskLimits(),
    ]);
    if (saved && limits) {
      resources = saved;
      memoryLimits = limits;
      diskLimits = disk;
      markResources();
      resourcesReady = true;
    }
  } catch (error) {
    notify(String(error), true);
  }

  try {
    const savedLanguage = await Workbench.language();
    setLanguage(savedLanguage === "zh-CN" ? "zh-CN" : "en");
    $<HTMLSelectElement>("interface-language").value = getLanguage();
  } catch (error) {
    notify(String(error), true);
  }
  try {
    const saved = await Workbench.appearance();
    if (saved === "light" || saved === "dark" || saved === "system") {
      appearance = saved;
      markAppearance(saved);
    }
    const restored = await Workbench.restoreWorkspaces();
    if (restored)
      await task("Restoring workspaces…", async () => {
        restoringSession = true;
        const warnings: string[] = [];
        try {
          for (const info of restored.workspaces) {
            try {
              await showFolder(info, true);
            } catch (e) {
              warnings.push(String(e));
            }
          }
          const paths =
            restored.session?.files ??
            restored.workspaces
              .filter((info) => info.active && info.active !== ".")
              .map((info) => workspacePath(info.root, info.active));
          for (const path of paths) {
            // Closed cloud connections remain authoritative even if their session
            // cleanup was interrupted. Inactive documents require no network read.
            if (isCloudRoot(path) && !owner(path)) continue;
            documents.set(path, {
              file: {
                path,
                name: path.split(/[\\/]/).at(-1)!,
                bytes: "",
                rows: "",
                rowGroups: "",
                columns: [],
              },
              draft: "SELECT * FROM data",
              applied: "SELECT * FROM data",
              request: { ...request, sql: "SELECT * FROM data", offset: 0 },
              view: "explore",
              pendingRestore: true,
            });
          }
          updateFolder();
          const last = restored.workspaces.at(-1);
          const active =
            restored.session?.active ||
            (last?.active && last.active !== "."
              ? workspacePath(last.root, last.active)
              : last?.root);
          try {
            if (active && documents.has(active)) await switchFile(active);
            else if (active && folders.has(active))
              await showWorkspace(folders.get(active)!);
          } catch (e) {
            warnings.push(
              t("Last file is unavailable. Choose another file. {error}", {
                error: String(e),
              }),
            );
          }
          if (restored.warning) warnings.push(restored.warning);
          if (warnings.length) notify(warnings.join("\n"), true);
        } finally {
          restoringSession = false;
        }
      });
    const path = await Workbench.initialFile();
    if (path) await open(path);
  } catch (e) {
    notify(String(e), true);
  }
  controls();
  document.body.dataset.ready = "true";
}
void boot();
// Reading status does not request a feed or start an install. Sparkle owns its
// network schedule; refresh the in-app reminder when returning to the window.
void refreshUpdateReminder();
window.setInterval(() => void refreshUpdateReminder(), 60_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshUpdateReminder();
});
