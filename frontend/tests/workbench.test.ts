import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { File as DataFile, Request, Result } from "../src/mygo";

const bridge = vi.hoisted(() => ({
  call: vi.fn(),
  drop: undefined as undefined | ((event: { paths: string[] }) => void),
}));
vi.mock("mygo-runtime", () => ({
  call: bridge.call,
  onFileDrop: (fn: (event: { paths: string[] }) => void) => { bridge.drop = fn; },
}));

const columns = [
  { name: "id", type: "BIGINT" },
  { name: "text", type: "VARCHAR" },
  { name: "time", type: "TIMESTAMP_NS" },
];
const dataFile = (bytes = "2048"): DataFile => ({
  name: "竹 <img src=x>.parquet", path: "/local/<script>.parquet", bytes,
  rows: "1000000", rowGroups: "10", columns,
});
const page = (offset = 0, more = true): Result => ({
  columns, rows: [["9223372036854775807", "<img src=x onerror=alert(1)>", "2026-01-02 03:04:05.123456789"], [null, "", "UTC"]],
  more, offset, elapsedMS: 3,
});
const $ = <T extends HTMLElement = HTMLElement>(id: string) => (document.getElementById(id) || document.querySelector(`[data-control="${id}"]`)) as T;
const value = (id: string, v: string) => { $<HTMLInputElement>(id).value = v; };
const lastRequest = (): Request => bridge.call.mock.calls.filter(([name]) => name === "Workbench.Query").at(-1)![1];
let responses: Record<string, (...args: any[]) => unknown>;
let listeners: [string, EventListenerOrEventListenerObject][];

beforeEach(() => {
  vi.resetModules(); bridge.call.mockReset(); bridge.drop = undefined;
  document.body.innerHTML = '<div id="app"></div>'; delete document.body.dataset.ready;
  responses = {
    "Workbench.InitialFile": () => "",
    "Workbench.RestoreWorkspaces": () => ({workspaces:[],warning:""}),
    "Workbench.ClearPreview": () => undefined,
    "Workbench.OpenWorkspaceQuery": () => ({draft:"",applied:""}),
    "Workbench.QueryWorkspace": (_root:string,r:Request) => page(r.offset,r.offset<200),
    "Workbench.CloseWorkspaceFile": () => undefined,
    "Workbench.Open": () => dataFile(),
    "Workbench.OpenPath": () => dataFile(),
    "Workbench.Query": (r: Request) => page(r.offset, r.offset < 200),
    "Workbench.ExportPage": () => "/local/page.json",
    "Workbench.Cancel": () => undefined,
  };
  bridge.call.mockImplementation(async (name: string, ...args: any[]) => {
    if (!responses[name]) throw new Error(`Unexpected IPC ${name}`);
    return responses[name](...args);
  });
  listeners = [];
  const original = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation((type: string, listener: any, options?: any) => {
    listeners.push([type, listener]); original(type, listener, options);
  });
});
afterEach(() => { for (const [type, listener] of listeners) document.removeEventListener(type, listener); vi.restoreAllMocks(); });
async function settled() { await vi.waitFor(() => expect($("busy").hidden).toBe(true)); }
async function boot() { await import("../src/main"); await vi.waitFor(() => expect(document.body.dataset.ready).toBe("true")); }
async function click(id: string) { $(id).click(); await settled(); }
async function open() { await boot(); await click("open"); }
function key(key: string, options: KeyboardEventInit = {}) { const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }); document.dispatchEvent(ev); return ev; }

