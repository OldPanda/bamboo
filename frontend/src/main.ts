import {
  Workbench,
  type File as DataFile,
  type Result,
  type Request,
  type Info,
} from "./mygo";
import { onFileDrop } from "mygo-runtime";
import "./style.css";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const app = $("app");
app.innerHTML = `
<aside class="sidebar">
  <div class="brand"><span class="brand-mark">竹</span><div>Bamboo<span class="edition">Local data workbench</span></div></div>
  <button id="open-folder" class="open-button" title="Open workspace folder" aria-label="Open workspace folder"><span>▱</span> Open Folder</button>
  <button id="open" class="open-button" aria-label="Open Parquet file" title="Open Parquet file (⌘O)"><span>＋</span> Open Parquet <kbd>⌘ O</kbd></button>
  <section id="folder-panel" hidden>
    <div class="folder-heading"><strong id="folder-name"></strong><button id="folder-rename" class="quiet" title="Rename workspace" aria-label="Rename workspace">✎</button></div>
    <p id="folder-path"></p>
    <form id="folder-rename-form" hidden><input id="folder-name-input" aria-label="Workspace name" maxlength="200" required><button type="submit">Save</button><button id="folder-rename-cancel" type="button">Cancel</button></form>
    <div class="folder-actions"><button id="folder-refresh" class="quiet">Refresh</button><button id="folder-close" class="quiet">Close workspace</button></div>
    <div id="folder-tree" aria-label="Workspace files"></div>
  </section>
  <div class="section-label">Active file</div>
  <div id="file-card" class="file-card muted">No file open</div>
  <div class="section-label columns-label">Columns <span id="column-count">—</span></div>
  <div id="column-list" class="column-list"><p class="aside-hint">Your file’s structure,<br>at a glance.</p></div>
  <div class="privacy"><div>Only on your machine<small>No accounts. No uploads.</small></div></div>
</aside>
<main>
  <header><div class="breadcrumb"><span id="scope-name">File</span> <span>/</span> <strong id="breadcrumb">Welcome</strong></div><div class="header-actions"><span class="local-badge">Local session</span><button id="export" title="Export the visible result page as JSON">Export page</button></div></header>
  <section id="welcome" class="welcome">
    <div class="welcome-mark" aria-hidden="true">竹</div>
    <h1 id="welcome-title">Explore your local data</h1>
    <p id="welcome-description">Open a folder as a workspace, or explore a single Parquet file.</p>
    <div class="welcome-actions"><button id="welcome-folder" class="primary">Open a folder</button><button id="welcome-open">Open a Parquet file</button></div>
    <span class="drop-note">or drop a .parquet file anywhere</span>
    <div class="welcome-features"><div><strong>Browse rows</strong><span>Small pages, precise values.</span></div><div><strong>Query with SQL</strong><span>Filter, sort, and query.</span></div><div><strong>Keep it local</strong><span>Your files stay yours.</span></div></div>
  </section>
  <section id="workspace" hidden>
    <div class="file-heading"><div class="file-identity"><h1 id="file-name"></h1><p id="file-path"></p></div><div class="metrics" aria-label="File metadata"><div><strong id="row-count">—</strong><span>rows</span></div><div><strong id="metric-columns">—</strong><span>columns</span></div><div><strong id="file-size">—</strong><span>file size</span></div><div><strong id="row-groups">—</strong><span>row groups</span></div></div></div>
    <nav class="tabs" aria-label="Views"><button id="tab-explore" class="active" aria-selected="true">Explore Data</button><button id="tab-schema" aria-selected="false">Schema</button><span id="query-badge">data</span></nav>
    <div id="sql-panel" class="sql-panel"><div class="editor-header"><label for="sql">Query editor <span>Read-only / table: data</span></label><button id="reset-sql" class="quiet">Reset</button></div><textarea id="sql" spellcheck="false" aria-label="SQL query">SELECT * FROM data</textarea><div class="editor-footer"><span>⌘ Enter to run / 15 second timeout <small id="query-save" hidden></small></span><button id="run" class="primary">Run query</button></div></div>
    <div id="data-panel" class="data-panel">
      <form id="filter-form" class="toolbar"><label class="filter-field">Column<select id="filter-column" aria-label="Filter column"><option value="">Choose a column</option></select></label><label class="filter-field">Contains<input id="filter-value" aria-label="Filter value" placeholder="Text to match"></label><button id="apply-filter" type="submit">Apply filter</button><button id="clear-filter" type="button" class="quiet">Clear</button><span class="toolbar-spacer"></span><label>Rows <select id="page-size" aria-label="Rows per page"><option>50</option><option selected>100</option><option>250</option><option>500</option></select></label></form>
      <div id="grid-scroll" class="grid-scroll" tabindex="0" aria-label="Query results"><table id="grid"><thead></thead><tbody></tbody></table><div id="empty-result" class="empty-result" hidden>No matching rows.<small>Try another filter or query.</small></div></div>
      <footer class="table-footer"><span id="result-summary">Ready</span><div class="pagination"><button id="previous" aria-label="Previous page">←</button><span id="page-label">Page 1</span><button id="next" aria-label="Next page">→</button></div></footer>
    </div>
    <div id="schema-panel" class="schema-panel" hidden><div class="schema-note">Types are read directly from the Parquet file. Values stay exact across the desktop bridge.</div><table><thead><tr><th>#</th><th>Column</th><th>Logical type</th></tr></thead><tbody id="schema-body"></tbody></table></div>
  </section>
  <div id="notification" role="status" aria-live="polite" hidden></div>
  <div id="busy" class="busy" hidden><span class="spinner"></span><span id="busy-text">Reading your file…</span><button id="cancel">Cancel</button></div>
</main>`;
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
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave = Promise.resolve();
function updateFolder() {
  document.body.classList.toggle("folder-mode", !!folder);
  $("folder-panel").hidden = !folder;
  $("scope-name").textContent = folder ? folder.name : "File";
  $("scope-name").title = folder ? folder.root : "Single file";
  $("query-save").hidden = !folder;
  if (folder) {
    $("folder-name").textContent = folder.name;
    $("folder-path").textContent = folder.root;
    $("folder-path").title = folder.root;
    $<HTMLInputElement>("folder-name-input").value = folder.name;
  }
  document.querySelectorAll<HTMLButtonElement>(".tree-file").forEach(b => {
    b.classList.toggle("selected", b.dataset.path === relativeFile);
    b.setAttribute("aria-current", String(b.dataset.path === relativeFile));
  });
}
function saveQuery() {
  clearTimeout(saveTimer);
  if (!folder || !relativeFile) return pendingSave;
  const root = folder.root, path = relativeFile, draft = $<HTMLTextAreaElement>("sql").value, applied = appliedSQL;
  $("query-save").textContent = "Saving…";
  pendingSave = pendingSave.catch(() => {}).then(() => Workbench.saveWorkspaceQuery(root, path, draft, applied));
  void pendingSave.then(() => { $("query-save").textContent = "Saved locally"; }, e => {
    $("query-save").textContent = "Not saved";
    notify(`Could not save query: ${String(e)}`, true);
  });
  return pendingSave;
}
function queryEdited() {
  if (!folder || !relativeFile) return;
  $("query-save").textContent = "Unsaved changes";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveQuery(); }, 350);
}
async function directory(container: HTMLElement, rel: string, offset = 0) {
  const page = await Workbench.listDirectory(folder!.root, rel, offset);
  if (!page) throw new Error("No directory listing returned");
  if (offset === 0) container.replaceChildren();
  container.querySelector(":scope > .tree-more")?.remove();
  for (const entry of page.entries) {
    const row = el("div", "", "tree-entry");
    const button = el("button", `${entry.directory ? "▸" : "▧"} ${entry.name}`, entry.directory ? "tree-folder" : "tree-file") as HTMLButtonElement;
    button.title = entry.path; button.dataset.path = entry.path;
    row.append(button); container.append(row);
    if (entry.directory) {
      const children = el("div", "", "tree-children"); children.hidden = true; row.append(children);
      button.setAttribute("aria-expanded", "false");
      button.onclick = () => void task("Reading folder…", async () => {
        if (children.hidden) {
          await directory(children, entry.path); children.hidden = false;
          button.textContent = `▾ ${entry.name}`; button.setAttribute("aria-expanded", "true");
        } else {
          children.hidden = true; button.textContent = `▸ ${entry.name}`; button.setAttribute("aria-expanded", "false");
        }
      });
    } else {
      button.onclick = () => void task("Opening file…", async () => { await saveQuery(); await openFolderFile(entry.path); });
    }
  }
  if (page.more) {
    const more = el("button", "Load more entries", "tree-more");
    more.onclick = () => void task("Reading folder…", () => directory(container, rel, page.next));
    container.append(more);
  } else if (!container.children.length) container.append(el("p", "No visible folders or Parquet files", "aside-hint"));
  updateFolder();
}
async function openFolderFile(path: string) {
  const opened = await Workbench.openWorkspaceFile(folder!.root, path);
  if (!opened) throw new Error("No file returned");
  relativeFile = path;
  showFile(opened.file!);
  $("breadcrumb").textContent = path;
  $<HTMLTextAreaElement>("sql").value = opened.query.draft;
  appliedSQL = opened.query.applied || "SELECT * FROM data";
  updateFolder();
  $("query-save").textContent = "Saved locally";
  try { await run({ ...request, sql: appliedSQL }); }
  catch (e) {
    appliedSQL = "SELECT * FROM data";
    await run({ ...request, sql: appliedSQL });
    notify(`Saved query could not run; showing the file preview. Draft preserved. ${String(e)}`, true);
  }
  if (opened.warning) notify(opened.warning, true);
}
async function showFolder(info: Info) {
  folder = info; relativeFile = ""; file = null; result = null;
  $("workspace").hidden = true; $("welcome").hidden = false;
  $("welcome-title").textContent = "Choose a file to explore";
  $("welcome-description").textContent = "Browse your workspace on the left. Open a Parquet file to query and preview its data.";
  $("breadcrumb").textContent = "Choose a file";
  $("folder-rename-form").hidden = true;
  $("file-card").textContent = "No file open"; $("column-list").replaceChildren(); $("column-count").textContent = "—";
  updateFolder();
  await directory($("folder-tree"), ".");
  if (info.active) {
    try { await openFolderFile(info.active); }
    catch (e) { notify(`Last file is unavailable. Choose another file. ${String(e)}`, true); }
  }
}
async function openFolder() {
  await task("Opening workspace…", async () => {
    await saveQuery();
    const info = await Workbench.openWorkspace();
    if (info) await showFolder(info);
  });
}
$("open-folder").onclick = () => void openFolder();
$("welcome-folder").onclick = () => void openFolder();
$("folder-refresh").onclick = () => void task("Refreshing folder…", () => directory($("folder-tree"), "."));
$("folder-rename").onclick = () => { $("folder-rename-form").hidden = false; $("folder-name-input").focus(); };
$("folder-rename-cancel").onclick = () => { $("folder-rename-form").hidden = true; updateFolder(); };
$("folder-rename-form").onsubmit = e => {
  e.preventDefault();
  void task("Renaming workspace…", async () => {
    const info = await Workbench.renameWorkspace(folder!.root, $<HTMLInputElement>("folder-name-input").value);
    if (!info) throw new Error("No workspace returned");
    folder = info; updateFolder(); $("folder-rename-form").hidden = true;
  });
};
$("folder-close").onclick = () => void task("Closing workspace…", async () => {
  await saveQuery(); await Workbench.leaveWorkspace(); folder = null; relativeFile = ""; updateFolder();
  $("breadcrumb").textContent = file ? file.name : "Welcome";
  $("welcome-title").textContent = "Explore your local data";
  $("welcome-description").textContent = "Open a folder as a workspace, or explore a single Parquet file.";
});
$("sql").oninput = queryEdited;
$("sql").onblur = () => { if (saveTimer) void saveQuery(); };

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
function notify(message: string, error = false) {
  const n = $("notification");
  n.textContent = message;
  n.classList.toggle("error", error);
  n.hidden = false;
}
function controls() {
  document
    .querySelectorAll<
      | HTMLButtonElement
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
    >("button,input,select,textarea")
    .forEach((n) => (n.disabled = busy && n.id !== "cancel"));
  $("previous").toggleAttribute(
    "disabled",
    busy || !result || request.offset === 0,
  );
  $("next").toggleAttribute("disabled", busy || !result?.more);
  $("export").toggleAttribute("disabled", busy || !result);
}
async function task(label: string, fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  $("busy").hidden = false;
  $("busy-text").textContent = label;
  $("notification").hidden = true;
  controls();
  try {
    await fn();
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e), true);
  } finally {
    busy = false;
    $("busy").hidden = true;
    controls();
  }
}
function setView(next: string) {
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
  file = f;
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
  $("breadcrumb").textContent = f.name;
  $("file-name").textContent = f.name;
  $("file-path").textContent = f.path;
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
    el("small", `${fmt(f.rows)} rows / ${size(f.bytes)}`),
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
    b.title = `Sort by ${c.name}`;
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
      td.dataset.type = r.columns[j].type;
      tr.append(td);
    });
    body.append(tr);
  });
  $("empty-result").hidden = r.rows.length !== 0;
  $("page-label").textContent =
    `Page ${Math.floor(r.offset / request.limit) + 1}`;
  $("result-summary").textContent = r.rows.length
    ? `${fmt(String(r.offset + 1))}–${fmt(String(r.offset + r.rows.length))} ${r.more ? "/ more rows available" : "/ end of results"} / ${r.elapsedMS} ms`
    : `0 rows / ${r.elapsedMS} ms`;
  $("query-badge").textContent =
    request.sql === "SELECT * FROM data" ? "data" : "SQL result";
  const select = $<HTMLSelectElement>("filter-column");
  select.replaceChildren(new Option("Choose a column", ""));
  r.columns.forEach((c) => select.add(new Option(c.name, c.name)));
  select.value = request.filterColumn;
  $("grid-scroll").scrollTop = 0;
}
async function run(next: Request) {
  const r = await Workbench.query(next);
  if (!r) throw new Error("No query result returned");
  request = next;
  render(r);
}
async function open(path?: string) {
  await task("Opening Parquet…", async () => {
    await saveQuery();
    const f = path ? await Workbench.openPath(path) : await Workbench.open();
    if (f) {
      let warning = "";
      if (folder) {
        try { await Workbench.leaveWorkspace(); } catch (e) { warning = `File opened, but workspace state could not be saved: ${String(e)}`; }
        folder = null; relativeFile = ""; updateFolder();
      }
      showFile(f);
      await run(request);
      if (warning) notify(warning, true);
    }
  });
}
$("open").onclick = () => void open();
$("welcome-open").onclick = () => void open();
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
  $<HTMLTextAreaElement>("sql").value = "SELECT * FROM data";
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
$("export").onclick = () =>
  void task("Choose where to export…", async () => {
    const path = await Workbench.exportPage();
    if (path) notify(`Exported visible page to ${path}`);
  });
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
    e.preventDefault();
    void open();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file) {
    e.preventDefault();
    $("run").click();
  }
});
onFileDrop(({ paths }) => {
  if (paths[0]) void open(paths[0]);
});
async function boot() {
  try {
    const path = await Workbench.initialFile();
    if (path) await open(path);
    else { const info = await Workbench.restoreWorkspace(); if (info) await task("Restoring workspace…", () => showFolder(info)); }
  } catch (e) {
    notify(String(e), true);
  }
  controls();
  document.body.dataset.ready = "true";
}
void boot();
