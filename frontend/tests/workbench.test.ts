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
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string, v: string) => { $<HTMLInputElement>(id).value = v; };
const lastRequest = (): Request => bridge.call.mock.calls.filter(([name]) => name === "Workbench.Query").at(-1)![1];
let responses: Record<string, (...args: any[]) => unknown>;
let listeners: [string, EventListenerOrEventListenerObject][];

beforeEach(() => {
  vi.resetModules(); bridge.call.mockReset(); bridge.drop = undefined;
  document.body.innerHTML = '<div id="app"></div>'; delete document.body.dataset.ready;
  responses = {
    "Workbench.InitialFile": () => "",
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
    expect(document.querySelector("#app img, #app script")).toBeNull();
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
    await click("tab-sql"); expect($("sql-panel").hidden).toBe(false); await click("tab-data"); expect($("sql-panel").hidden).toBe(true);
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
    await open(); await click("next"); const previous = $("grid").textContent;
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