describe("the shipped page through its generated IPC binding", () => {
  it("starts empty and honors canceled and failed pickers without opening a session", async () => {
    await boot(); expect($("welcome").hidden).toBe(false); expect($<HTMLButtonElement>("export").disabled).toBe(true);
    expect(key("Enter", { ctrlKey: true }).defaultPrevented).toBe(false);
    responses["Workbench.Open"] = () => null; await click("welcome-open");
    expect(bridge.call.mock.calls.some(([name]) => name === "Workbench.Query")).toBe(false);
    responses["Workbench.Open"] = () => { throw new Error("picker unavailable"); }; await click("open");
    expect($("notification").textContent).toBe("picker unavailable"); expect($("notification").classList.contains("error")).toBe(true);
    expect($("welcome").hidden).toBe(false);
  });

  it("renders exact values, schema and hostile text safely, without disruptive cell popups", async () => {
    await open();
    expect($("row-count").textContent).toBe("1,000,000"); expect($("file-size").textContent).toBe("2.0 KB");
    expect($("file-name").textContent).toBe(dataFile().name); expect($("file-path").title).toBe(dataFile().path);
    expect(document.querySelector("#app script")).toBeNull();
    expect([...document.querySelectorAll("#app img")].map(n => n.className)).toEqual(["brand-mark", "welcome-mark"]);
    expect([...document.querySelectorAll(".type-icon")].map(n => n.textContent)).toEqual(["#", "T", "◷"]);
    const cells = document.querySelectorAll<HTMLTableCellElement>("#grid tbody td");
    expect(cells[1].textContent).toBe("9223372036854775807"); expect(cells[1].className).toBe("numeric");
    for (const [index, expected] of [[1, "9223372036854775807"], [5, "NULL"], [6, "empty"]] as const) {
      cells[index].click();
      cells[index].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      expect(document.querySelector("dialog, [role=dialog]")).toBeNull();
      expect(cells[index].textContent).toBe(expected);
    }
    const range = document.createRange(); range.selectNodeContents(cells[1]);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    expect(selection.toString()).toBe("9223372036854775807"); selection.removeAllRanges();
    expect(cells[2].textContent).toBe("<img src=x onerror=alert(1)>");
    await click("tab-schema"); expect($("data-panel").hidden).toBe(true); expect($("schema-panel").hidden).toBe(false);
    expect(document.querySelectorAll("#schema-body tr")).toHaveLength(3); expect($("tab-schema").getAttribute("aria-selected")).toBe("true");
    expect($("sql-panel").hidden).toBe(true);
    await click("tab-explore");
    expect($("tab-explore").textContent).toBe("Explore Data");
    expect($("sql-panel").hidden).toBe(false); expect($("data-panel").hidden).toBe(false);
    expect($("schema-panel").hidden).toBe(true);
    expect(document.querySelector("#tab-data, #tab-sql")).toBeNull();
  });

  it("paginates, changes page size, toggles sorting and binds literal filters", async () => {
    await open(); expect($<HTMLButtonElement>("previous").disabled).toBe(true);
    await click("next"); expect(lastRequest().offset).toBe(100); expect($("page-label").textContent).toBe("Page 2");
    expect(document.querySelector("#grid tbody td")!.textContent).toBe("101");
    await click("next"); expect($<HTMLButtonElement>("next").disabled).toBe(true); expect($("result-summary").textContent).toContain("end of results");
    await click("previous"); expect(lastRequest().offset).toBe(100);
    value("page-size", "50"); $("page-size").dispatchEvent(new Event("change")); await settled(); expect(lastRequest()).toMatchObject({offset:0, limit:50});
    for (const desc of [false, true]) { document.querySelector<HTMLButtonElement>("#grid th button")!.click(); await settled(); expect(lastRequest()).toMatchObject({sort:"id", desc}); expect(document.querySelector("#grid th button")!.textContent).toBe(`id ${desc ? "↓" : "↑"}`); }
    document.querySelectorAll<HTMLButtonElement>("#grid th button")[1].click(); await settled(); expect(lastRequest()).toMatchObject({sort:"text", desc:false});
    value("filter-column", "text"); value("filter-value", "' OR 1=1 --"); $("filter-form").dispatchEvent(new Event("submit", {cancelable:true})); await settled();
    expect(lastRequest()).toMatchObject({filterColumn:"text", filterValue:"' OR 1=1 --", offset:0});
    expect($<HTMLSelectElement>("filter-column").value).toBe("text");
    await click("clear-filter"); expect(lastRequest()).toMatchObject({filterColumn:"",filterValue:""}); expect($<HTMLInputElement>("filter-value").value).toBe("");
  });

  it("commits successful SQL only, preserves the previous page on failure and recovers", async () => {
    await open(); expect($("sql-panel").hidden).toBe(false); expect($("data-panel").hidden).toBe(false); await click("next"); const previous = $("grid").textContent;
    responses["Workbench.Query"] = () => { throw new Error("Binder error: <img>"); };
    value("sql", "SELECT bad"); await click("run"); expect($("grid").textContent).toBe(previous); expect($("page-label").textContent).toBe("Page 2");
    expect($("notification").textContent).toBe("Binder error: <img>"); expect($("notification").querySelector("img")).toBeNull();
    responses["Workbench.Query"] = () => null; await click("run"); expect($("notification").textContent).toBe("No query result returned"); expect($("grid").textContent).toBe(previous);
    responses["Workbench.Query"] = () => { throw "bridge disconnected"; }; await click("run"); expect($("notification").textContent).toBe("bridge disconnected");
    responses["Workbench.Query"] = () => ({...page(0,false),rows:[]}); value("sql", "SELECT * FROM data WHERE false"); await click("run");
    expect(lastRequest()).toMatchObject({offset:0, sort:"", desc:false,filterColumn:"",filterValue:""}); expect($("empty-result").hidden).toBe(false);
    expect($("result-summary").textContent).toBe("0 rows / 3 ms"); expect($("query-badge").textContent).toBe("SQL result"); expect($("notification").hidden).toBe(true);
    await click("reset-sql"); expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT * FROM data");
  });

  it("serializes busy work and cancel leaves a recoverable previous page", async () => {
    await open(); const previous = $("grid").textContent;
    let reject!: (reason: Error) => void;
    responses["Workbench.Query"] = () => new Promise((_, fail) => { reject = fail; });
    $("run").click(); expect($("busy").hidden).toBe(false); expect($<HTMLButtonElement>("cancel").disabled).toBe(false); expect($<HTMLButtonElement>("open").disabled).toBe(true);
    const count = bridge.call.mock.calls.length; key("o", {metaKey:true}); bridge.drop!({paths:["/another.parquet"]}); expect(bridge.call.mock.calls.length).toBe(count);
    $("cancel").click(); expect(bridge.call).toHaveBeenLastCalledWith("Workbench.Cancel"); reject(new Error("context canceled")); await settled();
    expect($("grid").textContent).toBe(previous); expect($<HTMLButtonElement>("open").disabled).toBe(false); expect($("notification").textContent).toBe("context canceled");
    responses["Workbench.Query"] = () => page(); await click("run"); expect($("notification").hidden).toBe(true);
  });

  it("opens initial and dropped paths, handles shortcuts and preserves state after failed open", async () => {
    responses["Workbench.InitialFile"] = () => "/initial.parquet"; responses["Workbench.OpenPath"] = () => dataFile("42"); await boot();
    expect(bridge.call).toHaveBeenCalledWith("Workbench.OpenPath", "/initial.parquet"); expect($("file-size").textContent).toBe("42 B");
    const count = bridge.call.mock.calls.length; bridge.drop!({paths:[]}); expect(bridge.call.mock.calls.length).toBe(count);
    responses["Workbench.OpenPath"] = () => dataFile("1048576"); bridge.drop!({paths:["/drop.parquet", "/ignored.parquet"]}); await settled();
    expect(bridge.call).toHaveBeenCalledWith("Workbench.OpenPath", "/drop.parquet"); expect($("file-size").textContent).toBe("1.0 MB");
    responses["Workbench.OpenPath"] = () => { throw new Error("bad file"); }; const previous = $("grid").textContent; bridge.drop!({paths:["/bad.parquet"]}); await settled(); expect($("grid").textContent).toBe(previous);
    expect(key("O", {ctrlKey:true}).defaultPrevented).toBe(true); await settled(); expect(bridge.call).toHaveBeenCalledWith("Workbench.Open");
    value("sql", "SELECT 1"); expect(key("Enter", {metaKey:true}).defaultPrevented).toBe(true); await settled(); expect(lastRequest().sql).toBe("SELECT 1");
    expect(key("x").defaultPrevented).toBe(false);
  });

  it("reports initialization bridge failures and can subsequently open a file", async () => {
    responses["Workbench.InitialFile"] = () => { throw new Error("IPC initialization failed"); }; await boot();
    expect($("notification").textContent).toBe("Error: IPC initialization failed"); await click("open"); expect($("workspace").hidden).toBe(false);
  });

  it("reports exports, cancel and save failure while keeping the visible result", async () => {
    await open(); const previous = $("grid").textContent;
    await click("export"); expect($("notification").textContent).toBe("Exported visible page to /local/page.json");
    responses["Workbench.ExportPage"] = () => ""; await click("export"); expect($("notification").hidden).toBe(true);
    responses["Workbench.ExportPage"] = () => { throw new Error("choose a new filename"); }; await click("export"); expect($("notification").textContent).toBe("choose a new filename"); expect($("grid").textContent).toBe(previous);
  });
});

