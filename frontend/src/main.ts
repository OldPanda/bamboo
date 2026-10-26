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
  <section id="open-files-panel" hidden><div class="section-label">Open files</div><div id="open-files"></div></section>
  <section id="folder-panel" hidden><div class="section-label">Workspaces</div><div id="workspace-roots"></div></section>
  <div id="file-card" hidden></div>
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
const folders = new Map<string, Info>();
type DocumentState = { file: DataFile; draft: string; applied: string; request: Request; view: string };
const documents = new Map<string, DocumentState>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave = Promise.resolve();
const prefix = (root: string) => root.endsWith("/") ? root : root + "/";
function owner(path: string) {
  return [...folders.values()].filter(f => path.startsWith(prefix(f.root))).sort((a,b) => b.root.length-a.root.length)[0] || null;
}
function rememberCurrent() {
  if (file) documents.set(file.path, { file, draft: $<HTMLTextAreaElement>("sql").value, applied: appliedSQL, request:{...request}, view });
}
function updateFolder() {
  folder = file ? owner(file.path) : null;
  relativeFile = folder && file ? file.path.slice(prefix(folder.root).length) : "";
  document.body.classList.toggle("folder-mode", folders.size > 0);
  document.body.classList.toggle("files-mode", documents.size > 0);
  $("folder-panel").hidden = folders.size === 0;
  $("scope-name").textContent = folder ? folder.name : "File";
  $("scope-name").title = folder ? folder.root : "Single file";
  $("query-save").hidden = !file;
  if (file) $("breadcrumb").textContent = folder ? relativeFile : file.name;
  document.querySelectorAll<HTMLButtonElement>(".tree-file").forEach(b => {
    const path = b.dataset.fullPath!, row = b.parentElement!;
    const doc = documents.get(path), active = file?.path === path;
    b.classList.toggle("selected", active); b.setAttribute("aria-current", String(active));
    row.classList.toggle("opened-file", !!doc); row.classList.toggle("selected", active);
    row.querySelector(".close-file")?.remove();
    if (doc) row.append(closeFileButton(path, doc.file.name));
  });
  const list = $("open-files"); list.replaceChildren();
  const external = [...documents.values()].filter(doc => !owner(doc.file.path));
  $("open-files-panel").hidden = external.length === 0;
  if (external.length) {
    const group = el("div", "", "opened-group external-files");
    group.append(el("div", "Other files", "opened-group-name"));
    for (const doc of external) {
      const row = el("div", "", "opened-file"); row.dataset.path = doc.file.path;
      const button = el("button", doc.file.name, "activate-file") as HTMLButtonElement;
      button.title = doc.file.path; button.setAttribute("aria-current", String(file?.path === doc.file.path));
      row.classList.toggle("selected", file?.path === doc.file.path);
      button.onclick = () => void task("Switching file…", async () => { await saveQuery(); await switchFile(doc.file.path); });
      row.append(button, closeFileButton(doc.file.path, doc.file.name)); group.append(row);
    }
    list.append(group);
  }
}
function closeFileButton(path: string, name: string) {
  const close = el("button", "×", "close-file") as HTMLButtonElement;
  close.title = `Close ${name}`; close.setAttribute("aria-label", `Close ${name}`);
  close.onclick = () => void task("Closing file…", () => closeDocument(path));
  return close;
}

