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
const brandIcon = new URL("./assets/bamboo.png", import.meta.url).href;
app.innerHTML = `
<aside class="sidebar">
  <div class="brand"><img class="brand-mark" src="${brandIcon}" width="36" height="36" alt="" /><div>Bamboo</div></div>
  <button id="open-folder" class="open-button" title="Open workspace folder" aria-label="Open workspace folder"><svg class="button-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg> Open Folder</button>
  <button id="open" class="open-button" aria-label="Open Parquet file" title="Open Parquet file (⌘ + O)"><svg class="button-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg> Open Parquet <kbd>⌘ + O</kbd></button>
  <button id="open-r2" class="open-button" title="Connect a read-only R2 workspace"><svg class="button-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 20 10a4 4 0 0 1 0 8H7Z"/></svg> Connect R2</button>
  <section id="open-files-panel" hidden><div class="section-label">Open files</div><div id="open-files"></div></section>
  <section id="folder-panel" hidden><div class="section-label">Workspaces</div><div id="workspace-roots"></div></section>
  <div id="file-card" hidden></div>
  <div class="section-label columns-label">Columns <span id="column-count">—</span></div>
  <div id="column-list" class="column-list"><p class="aside-hint">Your file’s structure,<br>at a glance.</p></div>
  <div class="privacy"><div>Queries run on this Mac<small>Read-only. No uploads.</small></div></div>
</aside>
<main>
  <header><div class="breadcrumb"><span id="scope-name">File</span> <span>/</span> <strong id="breadcrumb">Welcome</strong></div><div class="header-actions"><span class="local-badge">Local session</span><button id="export" title="Export the visible result page as JSON">Export page</button></div></header>
  <section id="welcome" class="welcome">
    <img class="welcome-mark" src="${brandIcon}" width="72" height="72" alt="" />
    <h1 id="welcome-title">Explore your data</h1>
    <p id="welcome-description">Open a folder, connect an R2 bucket, or explore a Parquet file.</p>
    <div class="welcome-actions"><button id="welcome-folder" class="primary">Open a folder</button><button id="welcome-open">Open a Parquet file</button></div>
    <span class="drop-note">or drop a .parquet file anywhere</span>
    <div class="welcome-features"><div><strong>Browse rows</strong><span>Small pages, precise values.</span></div><div><strong>Query with SQL</strong><span>Filter, sort, and query.</span></div><div><strong>Keep it local</strong><span>Your files stay yours.</span></div></div>
  </section>
  <section id="workspace" hidden>
    <div class="file-heading"><div class="file-identity"><h1 id="file-name"></h1><p id="file-path"></p></div><div class="metrics" aria-label="File metadata"><div><strong id="row-count">—</strong><span>rows</span></div><div><strong id="metric-columns">—</strong><span>columns</span></div><div><strong id="file-size">—</strong><span>file size</span></div><div><strong id="row-groups">—</strong><span>row groups</span></div></div></div>
    <nav class="tabs" aria-label="Views"><button id="tab-explore" class="active" aria-selected="true">Explore Data</button><button id="tab-schema" aria-selected="false">Schema</button><span id="query-badge">data</span></nav>
    <div id="sql-panel" class="sql-panel"><div class="editor-header"><label for="sql">Query editor <span id="query-scope">Read-only / table: data</span></label><button id="reset-sql" class="quiet">Reset</button></div><details id="workspace-tables" class="workspace-tables" hidden><summary>Workspace tables</summary><p id="workspace-table-help">Use <code>data</code> for the current file, or insert a workspace table below to JOIN or UNION files. Expand folders in the sidebar to see more tables. Only this workspace is available.</p><div id="workspace-table-list"></div></details><textarea id="sql" spellcheck="false" aria-label="SQL query">SELECT * FROM data</textarea><div class="editor-footer"><span>⌘ + Enter to run / 15 second timeout <small id="query-save" hidden></small></span><button id="run" class="primary">Run query</button></div></div>
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
<dialog id="r2-dialog" class="connection-dialog" aria-labelledby="r2-title">
 <form id="r2-form" autocomplete="off">
 <div class="connection-heading"><div><h2 id="r2-title">Connect Cloudflare R2</h2><p>Browse and query Parquet files in a read-only workspace.</p></div><button id="r2-dismiss" type="button" class="quiet" aria-label="Close R2 connection">×</button></div>
 <label>Workspace name <span class="optional">optional</span><input id="r2-name" maxlength="200" placeholder="Research data"></label>
 <label>S3 endpoint<input id="r2-endpoint" type="url" required placeholder="https://ACCOUNT_ID.r2.cloudflarestorage.com" spellcheck="false"></label>
 <div class="connection-row"><label>Bucket<input id="r2-bucket" required maxlength="63" spellcheck="false" placeholder="analytics"></label><label>Folder prefix <span class="optional">optional</span><input id="r2-prefix" maxlength="1024" spellcheck="false" placeholder="orders/2026"></label></div>
 <label>Access Key ID<input id="r2-access" required maxlength="256" autocomplete="off" spellcheck="false"></label>
 <label>Secret Access Key<input id="r2-secret" type="password" required maxlength="512" autocomplete="new-password" spellcheck="false"></label>
 <p class="connection-note">Use R2 Object Read only credentials scoped to this bucket. Keys are stored in macOS Keychain. Files are read from R2 as needed; queries run on this Mac.</p>
 <p id="r2-error" role="alert" hidden></p>
 <div class="connection-actions"><button id="r2-cancel" type="button">Cancel</button><button id="r2-submit" type="submit" class="primary">Test &amp; connect</button></div>
 </form>
</dialog>`;
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
const workspaceQueries = new Map<string, {draft:string;applied:string;request:Request}>();
const folders = new Map<string, Info>();
type DocumentState = { file: DataFile; draft: string; applied: string; request: Request; view: string };
const documents = new Map<string, DocumentState>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave = Promise.resolve();
const displayRoot = (info: Info) => info.location || info.root;
const prefix = (root: string) => root.endsWith("/") ? root : root + "/";
function owner(path: string) {
  return [...folders.values()].filter(f => path.startsWith(prefix(f.root))).sort((a,b) => b.root.length-a.root.length)[0] || null;
}
function rememberCurrent() {
  if (!file && folder) workspaceQueries.set(folder.root, {draft:$<HTMLTextAreaElement>("sql").value,applied:appliedSQL,request:{...request}});
  if (file) documents.set(file.path, { file, draft: $<HTMLTextAreaElement>("sql").value, applied: appliedSQL, request:{...request}, view });
}
function updateFolder() {
  folder = file ? owner(file.path) : folders.get(workspaceRoot) || null;
  relativeFile = folder && file ? file.path.slice(prefix(folder.root).length) : folder ? "." : "";
  document.body.classList.toggle("folder-mode", folders.size > 0);
  document.body.classList.toggle("files-mode", documents.size > 0);
  $("folder-panel").hidden = folders.size === 0;
  $("scope-name").textContent = folder ? folder.name : "File";
  $("scope-name").title = folder ? displayRoot(folder) : "Single file";
  $("query-save").hidden = !file && !folder;
  document.body.classList.toggle("workspace-query-mode", !file && !!folder);
  document.querySelector(".local-badge")!.textContent = folder?.root.startsWith("r2://") ? "R2 / read-only" : "Local session";
  $("query-scope").textContent = file ? "Read-only / table: data" : "Read-only / workspace";
  if (!file && folder) { $("breadcrumb").textContent="Explore Data"; $("file-name").textContent=folder.name; $("file-path").textContent=displayRoot(folder); $("file-path").title=displayRoot(folder); }
  document.querySelectorAll<HTMLElement>(".workspace-group").forEach(p=>p.querySelector('[data-control="folder-name"]')!.setAttribute("aria-current",String(!file && p.dataset.root===workspaceRoot)));
  if (file) { $("breadcrumb").textContent = folder ? relativeFile : file.name; if(folder?.location){$("file-path").textContent=displayRoot(folder)+"/"+relativeFile;$("file-path").title=$("file-path").textContent;} }
  document.querySelectorAll<HTMLButtonElement>(".tree-file").forEach(b => {
    const path = b.dataset.fullPath!, row = b.parentElement!;
    const doc = documents.get(path), active = file?.path === path;
    b.classList.toggle("selected", active); b.setAttribute("aria-current", String(active));
    row.classList.toggle("opened-file", !!doc); row.classList.toggle("selected", active);
    row.querySelector(".close-file")?.remove();
    if (doc) row.append(closeFileButton(path, doc.file.name));
  });
  updateQueryTables();
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
function tableReference(path: string) { return `workspace."${path.replaceAll('"', '""')}"`; }
function updateQueryTables() {
  $("workspace-tables").hidden = !folder;
  const list = $("workspace-table-list"); list.replaceChildren();
  if (!folder) return;
  $("workspace-table-help").textContent = file ? "Use data for the current file, or insert a workspace table below to JOIN or UNION files. Expand folders in the sidebar to see more tables." : "Insert a table name below, or type workspace.\"relative/path.parquet\". JOIN and UNION files without opening them. Expand folders in the sidebar to see more tables.";
  const paths = new Set(file ? [relativeFile] : []);
  document.querySelectorAll<HTMLButtonElement>(".tree-file").forEach(b => {
    if (b.dataset.root === folder!.root) paths.add(b.dataset.path!);
  });
  for (const path of paths) {
    const ref = tableReference(path);
    const button = el("button", ref, "table-reference") as HTMLButtonElement;
    button.title = `Insert ${ref} at cursor`;
    button.onclick = () => {
      const editor = $<HTMLTextAreaElement>("sql");
      editor.setRangeText(ref, editor.selectionStart, editor.selectionEnd, "end");
      editor.focus(); queryEdited();
    };
    list.append(button);
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
  controls();
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
    button.title=entry.directory ? entry.path : `${entry.path} — SQL: ${tableReference(entry.path)}`; button.dataset.path=entry.path; button.dataset.root=info.root; button.dataset.fullPath=prefix(info.root)+entry.path;
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
  file=null;result=null;folder=null;relativeFile="";workspaceRoot="";
  $("workspace").hidden=true;$("welcome").hidden=false;$("breadcrumb").textContent="Welcome";
  $("column-list").replaceChildren();$("column-count").textContent="—";
  updateFolder();
}
async function showWorkspace(info: Info) {
  const saved=await Workbench.openWorkspaceQuery(info.root);
  const cached=workspaceQueries.get(info.root);
  const draft=cached?.draft ?? saved.draft;
  const applied=cached?.applied ?? saved.applied;
  const next:Request=cached ? {...cached.request} : {sql:applied,offset:0,limit:100,sort:"",desc:false,filterColumn:"",filterValue:""};
  await Workbench.clearPreview();
  let loaded:Result|null=null, warning="";
  if(applied){try{loaded=await Workbench.queryWorkspace(info.root,next);}catch(e){warning=`Saved workspace query could not run. Draft preserved. ${String(e)}`;}}
  file=null;folder=info;workspaceRoot=info.root;relativeFile=".";result=null;
  appliedSQL=loaded ? applied : "";request=loaded ? next : {...next,sql:"",offset:0,filterColumn:"",filterValue:"",sort:""};
  $("welcome").hidden=true;$("workspace").hidden=false;
  $("grid").querySelector("thead")!.replaceChildren();$("grid").querySelector("tbody")!.replaceChildren();
  $("column-list").replaceChildren();$("column-count").textContent="—";
  $("schema-body").replaceChildren();
  $("empty-result").textContent="Write a query to preview workspace data.";$("empty-result").hidden=false;
  $("result-summary").textContent="Ready to query";$("page-label").textContent="Page 1";$("query-badge").textContent="Workspace query";
  $<HTMLSelectElement>("filter-column").replaceChildren(new Option("Choose a column",""));
  $<HTMLInputElement>("filter-value").value=request.filterValue;
  $<HTMLSelectElement>("page-size").value=String(request.limit);
  const editor=$<HTMLTextAreaElement>("sql");editor.value=draft;editor.placeholder='SELECT * FROM workspace."filename.parquet"';
  if(loaded){render(loaded);$("empty-result").textContent="No matching rows.";}
  setView("explore");updateFolder();rememberCurrent();$("query-save").textContent="Saved locally";
  if(warning)notify(warning,true);
}
async function previewAfterClose(next?: string) {
  if(next){try{await switchFile(next);}catch(e){await Workbench.clearPreview();showWelcome();notify(`File closed. Choose another file to continue. ${String(e)}`,true);}}
  else{const info=folders.get(workspaceRoot) || (folder && folders.get(folder.root)) || folders.values().next().value;if(info)await showWorkspace(info);else{await Workbench.clearPreview();showWelcome();}}
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
  if(folders.has(info.root)){if(!restore)await showWorkspace(info);return;}
  folders.set(info.root,info);
  const panel=el("section","","workspace-group");panel.dataset.root=info.root;
  panel.innerHTML=`<div class="folder-heading"><button class="workspace-name quiet" data-control="folder-name" title="Query this workspace"></button><button data-control="folder-rename" class="quiet" title="Rename workspace" aria-label="Rename workspace">✎</button><button data-control="folder-close" class="quiet" title="Close workspace" aria-label="Close workspace">×</button></div><p class="folder-path"></p><form data-control="folder-rename-form" hidden><input data-control="folder-name-input" aria-label="Workspace name" maxlength="200" required><button type="submit">Save</button><button data-control="folder-rename-cancel" type="button">Cancel</button></form><div class="folder-actions"><button data-control="folder-refresh" class="quiet">Refresh</button></div><div class="folder-tree" aria-label="Workspace files"></div>`;
  const control=<T extends HTMLElement=HTMLElement>(name:string)=>panel.querySelector<T>(`[data-control="${name}"]`)!;
  control("folder-name").onclick=()=>void task("Opening workspace query…",async()=>{await saveQuery();await showWorkspace(info);});
  const heading=()=>{control("folder-name").textContent=info.name;control<HTMLInputElement>("folder-name-input").value=info.name;};heading();
  const path=panel.querySelector<HTMLElement>(".folder-path")!;path.textContent=displayRoot(info);path.title=displayRoot(info);
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
    const closesActive=(!!file && closing.includes(file.path)) || (!file && workspaceRoot===info.root);
    await Workbench.closeWorkspace(info.root);
    for(const path of closing)documents.delete(path);
    folders.delete(info.root);workspaceQueries.delete(info.root);panel.remove();
    if(closesActive)await previewAfterClose(documents.keys().next().value);
    updateFolder();
    if(file)$("query-save").textContent=folder ? "Saved locally" : "Kept for this session";
  });
  $("workspace-roots").append(panel);updateFolder();
  try { await directory(tree,info,"."); } catch(e) { if(!info.root.startsWith("r2://"))throw e;tree.replaceChildren(el("p","R2 is unavailable. Refresh to retry, or reconnect with updated credentials.","aside-hint"));notify(String(e),true); }
  if(restore && info.active && info.active!=="."){try{await openFolderFile(info,info.active);}catch(e){await showWorkspace(info);notify(`Last file is unavailable. Choose another file. ${String(e)}`,true);}}
  else await showWorkspace(info);
}
async function openFolder(){await task("Opening workspace…",async()=>{await saveQuery();const info=await Workbench.openWorkspace();if(info)await showFolder(info);});}
$("open-folder").onclick=()=>void openFolder();$("welcome-folder").onclick=()=>void openFolder();
const r2Dialog=$<HTMLDialogElement>("r2-dialog");
const clearR2Keys=()=>{ $<HTMLInputElement>("r2-access").value="";$<HTMLInputElement>("r2-secret").value=""; };
$("open-r2").onclick=()=>{ $("r2-error").hidden=true;r2Dialog.showModal();$<HTMLInputElement>("r2-endpoint").focus(); };
r2Dialog.onclose=clearR2Keys;
r2Dialog.oncancel=e=>{if(busy){e.preventDefault();void Workbench.cancel();}};
$("r2-dismiss").onclick=()=>r2Dialog.close();
$("r2-cancel").onclick=()=>{if(busy)void Workbench.cancel();else r2Dialog.close();};
$("r2-form").onsubmit=e=>{
 e.preventDefault();if(busy)return;
 const input={name:$<HTMLInputElement>("r2-name").value,endpoint:$<HTMLInputElement>("r2-endpoint").value,bucket:$<HTMLInputElement>("r2-bucket").value,prefix:$<HTMLInputElement>("r2-prefix").value,accessKey:$<HTMLInputElement>("r2-access").value,secretKey:$<HTMLInputElement>("r2-secret").value};
 clearR2Keys();$("r2-error").hidden=true;$("r2-submit").textContent="Connecting…";
 void task("Connecting to R2…",async()=>{
  try {await saveQuery();const info=await Workbench.connectR2(input);if(!info)throw new Error("No R2 workspace returned");r2Dialog.close();await showFolder(info);}
  catch(e){$("r2-error").textContent=String(e);$("r2-error").hidden=false;throw e;}
  finally{input.accessKey="";input.secretKey="";$("r2-submit").textContent="Test & connect";}
 });
};
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
    .forEach((n) => (n.disabled = busy && n.id !== "cancel" && n.id !== "r2-cancel"));
  $("previous").toggleAttribute(
    "disabled",
    busy || !result || request.offset === 0,
  );
  $("next").toggleAttribute("disabled", busy || !result?.more);
  $("export").toggleAttribute("disabled", busy || !result);
  $("run").toggleAttribute("disabled",busy || (!file && (!folder || !$<HTMLTextAreaElement>("sql").value.trim())));
  for(const id of ["apply-filter","clear-filter","page-size"])$(id).toggleAttribute("disabled",busy || !result);
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
  if(next === "schema" && !file)return;
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
  workspaceRoot="";
  file = f;
  $("empty-result").innerHTML="No matching rows.<small>Try another filter or query.</small>";
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
  $("empty-result").innerHTML="No matching rows.<small>Try another filter or query.</small>";
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
  const r = !file && folder ? await Workbench.queryWorkspace(folder.root,next) : await queryResult(next);
  if (!r) throw new Error("No query result returned");
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
$("export").onclick = () =>
  void task("Choose where to export…", async () => {
    const path = await Workbench.exportPage();
    if (path) notify(`Exported visible page to ${path}`);
  });
document.addEventListener("keydown", (e) => {
  if(r2Dialog.open && (e.metaKey || e.ctrlKey)){e.preventDefault();return;}
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
    e.preventDefault();
    void open();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && (file || folder)) {
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