const workspaceInfo = {root:"/analysis", name:"Research <img>", active:""};
function folderResponses() {
  responses["Workbench.OpenWorkspace"] = () => workspaceInfo;
  responses["Workbench.ListDirectory"] = (_root: string, rel: string, offset: number) => ({
    entries: rel === "." && offset === 0 ? [
      {name:"nested",path:"nested",directory:true},
      {name:"orders.parquet",path:"orders.parquet",directory:false},
    ] : [], next:200, more:rel === "." && offset === 0,
  });
  responses["Workbench.OpenWorkspaceFile"] = () => ({file:{...dataFile(),name:"orders.parquet",path:"/analysis/orders.parquet"}, query:{draft:"SELECT draft", applied:"SELECT 7"}, warning:""});
  responses["Workbench.SaveWorkspaceQuery"] = () => undefined;
  responses["Workbench.RenameWorkspace"] = (root: string, name: string) => ({...workspaceInfo,root,name});
  responses["Workbench.CloseWorkspace"] = () => undefined;
}
async function treeFile() { document.querySelector<HTMLButtonElement>(".tree-file")!.click(); await settled(); }

describe("folder workspaces", () => {
  it("browses lazy directories, renames safely and restores per-file SQL", async () => {
    folderResponses(); await boot(); await click("open-folder");
    expect($("folder-name").textContent).toBe("Research <img>"); expect($("folder-panel").querySelector("img")).toBeNull();
    expect($("workspace").hidden).toBe(false); expect($("folder-panel").hidden).toBe(false);
    const directory = document.querySelector<HTMLButtonElement>(".tree-folder")!;
    directory.click(); await settled(); expect(directory.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".tree-children")!.textContent).toContain("No visible");
    directory.click(); await settled(); expect(directory.getAttribute("aria-expanded")).toBe("false");
    document.querySelector<HTMLButtonElement>(".tree-more")!.click(); await settled(); expect(document.querySelector(".tree-more")).toBeNull();
    await click("folder-refresh"); await treeFile();
    expect(lastRequest().sql).toBe("SELECT 7"); expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT draft");
    expect($("breadcrumb").textContent).toBe("orders.parquet"); expect(document.querySelector(".tree-file.selected")).not.toBeNull();
    value("sql","SELECT 9"); $("sql").dispatchEvent(new Event("input"));
    expect($("query-save").textContent).toBe("Unsaved changes");
    await vi.waitFor(() => expect($("query-save").textContent).toBe("Saved locally"));
    expect(bridge.call).toHaveBeenCalledWith("Workbench.SaveWorkspaceQuery","/analysis","orders.parquet","SELECT 9","SELECT 7");
    await click("run"); expect(bridge.call).toHaveBeenCalledWith("Workbench.SaveWorkspaceQuery","/analysis","orders.parquet","SELECT 9","SELECT 9");
    await click("reset-sql"); $("sql").dispatchEvent(new Event("blur")); await vi.waitFor(() => expect($("query-save").textContent).toBe("Saved locally"));
    await click("folder-rename"); expect(document.activeElement!.getAttribute("data-control")).toBe("folder-name-input");
    await click("folder-rename-cancel"); expect($("folder-rename-form").hidden).toBe(true);
    await click("folder-rename"); value("folder-name-input","My analysis"); $("folder-rename-form").dispatchEvent(new Event("submit",{cancelable:true})); await settled();
    expect($("scope-name").textContent).toBe("My analysis");
    await click("folder-close"); expect($("folder-panel").hidden).toBe(true); expect($("scope-name").textContent).toBe("File"); expect($("breadcrumb").textContent).toBe("Welcome");
  });
  it("restores a workspace on startup and preserves a draft if the saved query fails", async () => {
    folderResponses(); responses["Workbench.RestoreWorkspaces"] = () => ({workspaces:[{...workspaceInfo,active:"orders.parquet"}],warning:""});
    responses["Workbench.Query"] = (r: Request) => { if (r.sql === "SELECT 7") throw new Error("missing column"); return page(); };
    await boot(); expect(lastRequest().sql).toBe("SELECT * FROM data"); expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT draft"); expect($("notification").textContent).toContain("Draft preserved");
    responses["Workbench.OpenWorkspaceFile"] = () => ({file:{...dataFile(),name:"orders.parquet",path:"/analysis/orders.parquet"},query:{draft:"",applied:""},warning:"Recent-file state not saved"});
    await treeFile(); expect($("notification").textContent).toBe("Recent-file state not saved");
    responses["Workbench.Open"] = () => null; await click("open"); expect($("folder-panel").hidden).toBe(false);
    responses["Workbench.Open"] = () => dataFile(); await click("open"); expect($("folder-panel").hidden).toBe(false); expect($("scope-name").textContent).toBe("File");
    $("sql").dispatchEvent(new Event("input"));
  });
  it("handles missing folders/files and keeps previous data on failed file selection", async () => {
    folderResponses(); responses["Workbench.RestoreWorkspaces"] = () => ({workspaces:[{...workspaceInfo,active:"gone.parquet"}],warning:""});
    responses["Workbench.OpenWorkspaceFile"] = () => { throw new Error("file removed"); };
    await boot(); expect($("notification").textContent).toContain("Last file is unavailable"); expect($("workspace").hidden).toBe(false);
    await click("folder-close"); expect($("breadcrumb").textContent).toBe("Welcome");
    responses["Workbench.OpenWorkspace"] = () => null; await click("welcome-folder"); expect($("folder-panel").hidden).toBe(true);
    responses["Workbench.OpenWorkspace"] = () => { throw new Error("folder access denied"); }; await click("open-folder"); expect($("notification").textContent).toBe("folder access denied");
    responses["Workbench.OpenWorkspace"] = () => workspaceInfo; await click("open-folder");
    responses["Workbench.OpenWorkspaceFile"] = () => null; await treeFile(); expect($("notification").textContent).toBe("No file returned");
    responses["Workbench.OpenWorkspaceFile"] = () => ({file:{...dataFile(),name:"orders.parquet",path:"/analysis/orders.parquet"},query:{draft:"",applied:""},warning:""}); await treeFile();
    const previous = $("grid").textContent; responses["Workbench.OpenWorkspaceFile"] = () => { throw new Error("bad parquet"); }; await treeFile(); expect($("grid").textContent).toBe(previous);
    responses["Workbench.ListDirectory"] = () => null; await click("folder-refresh"); expect($("notification").textContent).toBe("No directory listing returned");
    responses["Workbench.RenameWorkspace"] = () => null; await click("folder-rename"); $("folder-rename-form").dispatchEvent(new Event("submit",{cancelable:true})); await settled(); expect($("notification").textContent).toBe("No workspace returned");
  });
  it("reports failed saves, blocks a losing switch, and can recover", async () => {
    folderResponses(); await boot(); await click("open-folder"); await treeFile();
    responses["Workbench.SaveWorkspaceQuery"] = () => { throw new Error("disk full"); };
    value("sql","SELECT important_draft"); $("sql").dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect($("query-save").textContent).toBe("Not saved"));
    expect($("notification").textContent).toContain("Could not save query");
    const count = bridge.call.mock.calls.filter(([n]) => n === "Workbench.Open").length;
    await click("open"); expect(bridge.call.mock.calls.filter(([n]) => n === "Workbench.Open")).toHaveLength(count);
    responses["Workbench.SaveWorkspaceQuery"] = () => undefined;
    await treeFile(); expect($("query-save").textContent).toBe("Saved locally");
  });
});