function saveQuery() {
  clearTimeout(saveTimer); saveTimer = undefined;
  rememberCurrent();
  if (!folder || !relativeFile) {
    if (file) $("query-save").textContent = "Kept for this session";
    return pendingSave;
  }
  const root=folder.root, path=relativeFile, draft=$<HTMLTextAreaElement>("sql").value, applied=appliedSQL;
  $("query-save").textContent = "Saving…";
  pendingSave = pendingSave.catch(() => {}).then(() => Workbench.saveWorkspaceQuery(root,path,draft,applied));
  void pendingSave.then(() => { $("query-save").textContent = "Saved locally"; }, e => {
    $("query-save").textContent = "Not saved"; notify(`Could not save query: ${String(e)}`, true);
  });
  return pendingSave;
}
function queryEdited() {
  rememberCurrent();
  if (!folder || !relativeFile) { if (file) $("query-save").textContent="Kept for this session"; return; }
  $("query-save").textContent="Unsaved changes"; clearTimeout(saveTimer);
  saveTimer=setTimeout(() => {void saveQuery();},350);
}
async function directory(container: HTMLElement, info: Info, rel: string, offset=0) {
  const page=await Workbench.listDirectory(info.root,rel,offset);
  if (!page) throw new Error("No directory listing returned");
  if (offset===0) container.replaceChildren();
  container.querySelector(":scope > .tree-more")?.remove();
  for (const entry of page.entries) {
    const row=el("div","",entry.directory ? "tree-entry" : "tree-entry tree-file-row");
    row.dataset.path=prefix(info.root)+entry.path;
    const button=el("button",`${entry.directory ? "▸" : "▧"} ${entry.name}`,entry.directory ? "tree-folder" : "tree-file activate-file") as HTMLButtonElement;
    button.title=entry.path; button.dataset.path=entry.path; button.dataset.root=info.root; button.dataset.fullPath=prefix(info.root)+entry.path;
    row.append(button);container.append(row);
    if (entry.directory) {
      const children=el("div","","tree-children");children.hidden=true;row.append(children);button.setAttribute("aria-expanded","false");
      button.onclick=()=>void task("Reading folder…",async()=>{
        if(children.hidden){await directory(children,info,entry.path);children.hidden=false;button.textContent=`▾ ${entry.name}`;button.setAttribute("aria-expanded","true");}
        else{children.hidden=true;button.textContent=`▸ ${entry.name}`;button.setAttribute("aria-expanded","false");}
      });
    } else button.onclick=()=>void task("Opening file…",async()=>{await saveQuery();await openFolderFile(info,entry.path);});
  }
  if(page.more){const more=el("button","Load more entries","tree-more");more.onclick=()=>void task("Reading folder…",()=>directory(container,info,rel,page.next));container.append(more);}
  else if(!container.children.length)container.append(el("p","No visible folders or Parquet files","aside-hint"));
  updateFolder();
}
async function activate(f: DataFile, saved?: {draft:string;applied:string}) {
  const cached=documents.get(f.path);
  const draft=cached ? cached.draft : saved ? saved.draft : "SELECT * FROM data";
  let applied=cached ? cached.applied : saved?.applied || "SELECT * FROM data";
  const initial:Request={sql:"SELECT * FROM data",offset:0,limit:Number($<HTMLSelectElement>("page-size").value),sort:"",desc:false,filterColumn:"",filterValue:""};
  let next=cached ? {...cached.request} : {...initial,sql:applied};
  let loaded:Result, warning="";
  try{loaded=await queryResult(next);}catch(e){
    next=initial;applied=initial.sql;
    warning=`Saved query could not run; showing the file preview. Draft preserved. ${String(e)}`;
    try{loaded=await queryResult(next);}catch(error){
      // The backend already opened this file. Never leave another file's rows
      // visible as if they belonged to the new engine after a failed preview.
      showFile(f);$<HTMLTextAreaElement>("sql").value=draft;
      rememberCurrent();updateFolder();throw error;
    }
  }
  // Commit metadata, editor, view and result together, without an IPC await
  // between clearing the previous table and painting its replacement.
  showFile(f);
  $<HTMLTextAreaElement>("sql").value=draft;
  appliedSQL=applied;request=next;
  $<HTMLSelectElement>("page-size").value=String(next.limit);
  $<HTMLInputElement>("filter-value").value=next.filterValue;
  render(loaded);setView(cached ? cached.view : "explore");rememberCurrent();updateFolder();
  $("query-save").textContent=folder ? "Saved locally" : "Kept for this session";
  if(warning)notify(warning,true);
}