const openedRows = () => [...document.querySelectorAll<HTMLElement>(".opened-file")];
async function openedAction(path:string,action="activate-file") {
  const row=openedRows().find(r=>r.dataset.path===path)!;
  row.querySelector<HTMLButtonElement>(`.${action}`)!.click();await settled();
}
describe("multiple open files and workspaces",()=>{
 it("retains independent drafts, paging and schema while switching; closes inactive, active and last files",async()=>{
  const a={...dataFile(),name:"a.parquet",path:"/outside/a.parquet"};
  const b={...dataFile(),name:"b.parquet",path:"/outside/b.parquet"};
  const c={...dataFile(),name:"c.parquet",path:"/outside/c.parquet"};
  responses["Workbench.Open"]=()=>a;responses["Workbench.OpenPath"]=(path:string)=>[a,b,c].find(f=>f.path===path);
  await open();value("sql","SELECT draft_a");$("sql").dispatchEvent(new Event("input"));await click("next");await click("tab-schema");
  responses["Workbench.Open"]=()=>b;await click("open");expect(openedRows()).toHaveLength(2);expect($("schema-panel").hidden).toBe(true);
  value("sql","SELECT draft_b");$("sql").dispatchEvent(new Event("input"));
  await openedAction(a.path);expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT draft_a");expect(lastRequest().offset).toBe(100);expect($("schema-panel").hidden).toBe(false);
  await openedAction(b.path);expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT draft_b");expect(lastRequest().offset).toBe(0);
  await click("open");expect(openedRows()).toHaveLength(2); // no duplicate on repeated opening
  responses["Workbench.Open"]=()=>c;await click("open");
  const queries=bridge.call.mock.calls.filter(([n])=>n==="Workbench.Query").length;
  await openedAction(b.path,"close-file");expect(openedRows()).toHaveLength(2);expect(bridge.call.mock.calls.filter(([n])=>n==="Workbench.Query")).toHaveLength(queries);
  await openedAction(a.path);await openedAction(a.path,"close-file");expect($("file-name").textContent).toBe("c.parquet");
  await openedAction(c.path,"close-file");expect(openedRows()).toHaveLength(0);expect($("welcome").hidden).toBe(false);expect($<HTMLButtonElement>("export").disabled).toBe(true);expect(bridge.call).toHaveBeenCalledWith("Workbench.ClearPreview");
 });
 it("keeps several roots, classifies boundary paths, deduplicates folders, and closes workspace files while keeping outside files",async()=>{
  folderResponses();await boot();await click("open-folder");await treeFile();
  responses["Workbench.OpenWorkspace"]=()=>({root:"/second",name:"Second",active:""});await click("open-folder");
  expect(document.querySelectorAll(".workspace-group")).toHaveLength(2);expect($("file-name").textContent).toBe("Second");expect(openedRows()).toHaveLength(1);
  await click("open-folder");expect(document.querySelectorAll(".workspace-group")).toHaveLength(2);
  const external={...dataFile(),name:"outside.parquet",path:"/analysis-other/outside.parquet"};
  responses["Workbench.Open"]=()=>external;await click("open");
  expect(document.querySelector(".external-files")!.textContent).toContain("outside.parquet");expect(openedRows()).toHaveLength(2);expect(document.querySelectorAll(".workspace-group")).toHaveLength(2);
  responses["Workbench.Open"]=()=>({...dataFile(),name:"orders.parquet",path:"/analysis/orders.parquet"});await click("open");expect(openedRows()).toHaveLength(2);expect($("scope-name").textContent).toBe(workspaceInfo.name);
  responses["Workbench.OpenPath"]=()=>external;
  await click("folder-close");expect(document.querySelectorAll(".workspace-group")).toHaveLength(1);expect(openedRows()).toHaveLength(1);expect(document.querySelectorAll(".external-files .opened-file")).toHaveLength(1);
  expect($("scope-name").textContent).toBe("File");expect($("file-name").textContent).toBe("outside.parquet");
 });
 it("groups previously external files when a matching folder opens, chooses deepest nested root and reports restore warnings",async()=>{
  folderResponses();responses["Workbench.RestoreWorkspaces"]=()=>({workspaces:[],warning:"One folder is unavailable"});
  responses["Workbench.Open"]=()=>({...dataFile(),name:"nested.parquet",path:"/analysis/nested/nested.parquet"});
  responses["Workbench.OpenWorkspaceFile"]=(root:string,relative:string)=>({file:{...dataFile(),name:"nested.parquet",path:root+"/"+relative},query:{draft:"SELECT * FROM data",applied:"SELECT * FROM data"},warning:""});
  await open();expect($("scope-name").textContent).toBe("File");
  await click("open-folder");expect(document.querySelector(".external-files")).toBeNull();
  responses["Workbench.OpenWorkspace"]=()=>({root:"/analysis/nested",name:"Nested",active:""});await click("open-folder");expect($("scope-name").textContent).toBe("Nested");
  responses["Workbench.OpenWorkspace"]=()=>({root:"/",name:"Root",active:""});await click("open-folder");expect($("scope-name").textContent).toBe("Root");
  await click("open");expect($("scope-name").textContent).toBe("Nested");
  const nestedPanel=[...document.querySelectorAll<HTMLElement>(".workspace-group")].find(p=>p.dataset.root==="/analysis/nested")!;
  nestedPanel.querySelector<HTMLButtonElement>('[data-control="folder-close"]')!.click();await settled();
  expect($("welcome").hidden).toBe(true);expect($("workspace").hidden).toBe(false);expect($("open-files-panel").hidden).toBe(true);expect(openedRows()).toHaveLength(0);
  expect(document.querySelectorAll(".workspace-group")).toHaveLength(2);

 });
 it("shows workspace files only in the tree, retains tree close controls after refresh, and hides an empty outside list",async()=>{
  folderResponses();await boot();await click("open-folder");await treeFile();
  expect($("open-files-panel").hidden).toBe(true);expect($("open-files").children).toHaveLength(0);
  expect(document.querySelectorAll(".tree-file-row .close-file")).toHaveLength(1);
  await click("folder-refresh");expect(document.querySelectorAll(".tree-file-row .close-file")).toHaveLength(1);
  await openedAction("/analysis/orders.parquet","close-file");
  expect(document.querySelectorAll(".tree-file-row .close-file")).toHaveLength(0);
  expect(document.querySelector(".tree-file")).not.toBeNull();expect($("welcome").hidden).toBe(true);expect($("workspace").hidden).toBe(false);
  await treeFile();expect($("workspace").hidden).toBe(false);expect($("open-files-panel").hidden).toBe(true);
  responses["Workbench.Open"]=()=>({...dataFile(),name:"outside.parquet",path:"/outside.parquet"});await click("open");
  expect($("open-files-panel").hidden).toBe(false);expect($("open-files").querySelectorAll(".opened-file")).toHaveLength(1);
  await openedAction("/outside.parquet","close-file");expect($("open-files-panel").hidden).toBe(true);
  expect($("file-name").textContent).toBe("orders.parquet");
 });
 it("closes all files owned by a workspace atomically and preserves unrelated active files",async()=>{
  folderResponses();await boot();await click("open-folder");await treeFile();
  responses["Workbench.Open"]=()=>({...dataFile(),name:"second.parquet",path:"/analysis/second.parquet"});
  responses["Workbench.OpenWorkspaceFile"]=(_root:string,path:string)=>({file:{...dataFile(),name:path,path:"/analysis/"+path},query:{draft:"SELECT * FROM data",applied:"SELECT * FROM data"},warning:""});
  await click("open");
  const outside={...dataFile(),name:"outside.parquet",path:"/outside.parquet"};responses["Workbench.Open"]=()=>outside;await click("open");
  const count=bridge.call.mock.calls.filter(([n])=>n==="Workbench.Query").length;
  responses["Workbench.CloseWorkspace"]=()=>{throw new Error("settings write failed")};await click("folder-close");
  expect(document.querySelectorAll(".workspace-group")).toHaveLength(1);expect($("notification").textContent).toBe("settings write failed");
  responses["Workbench.CloseWorkspace"]=()=>undefined;await click("folder-close");
  expect(openedRows()).toHaveLength(1);expect(openedRows()[0].dataset.path).toBe(outside.path);expect($("file-name").textContent).toBe("outside.parquet");
  expect(bridge.call.mock.calls.filter(([n])=>n==="Workbench.Query")).toHaveLength(count);
  await openedAction(outside.path,"close-file");expect($("welcome").hidden).toBe(false);expect(openedRows()).toHaveLength(0);
 });
 it("keeps the old preview intact until the next file result is ready and commits atomically",async()=>{
  const a={...dataFile(),name:"a.parquet",path:"/a.parquet"},b={...dataFile(),name:"b.parquet",path:"/b.parquet"};
  responses["Workbench.Open"]=()=>a;await open();await click("tab-schema");
  const oldTable=$("grid").textContent;
  let finish!:(r:Result)=>void;responses["Workbench.Open"]=()=>b;responses["Workbench.Query"]=()=>new Promise<Result>(resolve=>{finish=resolve;});
  $("open").click();await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));
  expect($("file-name").textContent).toBe("a.parquet");expect($("grid").textContent).toBe(oldTable);expect($("schema-panel").hidden).toBe(false);expect(document.body.classList.contains("is-busy")).toBe(true);
  finish({...page(),rows:[["b-row","new","time"]]});await settled();
  expect($("file-name").textContent).toBe("b.parquet");expect($("grid").textContent).toContain("b-row");expect($("schema-panel").hidden).toBe(true);expect(document.body.classList.contains("is-busy")).toBe(false);
  responses["Workbench.Open"]=()=>a;responses["Workbench.Query"]=()=>{throw new Error("preview unavailable")};await click("open");
  expect($("file-name").textContent).toBe("a.parquet");expect($("grid").querySelectorAll("tbody tr")).toHaveLength(0);expect($<HTMLButtonElement>("export").disabled).toBe(true);expect($("notification").textContent).toBe("preview unavailable");
 });
 it("keeps surviving files available if a neighbor disappears during close",async()=>{
  const a={...dataFile(),name:"a",path:"/a.parquet"},b={...dataFile(),name:"b",path:"/b.parquet"};
  responses["Workbench.Open"]=()=>a;await open();responses["Workbench.Open"]=()=>b;await click("open");
  responses["Workbench.OpenPath"]=()=>{throw new Error("missing file")};await openedAction(b.path,"close-file");expect($("notification").textContent).toContain("File closed. Choose another file");expect(openedRows()).toHaveLength(1);expect($("welcome").hidden).toBe(false);
  responses["Workbench.OpenPath"]=()=>null;await openedAction(a.path);expect($("notification").textContent).toBe("No file returned");
  responses["Workbench.OpenPath"]=()=>a;await openedAction(a.path);expect($("workspace").hidden).toBe(false);
 });
});