async function openFolderFile(info: Info,path:string){
  const opened=await Workbench.openWorkspaceFile(info.root,path);
  if(!opened?.file)throw new Error("No file returned");
  await activate(opened.file,opened.query);
  if(opened.warning)notify(opened.warning,true);
}
async function switchFile(path:string){
  const info=owner(path);
  if(info)await openFolderFile(info,path.slice(prefix(info.root).length));
  else {const f=await Workbench.openPath(path);if(!f)throw new Error("No file returned");await activate(f);}
}
function showWelcome(){
  file=null;result=null;folder=null;relativeFile="";
  $("workspace").hidden=true;$("welcome").hidden=false;$("breadcrumb").textContent="Welcome";
  $("column-list").replaceChildren();$("column-count").textContent="—";
  updateFolder();
}
async function previewAfterClose(next?: string) {
  if(next){try{await switchFile(next);}catch(e){await Workbench.clearPreview();showWelcome();notify(`File closed. Choose another file to continue. ${String(e)}`,true);}}
  else{await Workbench.clearPreview();showWelcome();}
}
async function closeDocument(path:string){
  await saveQuery();
  const info=owner(path);
  if(info)await Workbench.closeWorkspaceFile(info.root,path.slice(prefix(info.root).length));
  const paths=[...documents.keys()],index=paths.indexOf(path),wasActive=file?.path===path;
  documents.delete(path);
  if(wasActive){
    await previewAfterClose(paths[index+1] || paths[index-1]);
  }
  updateFolder();
}
async function showFolder(info:Info,restore=false){
  if(folders.has(info.root))return;
  folders.set(info.root,info);
  const panel=el("section","","workspace-group");panel.dataset.root=info.root;
  panel.innerHTML=`<div class="folder-heading"><strong data-control="folder-name"></strong><button data-control="folder-rename" class="quiet" title="Rename workspace" aria-label="Rename workspace">✎</button><button data-control="folder-close" class="quiet" title="Close workspace" aria-label="Close workspace">×</button></div><p class="folder-path"></p><form data-control="folder-rename-form" hidden><input data-control="folder-name-input" aria-label="Workspace name" maxlength="200" required><button type="submit">Save</button><button data-control="folder-rename-cancel" type="button">Cancel</button></form><div class="folder-actions"><button data-control="folder-refresh" class="quiet">Refresh</button></div><div class="folder-tree" aria-label="Workspace files"></div>`;
  const control=<T extends HTMLElement=HTMLElement>(name:string)=>panel.querySelector<T>(`[data-control="${name}"]`)!;
  const heading=()=>{control("folder-name").textContent=info.name;control<HTMLInputElement>("folder-name-input").value=info.name;};heading();
  const path=panel.querySelector<HTMLElement>(".folder-path")!;path.textContent=info.root;path.title=info.root;
  const tree=panel.querySelector<HTMLElement>(".folder-tree")!;
  control("folder-refresh").onclick=()=>void task("Refreshing folder…",()=>directory(tree,info,"."));
  control("folder-rename").onclick=()=>{control("folder-rename-form").hidden=false;control("folder-name-input").focus();};
  control("folder-rename-cancel").onclick=()=>{control("folder-rename-form").hidden=true;heading();};
  control("folder-rename-form").onsubmit=e=>{e.preventDefault();void task("Renaming workspace…",async()=>{
    const renamed=await Workbench.renameWorkspace(info.root,control<HTMLInputElement>("folder-name-input").value);
    if(!renamed)throw new Error("No workspace returned");
    info.name=renamed.name;heading();control("folder-rename-form").hidden=true;updateFolder();
  });};
  control("folder-close").onclick=()=>void task("Closing workspace…",async()=>{
    await saveQuery();
    const closing=[...documents.keys()].filter(path=>owner(path)?.root===info.root);
    const closesActive=!!file && closing.includes(file.path);
    await Workbench.closeWorkspace(info.root);
    for(const path of closing)documents.delete(path);
    folders.delete(info.root);panel.remove();
    if(closesActive)await previewAfterClose(documents.keys().next().value);
    updateFolder();
    if(file)$("query-save").textContent=folder ? "Saved locally" : "Kept for this session";
  });
  $("workspace-roots").append(panel);updateFolder();
  await directory(tree,info,".");
  if(restore && info.active){try{await openFolderFile(info,info.active);}catch(e){notify(`Last file is unavailable. Choose another file. ${String(e)}`,true);}}
}
async function openFolder(){await task("Opening workspace…",async()=>{await saveQuery();const info=await Workbench.openWorkspace();if(info)await showFolder(info);});}
$("open-folder").onclick=()=>void openFolder();$("welcome-folder").onclick=()=>void openFolder();
$("sql").oninput=queryEdited;$("sql").onblur=()=>{if(saveTimer)void saveQuery();};

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
  document.body.classList.add("is-busy");
  $("workspace").setAttribute("aria-busy", "true");
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
    document.body.classList.remove("is-busy");
    $("workspace").setAttribute("aria-busy", "false");
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
async function queryResult(next: Request) {
  const r = await Workbench.query(next);
  if (!r) throw new Error("No query result returned");
  return r;
}
async function run(next: Request) {
  const r = await queryResult(next);
  request = next;
  render(r);
}
async function open(path?: string) {
  await task("Opening Parquet…", async () => {
    await saveQuery();
    const f = path ? await Workbench.openPath(path) : await Workbench.open();
    if (f) {
      const info=owner(f.path);
      if(info)await openFolderFile(info,f.path.slice(prefix(info.root).length));
      else await activate(f);
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
    else {
      const restored=await Workbench.restoreWorkspaces();
      if(restored)await task("Restoring workspaces…",async()=>{
        for(const info of restored.workspaces)await showFolder(info,true);
        if(restored.warning)notify(restored.warning,true);
      });
    }
  } catch (e) {
    notify(String(e), true);
  }
  controls();
  document.body.dataset.ready = "true";
}
void boot();