it("offers safely quoted workspace tables and inserts at the cursor without running SQL",async()=>{
 const name='竹 " <img>.parquet';
 const f={...dataFile(),path:'/root/'+name,name};
 responses['Workbench.RestoreWorkspaces']=()=>({workspaces:[{root:'/root',name:'Root',active:name}],warning:''});
 responses['Workbench.ListDirectory']=()=>({entries:[{name,path:name,directory:false},{name:'other.parquet',path:'other.parquet',directory:false}],more:false,next:2});
 responses['Workbench.OpenWorkspaceFile']=()=>({file:f,query:{draft:'SELECT * FROM data',applied:'SELECT * FROM data'},warning:''});
 responses['Workbench.SaveWorkspaceQuery']=()=>undefined;
 await boot();
 expect($('workspace-tables').hidden).toBe(false);
 const editor=$<HTMLTextAreaElement>('sql');editor.value='SELECT * FROM data';editor.setSelectionRange(14,18);
 const before=bridge.call.mock.calls.filter(([name])=>name==='Workbench.Query').length;
 document.querySelector<HTMLButtonElement>('.table-reference')!.click();
 expect(editor.value).toBe('SELECT * FROM workspace."竹 "" <img>.parquet"');
 expect(document.querySelector('#workspace-table-list img')).toBeNull();
 expect(bridge.call.mock.calls.filter(([name])=>name==='Workbench.Query')).toHaveLength(before);
 await click('run');expect(lastRequest().sql).toBe(editor.value);
 responses['Workbench.Open']=()=>dataFile();await click('open');expect($('workspace-tables').hidden).toBe(true);
});

it("queries without opening a file, keeps independent drafts, and returns to the editor on last-file close",async()=>{
 folderResponses();await boot();await click('open-folder');
 expect($('welcome').hidden).toBe(true);expect($('workspace').hidden).toBe(false);expect($('file-name').textContent).toBe(workspaceInfo.name);
 expect($<HTMLButtonElement>('run').disabled).toBe(true);
 expect(bridge.call.mock.calls.some(([name])=>name==='Workbench.OpenWorkspaceFile')).toBe(false);
 value('sql','SELECT * FROM workspace."orders.parquet"');$('sql').dispatchEvent(new Event('input'));
 key('Enter',{metaKey:true});await settled();
 expect(bridge.call).toHaveBeenCalledWith('Workbench.QueryWorkspace','/analysis',expect.objectContaining({sql:'SELECT * FROM workspace."orders.parquet"'}));
 expect(bridge.call).toHaveBeenCalledWith('Workbench.SaveWorkspaceQuery','/analysis','.',expect.any(String),expect.any(String));
 expect($<HTMLButtonElement>('export').disabled).toBe(false);
 await click('next');expect(bridge.call).toHaveBeenLastCalledWith('Workbench.QueryWorkspace','/analysis',expect.objectContaining({offset:100}));
 value('sql','SELECT draft');$('sql').dispatchEvent(new Event('input'));
 await treeFile();expect($('breadcrumb').textContent).toBe('orders.parquet');
 await click('folder-name');expect($<HTMLTextAreaElement>('sql').value).toBe('SELECT draft');expect($('page-label').textContent).toBe('Page 2');
 await treeFile();document.querySelector<HTMLButtonElement>('.close-file')!.click();await settled();
 expect($('welcome').hidden).toBe(true);expect($<HTMLTextAreaElement>('sql').value).toBe('SELECT draft');
 await click('reset-sql');expect($<HTMLTextAreaElement>('sql').value).toBe('');
 responses['Workbench.QueryWorkspace']=()=>null;value('sql','SELECT 1');$('sql').dispatchEvent(new Event('input'));await click('run');expect($('notification').textContent).toBe('No query result returned');
 responses['Workbench.QueryWorkspace']=()=>{throw new Error('table removed')};await click('folder-name');expect($('notification').textContent).toContain('Draft preserved');expect($<HTMLButtonElement>('export').disabled).toBe(true);
 await click('folder-close');expect($('welcome').hidden).toBe(false);
});

it("restores a workspace-level query directly and keeps multiple workspace drafts separate",async()=>{
 folderResponses();responses['Workbench.RestoreWorkspaces']=()=>({workspaces:[{...workspaceInfo,active:'.'}],warning:''});
 responses['Workbench.OpenWorkspaceQuery']=()=>({draft:'SELECT 42',applied:'SELECT 42'});
 await boot();expect(bridge.call).toHaveBeenCalledWith('Workbench.QueryWorkspace','/analysis',expect.objectContaining({sql:'SELECT 42'}));
 responses['Workbench.OpenWorkspace']=()=>({root:'/second',name:'Second',active:''});
 responses['Workbench.OpenWorkspaceQuery']=()=>({draft:'',applied:''});await click('open-folder');expect($<HTMLTextAreaElement>('sql').value).toBe('');
 value('sql','SELECT 7');$('sql').dispatchEvent(new Event('input'));await click('run');
 await click('folder-name');expect($<HTMLTextAreaElement>('sql').value).toBe('SELECT 42');
 expect(document.querySelectorAll('.opened-file')).toHaveLength(0);
});

it("keeps the last file's workspace selected and distinguishes an empty query result from an unrun editor",async()=>{
 folderResponses();await boot();await click('open-folder');
 responses['Workbench.OpenWorkspace']=()=>({root:'/second',name:'Second',active:''});await click('open-folder');
 responses['Workbench.OpenWorkspaceFile']=(root:string,path:string)=>({file:{...dataFile(),name:path,path:root+'/'+path},query:{draft:'SELECT * FROM data',applied:'SELECT * FROM data'},warning:''});
 document.querySelector<HTMLButtonElement>('.tree-file[data-root="/second"]')!.click();await settled();
 document.querySelector<HTMLButtonElement>('.close-file')!.click();await settled();
 expect($('scope-name').textContent).toBe('Second');expect($('breadcrumb').textContent).toBe('Explore Data');
 responses['Workbench.QueryWorkspace']=()=>({...page(),rows:[],more:false});
 value('sql','SELECT * FROM workspace."empty.parquet"');$('sql').dispatchEvent(new Event('input'));await click('run');
 expect($('empty-result').hidden).toBe(false);expect($('empty-result').textContent).toContain('No matching rows.');expect($('empty-result').textContent).not.toContain('Write a query');
});
