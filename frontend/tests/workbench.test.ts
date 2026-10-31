import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { File as DataFile, Request, Result } from "../src/mygo";

const bridge = vi.hoisted(() => ({
  call: vi.fn(),
  drop: undefined as
    undefined | ((event: { paths: string[]; x?: number; y?: number }) => void),
}));
vi.mock("mygo-runtime", () => ({
  call: bridge.call,
  onFileDrop: (
    fn: (event: { paths: string[]; x?: number; y?: number }) => void,
  ) => {
    bridge.drop = fn;
  },
}));

const columns = [
  { name: "id", type: "BIGINT" },
  { name: "text", type: "VARCHAR" },
  { name: "time", type: "TIMESTAMP_NS" },
];
const dataFile = (bytes = "2048"): DataFile => ({
  name: "竹 <img src=x>.parquet",
  path: "/local/<script>.parquet",
  bytes,
  rows: "1000000",
  rowGroups: "10",
  columns,
});
const page = (offset = 0, more = true): Result => ({
  columns,
  rows: [
    [
      "9223372036854775807",
      "<img src=x onerror=alert(1)>",
      "2026-01-02 03:04:05.123456789",
    ],
    [null, "", "UTC"],
  ],
  more,
  offset,
  elapsedMS: 3,
});
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  (document.getElementById(id) ||
    document.querySelector(`[data-control="${id}"]`)) as T;
const value = (id: string, v: string) => {
  $<HTMLInputElement>(id).value = v;
};
const lastRequest = (): Request =>
  bridge.call.mock.calls
    .filter(([name]) => name === "Workbench.Query")
    .at(-1)![1];
let responses: Record<string, (...args: any[]) => unknown>;
let listeners: [string, EventListenerOrEventListenerObject][];

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    },
  });
  vi.spyOn(window, "setInterval").mockReturnValue(0);
  vi.resetModules();
  bridge.call.mockReset();
  bridge.drop = undefined;
  document.body.innerHTML = '<div id="app"></div>';
  delete document.body.dataset.ready;
  responses = {
    "Workbench.InitialFile": () => "",
    "Workbench.UpdateStatus": () => ({
      version: "0.1.0",
      available: true,
      automatic: true,
      canCheck: true,
    }),
    "Workbench.SetAutomaticUpdates": () => undefined,
    "Workbench.CheckForUpdates": () => undefined,
    "Workbench.Appearance": () => "system",
    "Workbench.Resources": () => ({
      memoryMiB: 256,
      memoryAuto: false,
      tempAuto: false,
      tempGiB: 4,
      timeoutSeconds: 300,
    }),
    "Workbench.ResourceLimits": () => ({
      physicalMiB: 32768,
      maxMemoryMiB: 32768,
      autoMemoryMiB: 8192,
    }),
    "Workbench.DiskLimits": () => ({
      detected: true,
      availableGiB: 257,
      reserveGiB: 1,
      maxTempGiB: 256,
      autoTempGiB: 64,
    }),
    "Workbench.SetResources": () => undefined,
    "Workbench.Language": () => "en",
    "Workbench.SetLanguage": () => undefined,
    "Workbench.RestoreWorkspaces": () => ({ workspaces: [], warning: "" }),
    "Workbench.ClearPreview": () => undefined,
    "Workbench.ListConnections": () => [],
    "Workbench.OpenWorkspaceQuery": () => ({ draft: "", applied: "" }),
    "Workbench.QueryWorkspace": (_root: string, r: Request) =>
      page(r.offset, r.offset < 200),
    "Workbench.CloseWorkspaceFile": () => undefined,
    "Workbench.CloseFile": () => undefined,
    "Workbench.Open": () => dataFile(),
    "Workbench.OpenPath": () => dataFile(),
    "Workbench.Query": (r: Request) => page(r.offset, r.offset < 200),
    "Workbench.ExportPage": () => "/local/page.json",
    "Workbench.ExportPageAs": (format: string) => `/local/page.${format}`,
    "Workbench.Cancel": () => undefined,
  };
  bridge.call.mockImplementation(async (name: string, ...args: any[]) => {
    if (!responses[name]) throw new Error(`Unexpected IPC ${name}`);
    return responses[name](...args);
  });
  listeners = [];
  const original = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(
    (type: string, listener: any, options?: any) => {
      listeners.push([type, listener]);
      original(type, listener, options);
    },
  );
});
afterEach(() => {
  for (const [type, listener] of listeners)
    document.removeEventListener(type, listener);
  vi.restoreAllMocks();
});
async function settled() {
  await vi.waitFor(() => expect($("busy").hidden).toBe(true));
}
async function boot() {
  await import("../src/main");
  await vi.waitFor(() => expect(document.body.dataset.ready).toBe("true"));
}
async function click(id: string) {
  $(id).click();
  await settled();
}
async function open() {
  await boot();
  await click("open");
}
function key(key: string, options: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  document.dispatchEvent(ev);
  return ev;
}

describe("the shipped page through its generated IPC binding", () => {
  it("starts empty and honors canceled and failed pickers without opening a session", async () => {
    await boot();
    expect($("welcome").hidden).toBe(false);
    expect($("open-data").hidden).toBe(true);
    expect($<HTMLButtonElement>("export").disabled).toBe(true);
    expect(key("Enter", { ctrlKey: true }).defaultPrevented).toBe(false);
    responses["Workbench.Open"] = () => null;
    await click("open");
    expect(
      bridge.call.mock.calls.some(([name]) => name === "Workbench.Query"),
    ).toBe(false);
    responses["Workbench.Open"] = () => {
      throw new Error("picker unavailable");
    };
    await click("open");
    expect($("notification").textContent).toBe("picker unavailable");
    expect($("notification").classList.contains("error")).toBe(true);
    expect($("welcome").hidden).toBe(false);
  });

  it("renders exact values, schema and hostile text safely, without disruptive cell popups", async () => {
    await open();
    expect($("row-count").textContent).toBe("1,000,000");
    expect($("file-size").textContent).toBe("2.0 KB");
    expect($("file-name").textContent).toBe(dataFile().name);
    expect($("file-path").title).toBe(dataFile().path);
    expect(document.querySelector("#app script")).toBeNull();
    expect(
      [...document.querySelectorAll("#app img")].map((n) => n.className),
    ).toEqual(["brand-mark", "provider-logo", "provider-logo"]);
    expect(
      [...document.querySelectorAll(".type-icon")].map((n) => n.textContent),
    ).toEqual(["#", "T", "◷"]);
    const cells =
      document.querySelectorAll<HTMLTableCellElement>("#grid tbody td");
    expect(cells[1].textContent).toBe("9223372036854775807");
    expect(cells[1].className).toBe("numeric");
    for (const [index, expected] of [
      [1, "9223372036854775807"],
      [5, "NULL"],
      [6, "empty"],
    ] as const) {
      cells[index].click();
      cells[index].dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter" }),
      );
      expect(
        document.querySelector("dialog[open], [role=dialog]:not([hidden])"),
      ).toBeNull();
      expect(cells[index].textContent).toBe(expected);
    }
    const range = document.createRange();
    range.selectNodeContents(cells[1]);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.toString()).toBe("9223372036854775807");
    selection.removeAllRanges();
    expect(cells[2].textContent).toBe("<img src=x onerror=alert(1)>");
    await click("tab-schema");
    expect($("data-panel").hidden).toBe(true);
    expect($("schema-panel").hidden).toBe(false);
    expect(document.querySelectorAll("#schema-body tr")).toHaveLength(3);
    expect($("tab-schema").getAttribute("aria-selected")).toBe("true");
    expect($("sql-panel").hidden).toBe(true);
    await click("tab-explore");
    expect($("tab-explore").textContent).toBe("Explore Data");
    expect($("sql-panel").hidden).toBe(false);
    expect($("data-panel").hidden).toBe(false);
    expect($("schema-panel").hidden).toBe(true);
    expect(document.querySelector("#tab-data, #tab-sql")).toBeNull();
  });

  it("previews local SQL suffixes and inserts only on Tab, without running a query", async () => {
    await open();
    const editor = $<HTMLTextAreaElement>("sql");
    const type = (text: string) => {
      editor.focus();
      editor.value = text;
      editor.setSelectionRange(text.length, text.length);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const press = (key: string, extra: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...extra,
      });
      editor.dispatchEvent(event);
      return event;
    };
    type("select * fro");
    expect($("sql-ghost").textContent).toBe("m");
    expect(editor.value).toBe("select * fro");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    const calls = bridge.call.mock.calls.length;
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(editor.value).toBe("select * from");
    expect(editor.selectionStart).toBe(editor.value.length);
    expect(bridge.call.mock.calls.length).toBe(calls);
    expect(press("Tab").defaultPrevented).toBe(false);
    type("select * from ");
    expect($("sql-ghost").textContent).toBe("data");
    expect(press("Tab", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(editor.value).toBe("select * from ");
    expect(press("Escape").defaultPrevented).toBe(true);
    expect($("sql-ghost").textContent).toBe("");
    editor.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));
    expect($("sql-ghost").textContent).toBe("");
    expect(press("Tab").defaultPrevented).toBe(false);
    type("select * from da");
    expect($("sql-ghost").textContent).toBe("ta");
    editor.setSelectionRange(0, 6);
    editor.dispatchEvent(new Event("select"));
    expect($("sql-ghost").textContent).toBe("");
    type("select ti");
    expect($("sql-ghost").textContent).toBe("me");
    editor.dispatchEvent(new CompositionEvent("compositionstart"));
    expect($("sql-ghost").textContent).toBe("");
    expect(press("Tab", { isComposing: true }).defaultPrevented).toBe(false);
    editor.dispatchEvent(new CompositionEvent("compositionend"));
    expect($("sql-ghost").textContent).toBe("me");
    editor.blur();
    expect($("sql-ghost").textContent).toBe("");
    type("select 'fro");
    expect($("sql-ghost").textContent).toBe("");
    type("select * fro");
    await click("reset-sql");
    expect($("sql-ghost").textContent).toBe("");
  });

  it("paginates, changes page size, toggles sorting and binds literal filters", async () => {
    await open();
    expect($<HTMLButtonElement>("previous").disabled).toBe(true);
    await click("next");
    expect(lastRequest().offset).toBe(100);
    expect($("page-label").textContent).toBe("Page 2");
    expect(document.querySelector("#grid tbody td")!.textContent).toBe("101");
    await click("next");
    expect($<HTMLButtonElement>("next").disabled).toBe(true);
    expect($("result-summary").textContent).toContain("end of results");
    await click("previous");
    expect(lastRequest().offset).toBe(100);
    value("page-size", "50");
    $("page-size").dispatchEvent(new Event("change"));
    await settled();
    expect(lastRequest()).toMatchObject({ offset: 0, limit: 50 });
    for (const desc of [false, true]) {
      document.querySelector<HTMLButtonElement>("#grid th button")!.click();
      await settled();
      expect(lastRequest()).toMatchObject({ sort: "id", desc });
      expect(document.querySelector("#grid th button")!.textContent).toBe(
        `id ${desc ? "↓" : "↑"}`,
      );
    }
    document.querySelectorAll<HTMLButtonElement>("#grid th button")[1].click();
    await settled();
    expect(lastRequest()).toMatchObject({ sort: "text", desc: false });
    value("filter-column", "text");
    value("filter-value", "' OR 1=1 --");
    $("filter-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await settled();
    expect(lastRequest()).toMatchObject({
      filterColumn: "text",
      filterValue: "' OR 1=1 --",
      offset: 0,
    });
    expect($<HTMLSelectElement>("filter-column").value).toBe("text");
    await click("clear-filter");
    expect(lastRequest()).toMatchObject({ filterColumn: "", filterValue: "" });
    expect($<HTMLInputElement>("filter-value").value).toBe("");
  });

  it("keeps keyboard focus on the sorted header and exposes its direction", async () => {
    await open();
    const header = () =>
      document.querySelectorAll<HTMLButtonElement>("#grid th button")[1];
    header().focus();
    for (const desc of [false, true]) {
      header().click();
      await settled();
      expect(lastRequest()).toMatchObject({ sort: "text", desc });
      expect(document.activeElement).toBe(header());
      expect(header().closest("th")!.getAttribute("aria-sort")).toBe(
        desc ? "descending" : "ascending",
      );
      expect(document.querySelectorAll("#grid th[aria-sort]")).toHaveLength(1);
    }
    responses["Workbench.Query"] = () => {
      throw new Error("sort canceled");
    };
    header().click();
    await settled();
    expect(document.activeElement).toBe(header());
    expect(header().closest("th")!.getAttribute("aria-sort")).toBe(
      "descending",
    );
  });

  it("does not reclaim header focus moved while sorting or retain a stale direction", async () => {
    await open();
    let finish!: (r: Result) => void;
    responses["Workbench.Query"] = () =>
      new Promise((resolve) => (finish = resolve));
    const header =
      document.querySelector<HTMLButtonElement>("#grid th button")!;
    header.focus();
    header.click();
    await vi.waitFor(() => expect(finish).toBeDefined());
    $("grid-scroll").focus();
    expect(document.activeElement).toBe($("grid-scroll"));
    finish(page());
    await settled();
    expect(document.activeElement).toBe($("grid-scroll"));
    expect(document.querySelectorAll("#grid th[aria-sort]")).toHaveLength(1);
    responses["Workbench.Query"] = () => page();
    await click("run");
    expect(document.querySelector("#grid th[aria-sort]")).toBeNull();
  });

  it("keeps all wide columns and uses the effective page size in both directions", async () => {
    const wideColumns = Array.from({ length: 257 }, (_, i) => ({
      name: i === 256 ? '末列 " <img>' : `c${i}`,
      type: "BIGINT",
    }));
    responses["Workbench.Open"] = () => ({
      ...dataFile(),
      columns: wideColumns,
    });
    // A small effective limit exercises the backend contract without allocating
    // 128,000 DOM cells in a unit test. Real budget boundaries are engine tests.
    responses["Workbench.Query"] = (r: Request) => ({
      columns: wideColumns,
      rows: Array.from({ length: Math.min(2, 5 - r.offset) }, (_, i) =>
        wideColumns.map((_, j) => String((r.offset + i) * 10000 + j)),
      ),
      pageSize: 2,
      offset: r.offset,
      more: r.offset + 2 < 5,
      elapsedMS: 3,
    });
    await open();
    expect(document.querySelectorAll("#grid th")).toHaveLength(258);
    expect(document.querySelectorAll("#schema-body tr")).toHaveLength(257);
    expect(document.querySelectorAll("#column-list .column-item")).toHaveLength(
      257,
    );
    expect($<HTMLSelectElement>("filter-column").options).toHaveLength(258);
    expect(
      document.querySelector("#grid th:last-child button")!.textContent,
    ).toBe(wideColumns[256].name);
    expect(document.querySelector("#grid img")).toBeNull();
    expect($("page-size-note").hidden).toBe(false);
    expect($("page-size-note").textContent).toContain("2 rows per page");
    await click("next");
    expect(lastRequest()).toMatchObject({ offset: 2, limit: 100 });
    expect($("page-label").textContent).toBe("Page 2");
    expect(
      document.querySelector("#grid tbody tr td:last-child")!.textContent,
    ).toBe("20256");
    await click("next");
    expect(lastRequest().offset).toBe(4);
    expect($("page-label").textContent).toBe("Page 3");
    expect($<HTMLButtonElement>("next").disabled).toBe(true);
    await click("previous");
    expect(lastRequest().offset).toBe(2);
    await click("previous");
    expect(lastRequest().offset).toBe(0);
    document
      .querySelector<HTMLButtonElement>("#grid th:last-child button")!
      .click();
    await settled();
    expect(lastRequest()).toMatchObject({
      sort: wideColumns[256].name,
      offset: 0,
    });
    value("filter-column", wideColumns[256].name);
    value("filter-value", "256");
    $("filter-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await settled();
    expect(lastRequest().filterColumn).toBe(wideColumns[256].name);
    responses["Workbench.Query"] = () => ({ ...page(0, false), pageSize: 100 });
    await click("run");
    expect($("page-size-note").hidden).toBe(true);
  });

  it("commits successful SQL only, preserves the previous page on failure and recovers", async () => {
    await open();
    expect($("sql-panel").hidden).toBe(false);
    expect($("data-panel").hidden).toBe(false);
    await click("next");
    const previous = $("grid").textContent;
    responses["Workbench.Query"] = () => {
      throw new Error("Binder error: <img>");
    };
    value("sql", "SELECT bad");
    await click("run");
    expect($("grid").textContent).toBe(previous);
    expect($("page-label").textContent).toBe("Page 2");
    expect($("notification").textContent).toBe("Binder error: <img>");
    expect($("notification").querySelector("img")).toBeNull();
    responses["Workbench.Query"] = () => null;
    await click("run");
    expect($("notification").textContent).toBe("No query result returned");
    expect($("grid").textContent).toBe(previous);
    responses["Workbench.Query"] = () => {
      throw "bridge disconnected";
    };
    await click("run");
    expect($("notification").textContent).toBe("bridge disconnected");
    responses["Workbench.Query"] = () => ({ ...page(0, false), rows: [] });
    value("sql", "SELECT * FROM data WHERE false");
    await click("run");
    expect(lastRequest()).toMatchObject({
      offset: 0,
      sort: "",
      desc: false,
      filterColumn: "",
      filterValue: "",
    });
    expect($("empty-result").hidden).toBe(false);
    expect($("result-summary").textContent).toBe("0 rows / 3 ms");
    expect($("query-badge").textContent).toBe("SQL result");
    expect($("notification").hidden).toBe(true);
    await click("reset-sql");
    expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT * FROM data");
  });

  it("serializes busy work and cancel leaves a recoverable previous page", async () => {
    await open();
    const previous = $("grid").textContent;
    let reject!: (reason: Error) => void;
    responses["Workbench.Query"] = () =>
      new Promise((_, fail) => {
        reject = fail;
      });
    $("run").click();
    expect($("busy").hidden).toBe(false);
    expect($<HTMLButtonElement>("cancel").disabled).toBe(false);
    expect($<HTMLButtonElement>("open").disabled).toBe(true);
    const count = bridge.call.mock.calls.length;
    key("o", { metaKey: true });
    bridge.drop!({ paths: ["/another.parquet"] });
    expect(bridge.call.mock.calls.length).toBe(count);
    $("cancel").click();
    expect(bridge.call).toHaveBeenLastCalledWith("Workbench.Cancel");
    reject(new Error("context canceled"));
    await settled();
    expect($("grid").textContent).toBe(previous);
    expect($<HTMLButtonElement>("open").disabled).toBe(false);
    expect($("notification").textContent).toBe("context canceled");
    responses["Workbench.Query"] = () => page();
    await click("run");
    expect($("notification").hidden).toBe(true);
  });

  it("accepts welcome drops only inside the box, using native coordinates after feedback clears", async () => {
    await boot();
    const zone = $("welcome-drop-zone");
    vi.spyOn(zone, "getBoundingClientRect").mockReturnValue({
      left: 200,
      top: 100,
      right: 800,
      bottom: 500,
      width: 600,
      height: 400,
    } as DOMRect);
    const drag = (
      type: string,
      x = 300,
      y = 200,
      target: HTMLElement = zone,
      types = ["Files"],
    ) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        relatedTarget: $("welcome-data"),
      });
      Object.defineProperty(event, "dataTransfer", { value: { types } });
      target.dispatchEvent(event);
      return event;
    };
    const active = () => zone.classList.contains("drag-active");
    drag("dragenter", 10, 20, $("app"));
    expect(active()).toBe(false);
    expect(drag("dragover").defaultPrevented).toBe(false);
    expect(active()).toBe(true);
    expect($("welcome-drop-title").textContent).toBe("Release to open Parquet");
    expect($("drop-feedback").hidden).toBe(true);
    drag("dragenter", 310, 210, $("welcome-data"));
    drag("dragleave", 310, 210, zone);
    expect(active()).toBe(true);
    drag("dragover", 801, 200, $("app"));
    expect(active()).toBe(false);
    const calls = bridge.call.mock.calls.length;
    for (const [x, y] of [
      [199, 200],
      [800, 200],
      [300, 99],
      [300, 500],
      [NaN, 200],
    ])
      bridge.drop!({ paths: ["/outside.parquet"], x, y });
    bridge.drop!({ paths: ["/missing-coordinates.parquet"] });
    expect(bridge.call.mock.calls.length).toBe(calls);
    drag("dragover");
    key("Escape");
    expect(active()).toBe(false);
    drag("dragover");
    drag("dragend");
    expect(active()).toBe(false);
    drag("dragenter", 300, 200, zone, ["text/plain"]);
    expect(active()).toBe(false);
    await click("settings");
    drag("dragover");
    expect(active()).toBe(false);
    bridge.drop!({ paths: ["/blocked.parquet"], x: 300, y: 200 });
    expect(bridge.call).not.toHaveBeenCalledWith(
      "Workbench.OpenPath",
      "/blocked.parquet",
    );
    $("settings-dismiss").click();
    drag("dragover");
    expect(active()).toBe(true);
    expect(drag("drop").defaultPrevented).toBe(false);
    expect(active()).toBe(false);
    bridge.drop!({ paths: ["/inside.parquet"], x: 300, y: 200 });
    await settled();
    expect(bridge.call).toHaveBeenCalledWith(
      "Workbench.OpenPath",
      "/inside.parquet",
    );
    expect($("welcome").hidden).toBe(true);
  });

  it("shows stable file-drag feedback without taking over native drop handling", async () => {
    await open();
    const drag = (
      type: string,
      target: HTMLElement = $("app"),
      types = ["Files"],
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: { types } });
      target.dispatchEvent(event);
      return event;
    };
    drag("dragenter", $("app"), ["text/plain"]);
    expect($("drop-feedback").hidden).toBe(true);
    expect(drag("dragenter").defaultPrevented).toBe(false);
    expect($("drop-feedback").hidden).toBe(false);
    drag("dragenter", $("open-data"));
    drag("dragleave", $("open-data"));
    expect($("drop-feedback").hidden).toBe(false);
    expect(drag("dragover").defaultPrevented).toBe(false);
    drag("dragleave");
    expect($("drop-feedback").hidden).toBe(true);
    drag("dragenter");
    key("Escape");
    expect($("drop-feedback").hidden).toBe(true);
    drag("dragenter");
    expect(drag("drop").defaultPrevented).toBe(false);
    expect($("drop-feedback").hidden).toBe(true);
    drag("dragenter");
    bridge.drop!({ paths: ["/drop.parquet"] });
    await settled();
    expect($("drop-feedback").hidden).toBe(true);
    expect(bridge.call).toHaveBeenCalledWith(
      "Workbench.OpenPath",
      "/drop.parquet",
    );
    await click("open-data");
    drag("dragenter");
    expect($("drop-feedback").hidden).toBe(false);
    drag("dragend");
    expect($("drop-feedback").hidden).toBe(true);
    $<HTMLDialogElement>("source-dialog").close();
    await click("export");
    drag("dragenter");
    expect($("drop-feedback").hidden).toBe(true);
  });

  it("opens initial and dropped paths, handles shortcuts and preserves state after failed open", async () => {
    responses["Workbench.InitialFile"] = () => "/initial.parquet";
    responses["Workbench.OpenPath"] = () => dataFile("42");
    await boot();
    expect(bridge.call).toHaveBeenCalledWith(
      "Workbench.OpenPath",
      "/initial.parquet",
    );
    expect($("file-size").textContent).toBe("42 B");
    const count = bridge.call.mock.calls.length;
    bridge.drop!({ paths: [] });
    expect(bridge.call.mock.calls.length).toBe(count);
    responses["Workbench.OpenPath"] = () => dataFile("1048576");
    bridge.drop!({ paths: ["/drop.parquet", "/ignored.parquet"] });
    await settled();
    expect(bridge.call).toHaveBeenCalledWith(
      "Workbench.OpenPath",
      "/drop.parquet",
    );
    expect($("file-size").textContent).toBe("1.0 MB");
    responses["Workbench.OpenPath"] = () => {
      throw new Error("bad file");
    };
    const previous = $("grid").textContent;
    bridge.drop!({ paths: ["/bad.parquet"] });
    await settled();
    expect($("grid").textContent).toBe(previous);
    expect(key("O", { ctrlKey: true }).defaultPrevented).toBe(true);
    await settled();
    expect(bridge.call).toHaveBeenCalledWith("Workbench.Open");
    value("sql", "SELECT 1");
    expect(key("Enter", { metaKey: true }).defaultPrevented).toBe(true);
    await settled();
    expect(lastRequest().sql).toBe("SELECT 1");
    expect(key("x").defaultPrevented).toBe(false);
  });

  it("reports initialization bridge failures and can subsequently open a file", async () => {
    responses["Workbench.InitialFile"] = () => {
      throw new Error("IPC initialization failed");
    };
    await boot();
    expect($("notification").textContent).toBe(
      "Error: IPC initialization failed",
    );
    await click("open");
    expect($("workspace").hidden).toBe(false);
  });

  it("reports exports, cancel and save failure while keeping the visible result", async () => {
    await open();
    const previous = $("grid").textContent;
    await click("export");
    expect($<HTMLDialogElement>("export-dialog").open).toBe(true);
    expect(bridge.call).not.toHaveBeenCalledWith(
      "Workbench.ExportPageAs",
      expect.anything(),
    );
    expect(key("Enter", { metaKey: true }).defaultPrevented).toBe(true);
    await click("export-dismiss");
    expect($<HTMLDialogElement>("export-dialog").open).toBe(false);
    await click("export");
    await click("export-json");
    expect($("notification").textContent).toBe(
      "Exported visible page to /local/page.json",
    );
    expect(bridge.call).toHaveBeenCalledWith("Workbench.ExportPageAs", "json");
    await click("export");
    await click("export-csv");
    expect($("notification").textContent).toBe(
      "Exported visible page to /local/page.csv",
    );
    expect(bridge.call).toHaveBeenCalledWith("Workbench.ExportPageAs", "csv");
    responses["Workbench.ExportPageAs"] = () => "";
    await click("export");
    await click("export-csv");
    expect($("notification").hidden).toBe(true);
    responses["Workbench.ExportPageAs"] = () => {
      throw new Error("choose a new filename");
    };
    await click("export");
    await click("export-json");
    expect($("notification").textContent).toBe("choose a new filename");
    expect($("grid").textContent).toBe(previous);
  });
});

const workspaceInfo = { root: "/analysis", name: "Research <img>", active: "" };
function folderResponses() {
  responses["Workbench.OpenWorkspace"] = () => workspaceInfo;
  responses["Workbench.ListDirectory"] = (
    _root: string,
    rel: string,
    offset: number,
  ) => ({
    entries:
      rel === "." && offset === 0
        ? [
            { name: "nested", path: "nested", directory: true },
            {
              name: "orders.parquet",
              path: "orders.parquet",
              directory: false,
            },
          ]
        : [],
    next: 200,
    more: rel === "." && offset === 0,
  });
  responses["Workbench.OpenWorkspaceFile"] = () => ({
    file: {
      ...dataFile(),
      name: "orders.parquet",
      path: "/analysis/orders.parquet",
    },
    query: { draft: "SELECT draft", applied: "SELECT 7" },
    warning: "",
  });
  responses["Workbench.SaveWorkspaceQuery"] = () => undefined;
  responses["Workbench.RenameWorkspace"] = (root: string, name: string) => ({
    ...workspaceInfo,
    root,
    name,
  });
  responses["Workbench.CloseWorkspace"] = () => undefined;
}
async function treeFile() {
  document.querySelector<HTMLButtonElement>(".tree-file")!.click();
  await settled();
}

describe("folder workspaces", () => {
  it("collapses workspaces independently without changing the preview and keeps actions available", async () => {
    folderResponses();
    await boot();
    await click("open-folder");
    await treeFile();
    const panel = document.querySelector<HTMLElement>(".workspace-group")!;
    const toggle = panel.querySelector<HTMLButtonElement>(
      '[data-control="folder-toggle"]',
    )!;
    const tree = panel.querySelector<HTMLElement>(".folder-tree")!;
    const path = panel.querySelector<HTMLElement>(".folder-path")!;
    const sql = $<HTMLTextAreaElement>("sql").value;
    const breadcrumb = $("breadcrumb").textContent;
    const calls = bridge.call.mock.calls.length;
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Expand workspace");
    expect(tree.hidden).toBe(true);
    expect(path.hidden).toBe(true);
    expect($<HTMLTextAreaElement>("sql").value).toBe(sql);
    expect($("breadcrumb").textContent).toBe(breadcrumb);
    expect(bridge.call.mock.calls.length).toBe(calls);
    await click("folder-refresh");
    expect(tree.hidden).toBe(true);
    await click("folder-rename");
    expect($("folder-rename-form").hidden).toBe(false);
    await click("folder-rename-cancel");
    responses["Workbench.OpenWorkspace"] = () => ({
      ...workspaceInfo,
      root: "/second",
      name: "Second",
    });
    await click("open-folder");
    const toggles = document.querySelectorAll('[data-control="folder-toggle"]');
    expect(toggles).toHaveLength(2);
    expect(toggles[1].getAttribute("aria-expanded")).toBe("true");
    expect(toggles[1].getAttribute("aria-controls")).not.toBe(
      toggle.getAttribute("aria-controls"),
    );
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(tree.hidden).toBe(false);
    expect(path.hidden).toBe(false);
    expect(tree.textContent).toContain("orders.parquet");
    toggle.click();
    await click("folder-close");
    expect(document.querySelectorAll(".workspace-group")).toHaveLength(1);
  });

  it("suggests workspace tables before opening files and fields after their schema is known", async () => {
    folderResponses();
    await boot();
    await click("open-folder");
    const editor = $<HTMLTextAreaElement>("sql");
    const type = (sql: string) => {
      editor.focus();
      editor.value = sql;
      editor.setSelectionRange(sql.length, sql.length);
      editor.dispatchEvent(new Event("input"));
    };
    type('SELECT * FROM workspace."ord');
    expect($("sql-ghost").textContent).toBe('ers.parquet"');
    const queries = bridge.call.mock.calls.filter(
      ([name]) => name === "Workbench.QueryWorkspace",
    ).length;
    editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", cancelable: true }),
    );
    expect(editor.value).toBe('SELECT * FROM workspace."orders.parquet"');
    expect(
      bridge.call.mock.calls.filter(
        ([name]) => name === "Workbench.QueryWorkspace",
      ),
    ).toHaveLength(queries);
    await treeFile();
    type('SELECT * FROM workspace."orders.parquet" o WHERE o.ti');
    expect($("sql-ghost").textContent).toBe("me");
    editor.blur();
  });

  it("browses lazy directories, renames safely and restores per-file SQL", async () => {
    folderResponses();
    await boot();
    await click("open-folder");
    expect($("folder-name").textContent).toBe("Research <img>");
    expect($("folder-panel").querySelector("img")).toBeNull();
    expect($("workspace").hidden).toBe(false);
    expect($("folder-panel").hidden).toBe(false);
    const directory =
      document.querySelector<HTMLButtonElement>(".tree-folder")!;
    directory.click();
    await settled();
    expect(directory.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".tree-children")!.textContent).toContain(
      "No visible",
    );
    directory.click();
    await settled();
    expect(directory.getAttribute("aria-expanded")).toBe("false");
    document.querySelector<HTMLButtonElement>(".tree-more")!.click();
    await settled();
    expect(document.querySelector(".tree-more")).toBeNull();
    await click("folder-refresh");
    await treeFile();
    expect(lastRequest().sql).toBe("SELECT 7");
    expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT draft");
    expect($("breadcrumb").textContent).toBe("orders.parquet");
    expect(document.querySelector(".tree-file.selected")).not.toBeNull();
    value("sql", "SELECT 9");
    $("sql").dispatchEvent(new Event("input"));
    expect($("query-save").textContent).toBe("Unsaved changes");
    await vi.waitFor(() =>
      expect($("query-save").textContent).toBe("Saved locally"),
    );
    expect(bridge.call).toHaveBeenCalledWith(
      "Workbench.SaveWorkspaceQuery",
      "/analysis",
      "orders.parquet",
      "SELECT 9",
      "SELECT 7",
    );
    await click("run");
    expect(bridge.call).toHaveBeenCalledWith(
      "Workbench.SaveWorkspaceQuery",
      "/analysis",
      "orders.parquet",
      "SELECT 9",
      "SELECT 9",
    );
    await click("reset-sql");
    $("sql").dispatchEvent(new Event("blur"));
    await vi.waitFor(() =>
      expect($("query-save").textContent).toBe("Saved locally"),
    );
    await click("folder-rename");
    expect(document.activeElement!.getAttribute("data-control")).toBe(
      "folder-name-input",
    );
    await click("folder-rename-cancel");
    expect($("folder-rename-form").hidden).toBe(true);
    await click("folder-rename");
    value("folder-name-input", "My analysis");
    $("folder-rename-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await settled();
    expect($("scope-name").textContent).toBe("My analysis");
    await click("folder-close");
    expect($("folder-panel").hidden).toBe(true);
    expect($("scope-name").textContent).toBe("File");
    expect($("breadcrumb").textContent).toBe("Welcome");
  });
  it("restores a workspace draft without executing its historical query", async () => {
    folderResponses();
    responses["Workbench.RestoreWorkspaces"] = () => ({
      workspaces: [{ ...workspaceInfo, active: "orders.parquet" }],
      warning: "",
    });
    responses["Workbench.Query"] = (r: Request) => {
      if (r.sql === "SELECT 7") throw new Error("missing column");
      return page();
    };
    await boot();
    expect(lastRequest().sql).toBe("SELECT * FROM data");
    expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT draft");
    expect(
      bridge.call.mock.calls
        .filter(([name]) => name === "Workbench.Query")
        .every(([, r]) => r.sql === "SELECT * FROM data"),
    ).toBe(true);
    responses["Workbench.OpenWorkspaceFile"] = () => ({
      file: {
        ...dataFile(),
        name: "orders.parquet",
        path: "/analysis/orders.parquet",
      },
      query: { draft: "", applied: "" },
      warning: "Recent-file state not saved",
    });
    await treeFile();
    expect($("notification").textContent).toBe("Recent-file state not saved");
    responses["Workbench.Open"] = () => null;
    await click("open");
    expect($("folder-panel").hidden).toBe(false);
    responses["Workbench.Open"] = () => dataFile();
    await click("open");
    expect($("folder-panel").hidden).toBe(false);
    expect($("scope-name").textContent).toBe("File");
    $("sql").dispatchEvent(new Event("input"));
  });
  it("handles missing folders/files and keeps previous data on failed file selection", async () => {
    folderResponses();
    responses["Workbench.RestoreWorkspaces"] = () => ({
      workspaces: [{ ...workspaceInfo, active: "gone.parquet" }],
      warning: "",
    });
    responses["Workbench.OpenWorkspaceFile"] = () => {
      throw new Error("file removed");
    };
    await boot();
    expect($("notification").textContent).toContain("Last file is unavailable");
    expect($("welcome").hidden).toBe(false);
    await click("folder-close");
    expect($("breadcrumb").textContent).toBe("Welcome");
    responses["Workbench.OpenWorkspace"] = () => null;
    await click("open-folder");
    expect($("folder-panel").hidden).toBe(true);
    responses["Workbench.OpenWorkspace"] = () => {
      throw new Error("folder access denied");
    };
    await click("open-folder");
    expect($("notification").textContent).toBe("folder access denied");
    responses["Workbench.OpenWorkspace"] = () => workspaceInfo;
    await click("open-folder");
    responses["Workbench.OpenWorkspaceFile"] = () => null;
    await treeFile();
    expect($("notification").textContent).toBe("No file returned");
    responses["Workbench.OpenWorkspaceFile"] = () => ({
      file: {
        ...dataFile(),
        name: "orders.parquet",
        path: "/analysis/orders.parquet",
      },
      query: { draft: "", applied: "" },
      warning: "",
    });
    await treeFile();
    const previous = $("grid").textContent;
    responses["Workbench.OpenWorkspaceFile"] = () => {
      throw new Error("bad parquet");
    };
    await treeFile();
    expect($("grid").textContent).toBe(previous);
    responses["Workbench.ListDirectory"] = () => null;
    await click("folder-refresh");
    expect($("notification").textContent).toBe("No directory listing returned");
    responses["Workbench.RenameWorkspace"] = () => null;
    await click("folder-rename");
    $("folder-rename-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await settled();
    expect($("notification").textContent).toBe("No workspace returned");
  });
  it("reports failed saves, blocks a losing switch, and can recover", async () => {
    folderResponses();
    await boot();
    await click("open-folder");
    await treeFile();
    responses["Workbench.SaveWorkspaceQuery"] = () => {
      throw new Error("disk full");
    };
    value("sql", "SELECT important_draft");
    $("sql").dispatchEvent(new Event("input"));
    await vi.waitFor(() =>
      expect($("query-save").textContent).toBe("Not saved"),
    );
    expect($("notification").textContent).toContain("Could not save query");
    const count = bridge.call.mock.calls.filter(
      ([n]) => n === "Workbench.Open",
    ).length;
    await click("open");
    expect(
      bridge.call.mock.calls.filter(([n]) => n === "Workbench.Open"),
    ).toHaveLength(count);
    responses["Workbench.SaveWorkspaceQuery"] = () => undefined;
    await treeFile();
    expect($("query-save").textContent).toBe("Saved locally");
  });
});

const openedRows = () => [
  ...document.querySelectorAll<HTMLElement>(".opened-file"),
];
async function openedAction(path: string, action = "activate-file") {
  const row = openedRows().find((r) => r.dataset.path === path)!;
  row.querySelector<HTMLButtonElement>(`.${action}`)!.click();
  await settled();
}
describe("multiple open files and workspaces", () => {
  it("retains independent drafts, paging and schema while switching; closes inactive, active and last files", async () => {
    const a = { ...dataFile(), name: "a.parquet", path: "/outside/a.parquet" };
    const b = { ...dataFile(), name: "b.parquet", path: "/outside/b.parquet" };
    const c = { ...dataFile(), name: "c.parquet", path: "/outside/c.parquet" };
    responses["Workbench.Open"] = () => a;
    responses["Workbench.OpenPath"] = (path: string) =>
      [a, b, c].find((f) => f.path === path);
    await open();
    expect($("open-data").hidden).toBe(false);
    expect($("columns-label").hidden).toBe(false);
    expect($("column-list").hidden).toBe(false);
    value("sql", "SELECT draft_a");
    $("sql").dispatchEvent(new Event("input"));
    await click("next");
    await click("tab-schema");
    responses["Workbench.Open"] = () => b;
    await click("open");
    expect(openedRows()).toHaveLength(2);
    expect($("schema-panel").hidden).toBe(true);
    value("sql", "SELECT draft_b");
    $("sql").dispatchEvent(new Event("input"));
    await openedAction(a.path);
    expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT draft_a");
    expect(lastRequest().offset).toBe(100);
    expect($("schema-panel").hidden).toBe(false);
    await openedAction(b.path);
    expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT draft_b");
    expect(lastRequest().offset).toBe(0);
    await click("open");
    expect(openedRows()).toHaveLength(2); // no duplicate on repeated opening
    responses["Workbench.Open"] = () => c;
    await click("open");
    const queries = bridge.call.mock.calls.filter(
      ([n]) => n === "Workbench.Query",
    ).length;
    await openedAction(b.path, "close-file");
    expect(openedRows()).toHaveLength(2);
    expect(
      bridge.call.mock.calls.filter(([n]) => n === "Workbench.Query"),
    ).toHaveLength(queries);
    await openedAction(a.path);
    await openedAction(a.path, "close-file");
    expect($("file-name").textContent).toBe("c.parquet");
    await openedAction(c.path, "close-file");
    expect($("open-data").hidden).toBe(true);
    expect($("columns-label").hidden).toBe(true);
    expect($("column-list").hidden).toBe(true);
    expect(openedRows()).toHaveLength(0);
    expect($("welcome").hidden).toBe(false);
    expect($<HTMLButtonElement>("export").disabled).toBe(true);
    expect(bridge.call).toHaveBeenCalledWith("Workbench.ClearPreview");
  });
  it("keeps several roots, classifies boundary paths, deduplicates folders, and closes workspace files while keeping outside files", async () => {
    folderResponses();
    await boot();
    await click("open-folder");
    await treeFile();
    responses["Workbench.OpenWorkspace"] = () => ({
      root: "/second",
      name: "Second",
      active: "",
    });
    await click("open-folder");
    expect(document.querySelectorAll(".workspace-group")).toHaveLength(2);
    expect($("file-name").textContent).toBe("Second");
    expect(openedRows()).toHaveLength(1);
    await click("open-folder");
    expect(document.querySelectorAll(".workspace-group")).toHaveLength(2);
    const external = {
      ...dataFile(),
      name: "outside.parquet",
      path: "/analysis-other/outside.parquet",
    };
    responses["Workbench.Open"] = () => external;
    await click("open");
    expect(document.querySelector(".external-files")!.textContent).toContain(
      "outside.parquet",
    );
    expect(openedRows()).toHaveLength(2);
    expect(document.querySelectorAll(".workspace-group")).toHaveLength(2);
    responses["Workbench.Open"] = () => ({
      ...dataFile(),
      name: "orders.parquet",
      path: "/analysis/orders.parquet",
    });
    await click("open");
    expect(openedRows()).toHaveLength(2);
    expect($("scope-name").textContent).toBe(workspaceInfo.name);
    responses["Workbench.OpenPath"] = () => external;
    await click("folder-close");
    expect(document.querySelectorAll(".workspace-group")).toHaveLength(1);
    expect(openedRows()).toHaveLength(1);
    expect(
      document.querySelectorAll(".external-files .opened-file"),
    ).toHaveLength(1);
    expect($("scope-name").textContent).toBe("File");
    expect($("file-name").textContent).toBe("outside.parquet");
  });
  it("groups previously external files when a matching folder opens, chooses deepest nested root and reports restore warnings", async () => {
    folderResponses();
    responses["Workbench.RestoreWorkspaces"] = () => ({
      workspaces: [],
      warning: "One folder is unavailable",
    });
    responses["Workbench.Open"] = () => ({
      ...dataFile(),
      name: "nested.parquet",
      path: "/analysis/nested/nested.parquet",
    });
    responses["Workbench.OpenWorkspaceFile"] = (
      root: string,
      relative: string,
    ) => ({
      file: {
        ...dataFile(),
        name: "nested.parquet",
        path: root + "/" + relative,
      },
      query: { draft: "SELECT * FROM data", applied: "SELECT * FROM data" },
      warning: "",
    });
    await open();
    expect($("scope-name").textContent).toBe("File");
    await click("open-folder");
    expect(document.querySelector(".external-files")).toBeNull();
    responses["Workbench.OpenWorkspace"] = () => ({
      root: "/analysis/nested",
      name: "Nested",
      active: "",
    });
    await click("open-folder");
    expect($("scope-name").textContent).toBe("Nested");
    responses["Workbench.OpenWorkspace"] = () => ({
      root: "/",
      name: "Root",
      active: "",
    });
    await click("open-folder");
    expect($("scope-name").textContent).toBe("Root");
    await click("open");
    expect($("scope-name").textContent).toBe("Nested");
    const nestedPanel = [
      ...document.querySelectorAll<HTMLElement>(".workspace-group"),
    ].find((p) => p.dataset.root === "/analysis/nested")!;
    nestedPanel
      .querySelector<HTMLButtonElement>('[data-control="folder-close"]')!
      .click();
    await settled();
    expect($("welcome").hidden).toBe(true);
    expect($("workspace").hidden).toBe(false);
    expect($("open-files-panel").hidden).toBe(true);
    expect(openedRows()).toHaveLength(0);
    expect(document.querySelectorAll(".workspace-group")).toHaveLength(2);
  });
  it("shows workspace files only in the tree, retains tree close controls after refresh, and hides an empty outside list", async () => {
    folderResponses();
    await boot();
    await click("open-folder");
    await treeFile();
    expect($("open-files-panel").hidden).toBe(true);
    expect($("open-files").children).toHaveLength(0);
    expect(
      document.querySelectorAll(".tree-file-row .close-file"),
    ).toHaveLength(1);
    await click("folder-refresh");
    expect(
      document.querySelectorAll(".tree-file-row .close-file"),
    ).toHaveLength(1);
    await openedAction("/analysis/orders.parquet", "close-file");
    expect(
      document.querySelectorAll(".tree-file-row .close-file"),
    ).toHaveLength(0);
    expect(document.querySelector(".tree-file")).not.toBeNull();
    expect($("welcome").hidden).toBe(true);
    expect($("workspace").hidden).toBe(false);
    await treeFile();
    expect($("workspace").hidden).toBe(false);
    expect($("open-files-panel").hidden).toBe(true);
    responses["Workbench.Open"] = () => ({
      ...dataFile(),
      name: "outside.parquet",
      path: "/outside.parquet",
    });
    await click("open");
    expect($("open-files-panel").hidden).toBe(false);
    expect($("open-files").querySelectorAll(".opened-file")).toHaveLength(1);
    await openedAction("/outside.parquet", "close-file");
    expect($("open-files-panel").hidden).toBe(true);
    expect($("file-name").textContent).toBe("orders.parquet");
  });
  it("closes all files owned by a workspace atomically and preserves unrelated active files", async () => {
    folderResponses();
    await boot();
    await click("open-folder");
    await treeFile();
    responses["Workbench.Open"] = () => ({
      ...dataFile(),
      name: "second.parquet",
      path: "/analysis/second.parquet",
    });
    responses["Workbench.OpenWorkspaceFile"] = (
      _root: string,
      path: string,
    ) => ({
      file: { ...dataFile(), name: path, path: "/analysis/" + path },
      query: { draft: "SELECT * FROM data", applied: "SELECT * FROM data" },
      warning: "",
    });
    await click("open");
    const outside = {
      ...dataFile(),
      name: "outside.parquet",
      path: "/outside.parquet",
    };
    responses["Workbench.Open"] = () => outside;
    await click("open");
    const count = bridge.call.mock.calls.filter(
      ([n]) => n === "Workbench.Query",
    ).length;
    responses["Workbench.CloseWorkspace"] = () => {
      throw new Error("settings write failed");
    };
    await click("folder-close");
    expect(document.querySelectorAll(".workspace-group")).toHaveLength(1);
    expect($("notification").textContent).toBe("settings write failed");
    responses["Workbench.CloseWorkspace"] = () => undefined;
    await click("folder-close");
    expect(openedRows()).toHaveLength(1);
    expect(openedRows()[0].dataset.path).toBe(outside.path);
    expect($("file-name").textContent).toBe("outside.parquet");
    expect(
      bridge.call.mock.calls.filter(([n]) => n === "Workbench.Query"),
    ).toHaveLength(count);
    await openedAction(outside.path, "close-file");
    expect($("welcome").hidden).toBe(false);
    expect(openedRows()).toHaveLength(0);
  });
  it("keeps the old preview intact until the next file result is ready and commits atomically", async () => {
    const a = { ...dataFile(), name: "a.parquet", path: "/a.parquet" },
      b = { ...dataFile(), name: "b.parquet", path: "/b.parquet" };
    responses["Workbench.Open"] = () => a;
    await open();
    await click("tab-schema");
    const oldTable = $("grid").textContent;
    let finish!: (r: Result) => void;
    responses["Workbench.Open"] = () => b;
    responses["Workbench.Query"] = () =>
      new Promise<Result>((resolve) => {
        finish = resolve;
      });
    $("open").click();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect($("file-name").textContent).toBe("a.parquet");
    expect($("grid").textContent).toBe(oldTable);
    expect($("schema-panel").hidden).toBe(false);
    expect(document.body.classList.contains("is-busy")).toBe(true);
    finish({ ...page(), rows: [["b-row", "new", "time"]] });
    await settled();
    expect($("file-name").textContent).toBe("b.parquet");
    expect($("grid").textContent).toContain("b-row");
    expect($("schema-panel").hidden).toBe(true);
    expect(document.body.classList.contains("is-busy")).toBe(false);
    responses["Workbench.Open"] = () => a;
    responses["Workbench.Query"] = () => {
      throw new Error("preview unavailable");
    };
    await click("open");
    expect($("file-name").textContent).toBe("a.parquet");
    expect($("grid").querySelectorAll("tbody tr")).toHaveLength(0);
    expect($<HTMLButtonElement>("export").disabled).toBe(true);
    expect($("notification").textContent).toBe("preview unavailable");
  });
  it("keeps surviving files available if a neighbor disappears during close", async () => {
    const a = { ...dataFile(), name: "a", path: "/a.parquet" },
      b = { ...dataFile(), name: "b", path: "/b.parquet" };
    responses["Workbench.Open"] = () => a;
    await open();
    responses["Workbench.Open"] = () => b;
    await click("open");
    responses["Workbench.OpenPath"] = () => {
      throw new Error("missing file");
    };
    await openedAction(b.path, "close-file");
    expect($("notification").textContent).toContain(
      "File closed. Choose another file",
    );
    expect(openedRows()).toHaveLength(1);
    expect($("welcome").hidden).toBe(false);
    responses["Workbench.OpenPath"] = () => null;
    await openedAction(a.path);
    expect($("notification").textContent).toBe("No file returned");
    responses["Workbench.OpenPath"] = () => a;
    await openedAction(a.path);
    expect($("workspace").hidden).toBe(false);
  });
});

it("offers safely quoted workspace tables and inserts at the cursor without running SQL", async () => {
  const name = '竹 " <img>.parquet';
  const f = { ...dataFile(), path: "/root/" + name, name };
  responses["Workbench.RestoreWorkspaces"] = () => ({
    workspaces: [{ root: "/root", name: "Root", active: name }],
    warning: "",
  });
  responses["Workbench.ListDirectory"] = () => ({
    entries: [
      { name, path: name, directory: false },
      { name: "other.parquet", path: "other.parquet", directory: false },
    ],
    more: false,
    next: 2,
  });
  responses["Workbench.OpenWorkspaceFile"] = () => ({
    file: f,
    query: { draft: "SELECT * FROM data", applied: "SELECT * FROM data" },
    warning: "",
  });
  responses["Workbench.SaveWorkspaceQuery"] = () => undefined;
  await boot();
  expect($("workspace-tables").hidden).toBe(false);
  const editor = $<HTMLTextAreaElement>("sql");
  editor.value = "SELECT * FROM data";
  editor.setSelectionRange(14, 18);
  const before = bridge.call.mock.calls.filter(
    ([name]) => name === "Workbench.Query",
  ).length;
  document.querySelector<HTMLButtonElement>(".table-reference")!.click();
  expect(editor.value).toBe('SELECT * FROM workspace."竹 "" <img>.parquet"');
  expect(document.querySelector("#workspace-table-list img")).toBeNull();
  expect(
    bridge.call.mock.calls.filter(([name]) => name === "Workbench.Query"),
  ).toHaveLength(before);
  await click("run");
  expect(lastRequest().sql).toBe(editor.value);
  responses["Workbench.Open"] = () => dataFile();
  await click("open");
  expect($("workspace-tables").hidden).toBe(true);
});

it("queries without opening a file, keeps independent drafts, and returns to the editor on last-file close", async () => {
  folderResponses();
  await boot();
  await click("open-folder");
  expect($("welcome").hidden).toBe(true);
  expect($("workspace").hidden).toBe(false);
  expect($("file-name").textContent).toBe(workspaceInfo.name);
  expect($<HTMLButtonElement>("run").disabled).toBe(true);
  expect(
    bridge.call.mock.calls.some(
      ([name]) => name === "Workbench.OpenWorkspaceFile",
    ),
  ).toBe(false);
  value("sql", 'SELECT * FROM workspace."orders.parquet"');
  $("sql").dispatchEvent(new Event("input"));
  key("Enter", { metaKey: true });
  await settled();
  expect(bridge.call).toHaveBeenCalledWith(
    "Workbench.QueryWorkspace",
    "/analysis",
    expect.objectContaining({
      sql: 'SELECT * FROM workspace."orders.parquet"',
    }),
  );
  expect(bridge.call).toHaveBeenCalledWith(
    "Workbench.SaveWorkspaceQuery",
    "/analysis",
    ".",
    expect.any(String),
    expect.any(String),
  );
  expect($<HTMLButtonElement>("export").disabled).toBe(false);
  await click("next");
  expect(bridge.call).toHaveBeenLastCalledWith(
    "Workbench.QueryWorkspace",
    "/analysis",
    expect.objectContaining({ offset: 100 }),
  );
  value("sql", "SELECT draft");
  $("sql").dispatchEvent(new Event("input"));
  await treeFile();
  expect($("breadcrumb").textContent).toBe("orders.parquet");
  await click("folder-name");
  expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT draft");
  expect($("page-label").textContent).toBe("Page 2");
  await treeFile();
  document.querySelector<HTMLButtonElement>(".close-file")!.click();
  await settled();
  expect($("welcome").hidden).toBe(true);
  expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT draft");
  await click("reset-sql");
  expect($<HTMLTextAreaElement>("sql").value).toBe("");
  responses["Workbench.QueryWorkspace"] = () => null;
  value("sql", "SELECT 1");
  $("sql").dispatchEvent(new Event("input"));
  await click("run");
  expect($("notification").textContent).toBe("No query result returned");
  responses["Workbench.QueryWorkspace"] = () => {
    throw new Error("table removed");
  };
  await click("folder-name");
  expect($("notification").textContent).toContain("Draft preserved");
  expect($<HTMLButtonElement>("export").disabled).toBe(true);
  await click("folder-close");
  expect($("welcome").hidden).toBe(false);
});

it("restores a workspace-level query directly and keeps multiple workspace drafts separate", async () => {
  folderResponses();
  responses["Workbench.RestoreWorkspaces"] = () => ({
    workspaces: [{ ...workspaceInfo, active: "." }],
    warning: "",
  });
  responses["Workbench.OpenWorkspaceQuery"] = () => ({
    draft: "SELECT 42",
    applied: "SELECT 42",
  });
  await boot();
  expect(
    bridge.call.mock.calls.some(
      ([name]) => name === "Workbench.QueryWorkspace",
    ),
  ).toBe(false);
  expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT 42");
  responses["Workbench.OpenWorkspace"] = () => ({
    root: "/second",
    name: "Second",
    active: "",
  });
  responses["Workbench.OpenWorkspaceQuery"] = () => ({
    draft: "",
    applied: "",
  });
  await click("open-folder");
  expect(bridge.call).toHaveBeenCalledWith(
    "Workbench.SaveWorkspaceQuery",
    "/analysis",
    ".",
    "SELECT 42",
    "SELECT 42",
  );
  expect($<HTMLTextAreaElement>("sql").value).toBe("");
  value("sql", "SELECT 7");
  $("sql").dispatchEvent(new Event("input"));
  await click("run");
  await click("folder-name");
  expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT 42");
  expect(document.querySelectorAll(".opened-file")).toHaveLength(0);
});

it("keeps the last file's workspace selected and distinguishes an empty query result from an unrun editor", async () => {
  folderResponses();
  await boot();
  await click("open-folder");
  responses["Workbench.OpenWorkspace"] = () => ({
    root: "/second",
    name: "Second",
    active: "",
  });
  await click("open-folder");
  responses["Workbench.OpenWorkspaceFile"] = (root: string, path: string) => ({
    file: { ...dataFile(), name: path, path: root + "/" + path },
    query: { draft: "SELECT * FROM data", applied: "SELECT * FROM data" },
    warning: "",
  });
  document
    .querySelector<HTMLButtonElement>('.tree-file[data-root="/second"]')!
    .click();
  await settled();
  document.querySelector<HTMLButtonElement>(".close-file")!.click();
  await settled();
  expect($("scope-name").textContent).toBe("Second");
  expect($("breadcrumb").textContent).toBe("Explore Data");
  responses["Workbench.QueryWorkspace"] = () => ({
    ...page(),
    rows: [],
    more: false,
  });
  value("sql", 'SELECT * FROM workspace."empty.parquet"');
  $("sql").dispatchEvent(new Event("input"));
  await click("run");
  expect($("empty-result").hidden).toBe(false);
  expect($("empty-result").textContent).toContain("No matching rows.");
  expect($("empty-result").textContent).not.toContain("Write a query");
});

describe("R2 connection workspaces", () => {
  it("offers one launcher with keyboard-accessible local/cloud choices and returns focus", async () => {
    await boot();
    expect(document.querySelectorAll(".sidebar > .open-button")).toHaveLength(
      1,
    );
    await click("open-data");
    expect($<HTMLDialogElement>("source-dialog").open).toBe(true);
    expect($("source-local").querySelector("svg")).not.toBeNull();
    expect($("source-cloud").querySelector("svg")).not.toBeNull();
    expect(document.activeElement).toBe($("source-local"));
    expect($("sources-cloud").hidden).toBe(true);
    const tabKey = (id: string, k: string) =>
      $(id).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: k,
          bubbles: true,
          cancelable: true,
        }),
      );
    tabKey("source-local", "ArrowRight");
    expect(document.activeElement).toBe($("source-cloud"));
    expect($("sources-local").hidden).toBe(true);
    tabKey("source-cloud", "ArrowLeft");
    expect($("source-local").getAttribute("aria-selected")).toBe("true");
    tabKey("source-local", "End");
    expect($("source-cloud").tabIndex).toBe(0);
    tabKey("source-cloud", "Home");
    expect($("source-local").tabIndex).toBe(0);
    tabKey("source-local", "Tab");
    await click("source-cloud");
    await click("source-local");
    await click("source-dismiss");
    expect(document.activeElement).toBe($("open-data"));
    await click("welcome-data");
    expect($<HTMLDialogElement>("source-dialog").open).toBe(true);
    await click("source-dismiss");
    expect(document.activeElement).toBe($("welcome-data"));
    expect(bridge.call).not.toHaveBeenCalledWith("Workbench.Open");
  });
  it("closes the chooser before native local actions and keeps keyboard and drop shortcuts", async () => {
    await boot();
    responses["Workbench.Open"] = () => null;
    responses["Workbench.OpenWorkspace"] = () => null;
    await click("open-data");
    await click("open");
    expect($<HTMLDialogElement>("source-dialog").open).toBe(false);
    await click("open-data");
    await click("open-folder");
    expect($<HTMLDialogElement>("source-dialog").open).toBe(false);
    await click("open-data");
    expect(key("o", { metaKey: true }).defaultPrevented).toBe(true);
    await settled();
    expect($<HTMLDialogElement>("source-dialog").open).toBe(false);
    responses["Workbench.Open"] = () => dataFile();
    await click("welcome-data");
    await click("open");
    await click("open-data");
    bridge.drop!({ paths: ["/local/drop.parquet"] });
    await settled();
    expect($<HTMLDialogElement>("source-dialog").open).toBe(false);
    expect($("workspace").hidden).toBe(false);
    await click("open-data");
    const calls = bridge.call.mock.calls.length;
    key("Enter", { metaKey: true });
    expect(bridge.call.mock.calls.length).toBe(calls);
  });
  it("moves from cloud choice to R2 and back without exposing credentials or blocking paste", async () => {
    await boot();
    await click("open-data");
    await click("source-cloud");
    await click("open-r2");
    expect($<HTMLDialogElement>("source-dialog").open).toBe(false);
    expect(document.activeElement).toBe($("r2-endpoint"));
    value("r2-secret", "temporary-secret");
    expect(key("v", { metaKey: true }).defaultPrevented).toBe(false);
    const calls = bridge.call.mock.calls.length;
    bridge.drop!({ paths: ["/local/drop.parquet"] });
    expect(bridge.call.mock.calls.length).toBe(calls);
    await click("r2-back");
    expect($<HTMLInputElement>("r2-secret").value).toBe("");
    expect($<HTMLDialogElement>("r2-dialog").open).toBe(false);
    expect($<HTMLDialogElement>("source-dialog").open).toBe(true);
    expect($("source-cloud").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe($("source-cloud"));
  });
  it("manages saved cloud connections independently from open workspaces", async () => {
    setup();
    const c = {
      root: "r2://analytics/saved",
      provider: "r2",
      config: {
        name: "Saved analytics",
        endpoint:
          "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
        bucket: "analytics",
        prefix: "orders",
      },
      open: false,
    };
    let connections = [c];
    responses["Workbench.ListConnections"] = () => connections;
    responses["Workbench.SaveR2Connection"] = (root: string, input: any) => {
      expect(root).toBe(c.root);
      expect(input.accessKey).toBe("");
      expect(input.secretKey).toBe("");
      c.config.name = input.name;
      return {
        root: c.root,
        name: input.name,
        active: ".",
        location: "r2://analytics/orders",
      };
    };
    responses["Workbench.DeleteR2Connection"] = () => {
      connections = [];
    };
    await boot();
    await click("settings");
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".connection-item")).toHaveLength(1),
    );
    expect($<HTMLDialogElement>("settings-dialog").open).toBe(true);
    const action = async (name: string) => {
      document
        .querySelector<HTMLButtonElement>('[data-action="' + name + '"]')!
        .click();
      await settled();
    };
    expect(
      [...document.querySelectorAll(".connection-item-actions button")].map(
        (b) => b.getAttribute("data-action"),
      ),
    ).toEqual(["open", "edit", "delete"]);
    await action("edit");
    expect($<HTMLInputElement>("r2-bucket").readOnly).toBe(false);
    expect($<HTMLInputElement>("r2-secret").value).toBe("");
    expect($<HTMLInputElement>("r2-secret").required).toBe(false);
    value("r2-name", "Renamed");
    await submit();
    await vi.waitFor(() =>
      expect($("connection-list").textContent).toContain("Renamed"),
    );
    expect($("welcome").hidden).toBe(false);
    expect(
      bridge.call.mock.calls.some(
        ([method]) => method === "Workbench.ConnectR2",
      ),
    ).toBe(false);
    expect(
      document
        .querySelector(".connection-item .provider-logo")!
        .getAttribute("aria-label"),
    ).toBe("Cloudflare");
    const deletionCalls = () =>
      bridge.call.mock.calls.filter(
        ([method]) => method === "Workbench.DeleteR2Connection",
      );
    await action("delete");
    expect(
      document.querySelector<HTMLElement>(".connection-delete")!.hidden,
    ).toBe(false);
    expect(deletionCalls()).toHaveLength(0);
    expect(document.activeElement?.textContent).toBe("Cancel");
    document
      .querySelector<HTMLButtonElement>(".connection-delete button")!
      .click();
    expect(
      document.querySelector<HTMLElement>(".connection-delete")!.hidden,
    ).toBe(true);
    expect(deletionCalls()).toHaveLength(0);
    expect(document.activeElement?.getAttribute("data-action")).toBe("delete");
    await action("delete");
    await action("confirm-delete");
    await vi.waitFor(() =>
      expect($("connection-list").textContent).toContain(
        "No saved connections",
      ),
    );
    expect(deletionCalls()).toHaveLength(1);
    expect(deletionCalls()[0][1]).toBe(c.root);
    await click("settings-dismiss");
    expect(document.activeElement).toBe($("settings"));
  });
  it("remembers a light or dark appearance and keeps the previous choice if saving fails", async () => {
    responses["Workbench.Appearance"] = () => "dark";
    await boot();
    await click("settings");
    expect($("settings-panel-general").hidden).toBe(false);
    await click("settings-tab-general");
    expect($("settings-panel-connections").hidden).toBe(true);
    expect($("settings-panel-general").hidden).toBe(false);
    expect($("settings-tab-general").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(document.querySelectorAll(".appearance-preview")).toHaveLength(3);
    expect($("appearance-system").textContent).toBe("Auto");
    expect($("appearance-dark").getAttribute("aria-checked")).toBe("true");
    responses["Workbench.SetAppearance"] = () => undefined;
    await click("appearance-light");
    await vi.waitFor(() =>
      expect(
        bridge.call.mock.calls.some(
          ([name, source]) =>
            name === "Workbench.SetAppearance" && source === "light",
        ),
      ).toBe(true),
    );
    responses["Workbench.SetAppearance"] = () => {
      throw new Error("appearance unavailable");
    };
    await click("appearance-system");
    await vi.waitFor(() =>
      expect($("settings-message").textContent).toContain(
        "appearance unavailable",
      ),
    );
    expect($("appearance-light").getAttribute("aria-checked")).toBe("true");
    responses["Workbench.SetAppearance"] = () => undefined;
    $("appearance-light").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(document.activeElement).toBe($("appearance-dark"));
    await vi.waitFor(() =>
      expect($("appearance-dark").getAttribute("aria-checked")).toBe("true"),
    );
    $("settings-tab-general").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    expect($("settings-panel-general").hidden).toBe(false);
    expect(document.activeElement).toBe($("settings-tab-general"));
    await click("settings-tab-general");
    await click("settings-dismiss");
    await click("settings");
    expect($("settings-panel-general").hidden).toBe(false);
    await click("settings-dismiss");
    await click("manage-connections");
    expect($("settings-panel-connections").hidden).toBe(false);
    for (const key of ["End", "ArrowDown", "ArrowUp", "x"])
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    await click("settings-tab-general");
    const appearanceKey = (name: string, key: string) =>
      $(name).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    await click("appearance-dark"); // same choice does not save again
    appearanceKey("appearance-dark", "ArrowLeft");
    appearanceKey("appearance-light", "ArrowUp");
    appearanceKey("appearance-system", "ArrowDown");
    appearanceKey("appearance-light", "x");
    $("settings-dialog").dispatchEvent(
      new Event("cancel", { cancelable: true }),
    );
  });
  it("adds a saved connection, reopens it through management and removes its active documents", async () => {
    setup();
    const c = {
      root,
      provider: "r2",
      config: {
        name: "Cloud analytics",
        endpoint:
          "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
        bucket: "analytics",
        prefix: "",
      },
      open: false,
    };
    let connections: any[] = [];
    responses["Workbench.ListConnections"] = () => connections;
    responses["Workbench.SaveR2Connection"] = () => {
      connections = [c];
      return { root, name: c.config.name, active: "." };
    };
    responses["Workbench.OpenR2Connection"] = () => {
      c.open = true;
      return { root, name: c.config.name, active: "." };
    };
    responses["Workbench.DeleteR2Connection"] = () => {
      connections = [];
    };
    await boot();
    await click("settings");
    await click("settings-add");
    await click("settings-provider-r2");
    fill();
    await submit();
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".connection-item")).toHaveLength(1),
    );
    await click("settings-dismiss");
    const listCalls = () =>
      bridge.call.mock.calls.filter(
        ([method]) => method === "Workbench.ListConnections",
      ).length;
    const beforeLauncher = listCalls();
    await click("open-data");
    await click("source-cloud");
    expect(listCalls()).toBe(beforeLauncher);
    expect(document.querySelector(".saved-connection")).toBeNull();
    expect($("sources-cloud").textContent).not.toContain(c.config.name);
    await click("manage-connections");
    expect($<HTMLDialogElement>("source-dialog").open).toBe(false);
    expect($<HTMLDialogElement>("settings-dialog").open).toBe(true);
    expect($("settings-panel-connections").hidden).toBe(false);
    await vi.waitFor(() =>
      expect(document.querySelector(".connection-item")).not.toBeNull(),
    );
    document.querySelector<HTMLButtonElement>('[data-action="open"]')!.click();
    await settled();
    expect($<HTMLDialogElement>("source-dialog").open).toBe(false);
    expect($("file-name").textContent).toBe(c.config.name);
    document.querySelector<HTMLButtonElement>(".tree-file")!.click();
    await settled();
    await click("settings");
    await vi.waitFor(() =>
      expect($("connection-list").textContent).toContain("Workspace open"),
    );
    document.querySelector<HTMLButtonElement>('[data-action="open"]')!.click();
    await settled();
    expect($<HTMLDialogElement>("settings-dialog").open).toBe(false);
    await click("settings");
    await vi.waitFor(() =>
      expect(document.querySelector(".connection-item")).not.toBeNull(),
    );
    document.querySelector<HTMLButtonElement>('[data-action="edit"]')!.click();
    expect($<HTMLInputElement>("r2-bucket").readOnly).toBe(true);
    value("r2-name", "Renamed active");
    responses["Workbench.SaveR2Connection"] = () => ({
      root,
      name: "Renamed active",
      active: ".",
    });
    await submit();
    await vi.waitFor(() =>
      expect(document.querySelector(".connection-item")).not.toBeNull(),
    );
    expect(document.querySelector(".workspace-name")!.textContent).toBe(
      "Renamed active",
    );
    document
      .querySelector<HTMLButtonElement>('[data-action="delete"]')!
      .click();
    document
      .querySelector<HTMLButtonElement>('[data-action="confirm-delete"]')!
      .click();
    await settled();
    expect($("welcome").hidden).toBe(false);
    expect(document.querySelector(".workspace-group")).toBeNull();
  });
  it("keeps settings failures visible and supports cancellation without exposing credentials", async () => {
    setup();
    await boot();
    responses["Workbench.ListConnections"] = () => {
      throw Error("Settings unavailable");
    };
    await click("settings");
    await vi.waitFor(() =>
      expect($("settings-message").textContent).toContain(
        "Settings unavailable",
      ),
    );
    await click("settings-dismiss");
    await click("open-data");
    await click("source-cloud");
    expect($("sources-cloud").textContent).not.toContain(
      "Settings unavailable",
    );
    expect(document.getElementById("connections-error")).toBeNull();
    responses["Workbench.ListConnections"] = () => [];
    await click("manage-connections");
    await click("settings-add");
    await click("settings-provider-r2");
    fill();
    await click("r2-cancel");
    expect($<HTMLDialogElement>("settings-dialog").open).toBe(true);
    await click("settings-add");
    await click("settings-provider-r2");
    fill();
    $("r2-dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
    expect($<HTMLDialogElement>("settings-dialog").open).toBe(true);
    expect($<HTMLInputElement>("r2-secret").value).toBe("");
    expect(key("o", { metaKey: true }).defaultPrevented).toBe(true);
    const calls = bridge.call.mock.calls.length;
    bridge.drop!({ paths: ["/local/file.parquet"] });
    expect(bridge.call.mock.calls.length).toBe(calls);
  });
  it("preserves saved configuration and documents when opening or deleting fails", async () => {
    setup();
    const c = {
      root,
      provider: "r2",
      config: {
        name: "Saved",
        endpoint:
          "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
        bucket: "analytics",
        prefix: "",
      },
      open: false,
    };
    responses["Workbench.ListConnections"] = () => [c];
    responses["Workbench.DeleteR2Connection"] = () => {
      throw Error("Keychain locked");
    };
    responses["Workbench.OpenR2Connection"] = () => {
      throw Error("Offline");
    };
    await boot();
    await click("settings");
    await vi.waitFor(() =>
      expect(document.querySelector(".connection-item")).not.toBeNull(),
    );
    document
      .querySelector<HTMLButtonElement>('[data-action="delete"]')!
      .click();
    document
      .querySelector<HTMLButtonElement>('[data-action="confirm-delete"]')!
      .click();
    await settled();
    expect($("settings-message").textContent).toContain("Keychain locked");
    expect(document.querySelector(".connection-item")).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-action="open"]')!.click();
    await settled();
    expect($("settings-message").textContent).toContain("Offline");
    await click("settings-dismiss");
    const listCalls = () =>
      bridge.call.mock.calls.filter(
        ([method]) => method === "Workbench.ListConnections",
      ).length;
    const beforeLauncher = listCalls();
    await click("open-data");
    await click("source-cloud");
    expect(listCalls()).toBe(beforeLauncher);
    expect(document.querySelector(".saved-connection")).toBeNull();
    expect($("sources-cloud").textContent).not.toContain(c.config.name);
    await click("manage-connections");
    expect($<HTMLDialogElement>("source-dialog").open).toBe(false);
    expect($<HTMLDialogElement>("settings-dialog").open).toBe(true);
    expect($("settings-panel-connections").hidden).toBe(false);
    await vi.waitFor(() =>
      expect(document.querySelector(".connection-item")).not.toBeNull(),
    );
    document.querySelector<HTMLButtonElement>('[data-action="open"]')!.click();
    await settled();
    expect($("settings-message").textContent).toContain("Offline");
  });
  it("cancels an in-flight connection opening from Settings", async () => {
    setup();
    responses["Workbench.ListConnections"] = () => [
      {
        root,
        provider: "r2",
        config: {
          name: "Saved",
          endpoint:
            "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
          bucket: "analytics",
          prefix: "",
        },
        open: false,
      },
    ];
    let reject!: (e: Error) => void;
    responses["Workbench.OpenR2Connection"] = () =>
      new Promise((_resolve, r) => {
        reject = r;
      });
    responses["Workbench.Cancel"] = () => reject(Error("Canceled"));
    await boot();
    await click("settings");
    await vi.waitFor(() =>
      expect(document.querySelector(".connection-item")).not.toBeNull(),
    );
    document.querySelector<HTMLButtonElement>('[data-action="open"]')!.click();
    await vi.waitFor(() => expect($("settings-cancel").hidden).toBe(false));
    const escape = new Event("cancel", { cancelable: true });
    $("settings-dialog").dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    await settled();
    expect($<HTMLDialogElement>("settings-dialog").open).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-action="open"]')!.click();
    await vi.waitFor(() => expect($("settings-cancel").hidden).toBe(false));
    await click("settings-cancel");
    expect($("settings-message").textContent).toContain("Canceled");
  });
  const root = "r2://analytics/test-connection";
  function setup() {
    responses["Workbench.ConnectR2"] = () => ({
      root,
      name: "Cloud analytics",
      active: ".",
    });
    responses["Workbench.ListDirectory"] = () => ({
      entries: [
        { name: "orders.parquet", path: "orders.parquet", directory: false },
      ],
      next: 0,
      more: false,
    });
    responses["Workbench.SaveWorkspaceQuery"] = () => undefined;
    responses["Workbench.CloseWorkspace"] = () => undefined;
    responses["Workbench.OpenWorkspaceFile"] = () => ({
      file: {
        ...dataFile(),
        name: "orders.parquet",
        path: root + "/orders.parquet",
      },
      query: { draft: "SELECT * FROM data", applied: "SELECT * FROM data" },
      warning: "",
    });
  }
  function fill() {
    value(
      "r2-endpoint",
      "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    );
    value("r2-bucket", "analytics");
    value("r2-access", "test-access");
    value("r2-secret", "test-secret");
  }
  async function submit() {
    $("r2-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await settled();
  }
  it("connects to R2, clears credential inputs, shows the workspace editor, and closes its files with the root", async () => {
    setup();
    await boot();
    await click("open-r2");
    expect($<HTMLDialogElement>("r2-dialog").open).toBe(true);
    fill();
    expect(key("o", { metaKey: true }).defaultPrevented).toBe(true);
    expect(key("O", { metaKey: true, shiftKey: true }).defaultPrevented).toBe(
      true,
    );
    await submit();
    expect($<HTMLDialogElement>("r2-dialog").open).toBe(false);
    expect($<HTMLInputElement>("r2-secret").value).toBe("");
    expect($<HTMLInputElement>("r2-access").value).toBe("");
    expect($("workspace").hidden).toBe(false);
    expect($("file-name").textContent).toBe("Cloud analytics");
    expect(document.querySelector(".local-badge")!.textContent).toBe(
      "R2 / read-only",
    );
    value("sql", 'SELECT * FROM workspace."orders.parquet"');
    $("sql").dispatchEvent(new Event("input"));
    await click("run");
    expect($("grid").querySelectorAll("tbody tr").length).toBe(2);
    (document.querySelector(".tree-file") as HTMLButtonElement).click();
    await settled();
    expect($("file-name").textContent).toBe("orders.parquet");
    expect($("open-files-panel").hidden).toBe(true);
    await click("folder-close");
    expect($("welcome").hidden).toBe(false);
    expect(document.querySelector(".workspace-group")).toBeNull();
  });
  it("keeps connection errors visible without echoing credentials and can retry or dismiss", async () => {
    setup();
    await boot();
    await click("open-r2");
    fill();
    responses["Workbench.ConnectR2"] = () => {
      throw new Error("R2 access denied");
    };
    await submit();
    expect($("r2-error").textContent).toContain("R2 access denied");
    expect($("r2-error").hidden).toBe(false);
    expect(document.body.textContent).not.toContain("test-secret");
    expect($<HTMLInputElement>("r2-secret").value).toBe("");
    await click("r2-cancel");
    expect($<HTMLDialogElement>("r2-dialog").open).toBe(false);
    await click("open-r2");
    expect($("r2-error").hidden).toBe(true);
    await click("r2-dismiss");
    await click("open-r2");
    fill();
    responses["Workbench.ConnectR2"] = () => null;
    await submit();
    expect($("r2-error").textContent).toContain("No cloud workspace");
  });
  it("cancels an in-flight connection and retains a disconnected R2 root for refresh", async () => {
    setup();
    await boot();
    await click("open-r2");
    fill();
    let reject!: (e: Error) => void;
    responses["Workbench.ConnectR2"] = () =>
      new Promise((_, r) => {
        reject = r;
      });
    responses["Workbench.Cancel"] = () => {
      reject(new Error("connection canceled"));
    };
    $("r2-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
    const cancel = new Event("cancel", { cancelable: true });
    $("r2-dialog").dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    await settled();
    expect($("r2-error").textContent).toContain("canceled");
    fill();
    responses["Workbench.ConnectR2"] = () => ({
      root,
      name: "Cloud analytics",
      active: ".",
    });
    responses["Workbench.ListDirectory"] = () => {
      throw new Error("R2 network unavailable");
    };
    await submit();
    expect(document.querySelector(".folder-tree")!.textContent).toContain(
      "Refresh to retry",
    );
    expect($("workspace").hidden).toBe(false);
  });
});

describe("AWS S3 connections", () => {
  const root = "s3://analytics/test-connection";
  function setup() {
    responses["Workbench.ConnectR2"] = () => ({
      root,
      name: "S3 analytics",
      active: ".",
    });
    responses["Workbench.ListDirectory"] = () => ({
      entries: [
        { name: "orders.parquet", path: "orders.parquet", directory: false },
      ],
      next: 0,
      more: false,
    });
    responses["Workbench.SaveWorkspaceQuery"] = () => undefined;
    responses["Workbench.CloseWorkspace"] = () => undefined;
  }
  async function submit() {
    $("r2-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await settled();
  }
  it("shows branded choices from the add icon and returns to Settings on cancel", async () => {
    await boot();
    await click("settings");
    await click("settings-tab-connections");
    expect($("settings-add").textContent).toBe("");
    expect($("settings-add").getAttribute("aria-label")).toBe("Add connection");
    await click("settings-add");
    expect($<HTMLDialogElement>("settings-dialog").open).toBe(false);
    expect($<HTMLDialogElement>("connection-picker").open).toBe(true);
    expect(
      $("settings-provider-r2").querySelector(".cloudflare-mark"),
    ).not.toBeNull();
    expect(
      $("settings-provider-s3").querySelector<HTMLImageElement>("img")!.alt,
    ).toBe("AWS");
    expect(document.activeElement).toBe($("settings-provider-r2"));
    const calls = bridge.call.mock.calls.length;
    expect(key("o", { metaKey: true }).defaultPrevented).toBe(true);
    bridge.drop!({ paths: ["/local/file.parquet"] });
    expect(bridge.call.mock.calls.length).toBe(calls);
    $("connection-picker").dispatchEvent(
      new Event("cancel", { cancelable: true }),
    );
    expect($<HTMLDialogElement>("settings-dialog").open).toBe(true);
    expect($<HTMLDialogElement>("connection-picker").open).toBe(false);
    expect(document.activeElement).toBe($("settings-add"));
    await click("settings-add");
    await click("connection-picker-dismiss");
    expect($<HTMLDialogElement>("settings-dialog").open).toBe(true);
  });
  it("opens S3 with regional temporary credentials and keeps secrets off the page", async () => {
    setup();
    await boot();
    await click("open-data");
    await click("source-cloud");
    await click("open-s3");
    expect(document.getElementById("cloud-provider")).toBeNull();
    expect($("r2-title").textContent).toBe("Connect Amazon S3");
    expect($("endpoint-field").hidden).toBe(true);
    expect($("region-field").hidden).toBe(false);
    value("s3-region", "us-west-2");
    value("r2-bucket", "analytics");
    value("r2-access", "test-access");
    value("r2-secret", "test-secret");
    value("s3-token", "test-session");
    await submit();
    const call = bridge.call.mock.calls.find(
      ([name]) => name === "Workbench.ConnectR2",
    )!;
    expect(call[1]).toMatchObject({
      provider: "s3",
      region: "us-west-2",
      endpoint: "",
    });
    expect($<HTMLInputElement>("s3-token").value).toBe("");
    expect(document.body.textContent).not.toContain("test-session");
    expect(document.querySelector(".local-badge")!.textContent).toBe(
      "S3 / read-only",
    );
    value("sql", 'SELECT * FROM workspace."orders.parquet"');
    $("sql").dispatchEvent(new Event("input"));
    await click("run");
    expect($("grid").querySelectorAll("tbody tr").length).toBe(2);
    await click("folder-close");
    expect($("welcome").hidden).toBe(false);
  });
  it("uses explicit Settings entry points and preserves saved S3 type without returning credentials", async () => {
    setup();
    const c = {
      root,
      provider: "s3",
      config: {
        provider: "s3",
        region: "eu-west-1",
        name: "Saved S3",
        endpoint: "https://s3.eu-west-1.amazonaws.com",
        bucket: "analytics",
        prefix: "sales",
      },
      open: false,
    };
    responses["Workbench.ListConnections"] = () => [c];
    responses["Workbench.SaveR2Connection"] = () => ({
      root,
      name: "Renamed S3",
      active: ".",
    });
    await boot();
    await click("settings");
    await vi.waitFor(() =>
      expect($("connection-list").textContent).toContain("Amazon S3"),
    );
    expect(
      document.querySelector<HTMLImageElement>(
        ".connection-item .provider-logo",
      )!.alt,
    ).toBe("AWS");
    expect($("connection-list").textContent).toContain("s3://analytics/sales");
    document.querySelector<HTMLButtonElement>('[data-action="edit"]')!.click();
    expect(document.getElementById("cloud-provider")).toBeNull();
    expect($("r2-title").textContent).toBe("Edit Amazon S3");
    expect($<HTMLInputElement>("s3-region").value).toBe("eu-west-1");
    expect($<HTMLInputElement>("s3-token").value).toBe("");
    value("r2-name", "Renamed S3");
    await submit();
    expect($<HTMLDialogElement>("settings-dialog").open).toBe(true);
    const saved = bridge.call.mock.calls.find(
      ([name]) => name === "Workbench.SaveR2Connection",
    )!;
    expect(saved[2].provider).toBe("s3");
    await click("settings-add");
    await click("settings-provider-s3");
    expect(document.getElementById("cloud-provider")).toBeNull();
    expect($("r2-title").textContent).toBe("Connect Amazon S3");
    value("s3-token", "temporary");
    await click("r2-back");
    expect($<HTMLDialogElement>("connection-picker").open).toBe(true);
    await click("settings-provider-r2");
    expect($("r2-title").textContent).toBe("Connect Cloudflare R2");
    expect($<HTMLInputElement>("s3-token").value).toBe("");
    expect($("endpoint-field").hidden).toBe(false);
    expect($<HTMLInputElement>("s3-region").required).toBe(false);
    await click("r2-back");
    expect($<HTMLDialogElement>("connection-picker").open).toBe(true);
    await click("settings-provider-s3");
    value("s3-token", "temporary");
    await click("r2-back");
    expect($<HTMLInputElement>("s3-token").value).toBe("");
  });
  it("shows S3 errors, clears session tokens and locks open connection regions", async () => {
    setup();
    responses["Workbench.ConnectR2"] = () => {
      throw Error(
        "AWS S3 rejected the request; check bucket region and credentials",
      );
    };
    await boot();
    await click("open-s3");
    value("s3-region", "us-east-1");
    value("r2-bucket", "analytics");
    value("r2-access", "key");
    value("r2-secret", "secret");
    value("s3-token", "temporary");
    await submit();
    expect($("r2-error").textContent).toContain("bucket region");
    expect($<HTMLInputElement>("s3-token").value).toBe("");
    await click("r2-cancel");
    responses["Workbench.ListConnections"] = () => [
      {
        root,
        provider: "s3",
        config: {
          region: "us-east-1",
          name: "S3",
          endpoint: "https://s3.us-east-1.amazonaws.com",
          bucket: "analytics",
          prefix: "",
        },
        open: true,
      },
    ];
    await click("settings");
    await vi.waitFor(() =>
      expect(document.querySelector(".connection-item")).not.toBeNull(),
    );
    document.querySelector<HTMLButtonElement>('[data-action="edit"]')!.click();
    expect($<HTMLInputElement>("s3-region").readOnly).toBe(true);
  });
});

describe("English and Simplified Chinese interface", () => {
  async function changeLanguage(language: string) {
    value("interface-language", language);
    $("interface-language").dispatchEvent(
      new Event("change", { bubbles: true }),
    );
    await vi.waitFor(() =>
      expect($<HTMLSelectElement>("interface-language").disabled).toBe(false),
    );
  }
  it("switches immediately without replacing query drafts, data, focus or scroll, and can switch back", async () => {
    responses["Workbench.Open"] = () => ({
      ...dataFile(),
      name: "Settings",
      columns: [{ name: "Settings", type: "VARCHAR" }],
    });
    responses["Workbench.Query"] = (r: Request) => ({
      ...page(r.offset),
      columns: [{ name: "Settings", type: "VARCHAR" }],
      rows: [["Settings"], [""]],
    });
    await open();
    value("sql", "SELECT '设置' AS Settings FROM data");
    value("filter-value", "Settings");
    $("grid-scroll").scrollTop = 40;
    const before = bridge.call.mock.calls.filter(
      ([name]) => name === "Workbench.Query",
    ).length;
    await click("settings");
    await click("settings-tab-general");
    $("interface-language").focus();
    await changeLanguage("zh-CN");
    expect(bridge.call).toHaveBeenCalledWith("Workbench.SetLanguage", "zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect($("settings-title").textContent).toBe("设置");
    expect($("settings-tab-general").textContent).toContain("通用");
    expect($("appearance-title").textContent).toBe("外观");
    expect($("run").textContent).toBe("运行查询");
    expect($("page-label").textContent).toBe("第 1 页");
    expect($("result-summary").textContent).toContain("还有更多行");
    expect($("file-name").textContent).toBe("Settings");
    expect($("breadcrumb").textContent).toBe("Settings");
    expect(document.querySelector("#grid thead button")!.textContent).toBe(
      "Settings",
    );
    expect(document.querySelectorAll("#grid tbody td")[1].textContent).toBe(
      "Settings",
    );
    expect(document.querySelectorAll("#grid tbody td")[3].textContent).toBe(
      "空文本",
    );
    expect($<HTMLTextAreaElement>("sql").value).toBe(
      "SELECT '设置' AS Settings FROM data",
    );
    expect($<HTMLInputElement>("filter-value").value).toBe("Settings");
    expect($("grid-scroll").scrollTop).toBe(40);
    expect(document.activeElement).toBe($("interface-language"));
    expect(
      bridge.call.mock.calls.filter(([name]) => name === "Workbench.Query"),
    ).toHaveLength(before);
    await click("settings-dismiss");
    await click("next");
    expect($("page-label").textContent).toBe("第 2 页");
    expect($("filter-column").firstChild!.textContent).toBe("选择字段");
    await click("export");
    expect($("export-title").textContent).toBe("导出数据");
    await click("export-dismiss");
    await click("settings");
    await changeLanguage("en");
    expect($("run").textContent).toBe("Run query");
    expect($("page-label").textContent).toBe("Page 2");
    expect(document.querySelectorAll("#grid tbody td")[3].textContent).toBe(
      "empty",
    );
    const saves = bridge.call.mock.calls.filter(
      ([n]) => n === "Workbench.SetLanguage",
    ).length;
    await changeLanguage("en");
    expect(
      bridge.call.mock.calls.filter(([n]) => n === "Workbench.SetLanguage"),
    ).toHaveLength(saves);
  });
  it("restores Chinese before opening data and keeps the previous language if saving fails", async () => {
    responses["Workbench.Language"] = () => "zh-CN";
    await boot();
    expect($("welcome-title").textContent).toBe("探索你的数据");
    expect($<HTMLSelectElement>("interface-language").value).toBe("zh-CN");
    await click("settings");
    await click("settings-tab-general");
    responses["Workbench.SetLanguage"] = () => {
      throw Error("could not save language");
    };
    await changeLanguage("en");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect($<HTMLSelectElement>("interface-language").value).toBe("zh-CN");
    expect($("settings-message").textContent).toBe("无法保存语言设置");
    await click("settings-dismiss");
    await click("open-data");
    expect($("source-local").textContent).toBe("本机");
    await click("source-cloud");
    await click("open-s3");
    expect($("r2-title").textContent).toBe("连接 Amazon S3");
    expect($("cloud-credentials-note").textContent).toContain("权限");
  });
  it("recovers from a language-read failure and serializes saving without duplicate requests", async () => {
    responses["Workbench.Language"] = () => {
      throw Error("language unavailable");
    };
    await boot();
    expect($("welcome-title").textContent).toBe("Explore your data");
    await click("settings");
    await click("settings-tab-general");
    let resolve!: () => void;
    responses["Workbench.SetLanguage"] = () =>
      new Promise<void>((r) => {
        resolve = r;
      });
    value("interface-language", "zh-CN");
    $("interface-language").dispatchEvent(new Event("change"));
    $("interface-language").dispatchEvent(new Event("change"));
    expect($<HTMLSelectElement>("interface-language").disabled).toBe(true);
    expect(
      bridge.call.mock.calls.filter(([n]) => n === "Workbench.SetLanguage"),
    ).toHaveLength(1);
    resolve();
    await vi.waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"));
    $("settings-tab-general").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(document.activeElement).toBe($("settings-tab-connections"));
  });
});

describe("query resource settings", () => {
  it("restores, validates, saves and translates resource budgets", async () => {
    responses["Workbench.Resources"] = () => ({
      memoryMiB: 1024,
      tempAuto: false,
      tempGiB: 2,
      timeoutSeconds: 600,
    });
    await boot();
    await click("settings");
    await click("settings-tab-performance");
    expect($("settings-panel-performance").hidden).toBe(false);
    expect($<HTMLInputElement>("query-memory").value).toBe("1024");
    value("query-memory", "64");
    $("resources-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    expect(
      bridge.call.mock.calls.filter(
        ([name]) => name === "Workbench.SetResources",
      ),
    ).toHaveLength(0);
    value("query-memory", "512");
    value("query-disk", "0");
    value("query-timeout", "900");
    $("resources-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await vi.waitFor(() =>
      expect($("resources-status").textContent).toContain("Saved."),
    );
    expect(bridge.call).toHaveBeenCalledWith("Workbench.SetResources", {
      memoryAuto: false,
      memoryMiB: 512,
      tempAuto: false,
      tempGiB: 0,
      timeoutSeconds: 900,
    });
    const { setLanguage } = await import("../src/i18n");
    setLanguage("zh-CN");
    expect($("settings-tab-performance").textContent).toContain("性能");
    expect($("resources-status").textContent).toBe("已保存，下次查询生效。");
  });
  it("serializes saves and retains the saved values on failure", async () => {
    await boot();
    await click("settings");
    await click("settings-tab-performance");
    let reject!: (e: Error) => void;
    responses["Workbench.SetResources"] = () =>
      new Promise((_, r) => {
        reject = r;
      });
    value("query-memory", "512");
    $("resources-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    expect($<HTMLInputElement>("query-memory").disabled).toBe(true);
    $("resources-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    expect(
      bridge.call.mock.calls.filter(
        ([name]) => name === "Workbench.SetResources",
      ),
    ).toHaveLength(1);
    reject(Error("could not save resource settings"));
    await vi.waitFor(() =>
      expect($("resources-status").textContent).toBe("Not saved"),
    );
    expect($<HTMLInputElement>("query-memory").value).toBe("256");
    expect($<HTMLInputElement>("query-memory").disabled).toBe(false);
    expect($("settings-message").textContent).toBe(
      "could not save resource settings",
    );
  });
  it("does not overwrite preferences when loading them fails", async () => {
    responses["Workbench.Resources"] = () => {
      throw Error("unavailable");
    };
    await boot();
    await click("settings");
    await click("settings-tab-performance");
    expect($<HTMLButtonElement>("save-resources").disabled).toBe(true);
  });
});

describe("automatic query memory", () => {
  it("shows the hardware budget, preserves custom values, and saves auto mode", async () => {
    responses["Workbench.Resources"] = () => ({
      memoryMiB: 1024,
      memoryAuto: true,
      tempAuto: false,
      tempGiB: 4,
      timeoutSeconds: 300,
    });
    await boot();
    await click("settings");
    await click("settings-tab-performance");
    expect($<HTMLInputElement>("query-memory-mode").checked).toBe(true);
    expect($<HTMLInputElement>("query-memory").value).toBe("8192");
    expect($<HTMLInputElement>("query-memory").disabled).toBe(true);
    expect($("query-memory-summary").textContent).toContain("25%");
    $<HTMLInputElement>("query-memory-mode").checked = false;
    $("query-memory-mode").dispatchEvent(new Event("change"));
    expect($<HTMLInputElement>("query-memory").value).toBe("1024");
    expect($<HTMLInputElement>("query-memory").disabled).toBe(false);
    value("query-memory", "20000");
    $<HTMLInputElement>("query-memory-mode").checked = true;
    $("query-memory-mode").dispatchEvent(new Event("change"));
    $<HTMLInputElement>("query-memory-mode").checked = false;
    $("query-memory-mode").dispatchEvent(new Event("change"));
    expect($<HTMLInputElement>("query-memory").value).toBe("20000");
    $<HTMLInputElement>("query-memory-mode").checked = true;
    $("query-memory-mode").dispatchEvent(new Event("change"));
    $("resources-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await vi.waitFor(() =>
      expect($("resources-status").textContent).toContain("Saved."),
    );
    expect(bridge.call).toHaveBeenCalledWith("Workbench.SetResources", {
      memoryAuto: true,
      memoryMiB: 1024,
      tempAuto: false,
      tempGiB: 4,
      timeoutSeconds: 300,
    });
  });
  it("accepts the physical maximum, rejects higher values, and warns above 75%", async () => {
    await boot();
    await click("settings");
    await click("settings-tab-performance");
    expect($<HTMLInputElement>("query-memory").max).toBe("32768");
    value("query-memory", "24576");
    $("query-memory").dispatchEvent(new Event("input"));
    expect($("query-memory-warning").hidden).toBe(true);
    value("query-memory", "24577");
    $("query-memory").dispatchEvent(new Event("input"));
    expect($("query-memory-warning").hidden).toBe(false);
    const { setLanguage } = await import("../src/i18n");
    setLanguage("zh-CN");
    expect($("query-memory-warning").textContent).toContain("超过物理内存");
    expect($("query-memory-summary").textContent).toContain("本机内存：32 GiB");
    value("query-memory", "32769");
    $("resources-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    expect(
      bridge.call.mock.calls.filter(([n]) => n === "Workbench.SetResources"),
    ).toHaveLength(0);
    value("query-memory", "32768");
    $("resources-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await vi.waitFor(() =>
      expect($("resources-status").textContent).toContain("已保存"),
    );
    expect(bridge.call).toHaveBeenCalledWith("Workbench.SetResources", {
      memoryAuto: false,
      memoryMiB: 32768,
      tempAuto: false,
      tempGiB: 4,
      timeoutSeconds: 300,
    });
  });
  it("discloses detection fallback and prevents saving when limits cannot be loaded", async () => {
    responses["Workbench.ResourceLimits"] = () => ({
      physicalMiB: 0,
      maxMemoryMiB: 16384,
      autoMemoryMiB: 256,
    });
    await boot();
    await click("settings");
    await click("settings-tab-performance");
    expect($("query-memory-summary").textContent).toContain(
      "Memory detection unavailable",
    );
    expect($<HTMLInputElement>("query-memory").max).toBe("16384");
  });
  it("keeps controls disabled when the capacity IPC fails", async () => {
    responses["Workbench.ResourceLimits"] = () => {
      throw Error("limits unavailable");
    };
    await boot();
    await click("settings");
    await click("settings-tab-performance");
    expect($<HTMLButtonElement>("save-resources").disabled).toBe(true);
  });
});

describe("resource sliders", () => {
  it("synchronizes drag snapping, exact typed values, keyboard increments and saved budgets", async () => {
    await boot();
    await click("settings");
    await click("settings-tab-performance");
    const memory = $<HTMLInputElement>("query-memory-range"),
      disk = $<HTMLInputElement>("query-disk-range");
    expect(memory.max).toBe("32768");
    expect($("query-memory-ticks").textContent).toContain("8192");
    expect($("query-disk-ticks").textContent).toContain("64");
    memory.dispatchEvent(new Event("pointerdown"));
    value("query-memory-range", "8100");
    memory.dispatchEvent(new Event("input"));
    expect($<HTMLInputElement>("query-memory").value).toBe("8192");
    expect(memory.value).toBe("8192");
    window.dispatchEvent(new Event("pointerup"));
    value("query-memory", "8123");
    $("query-memory").dispatchEvent(new Event("input"));
    expect(memory.value).toBe("8123");
    memory.dispatchEvent(new Event("pointerdown"));
    memory.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    value("query-memory-range", "8124");
    memory.dispatchEvent(new Event("input"));
    expect($<HTMLInputElement>("query-memory").value).toBe("8124");
    disk.dispatchEvent(new Event("pointerdown"));
    value("query-disk-range", "15");
    disk.dispatchEvent(new Event("input"));
    expect($<HTMLInputElement>("query-disk").value).toBe("16");
    disk.dispatchEvent(new Event("pointercancel"));
    value("query-disk", "15");
    $("query-disk").dispatchEvent(new Event("input"));
    expect(disk.value).toBe("15");
    value("query-disk", "");
    $("query-disk").dispatchEvent(new Event("input"));
    expect(disk.value).toBe("15");
    $("resources-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    expect(
      bridge.call.mock.calls.filter(([n]) => n === "Workbench.SetResources"),
    ).toHaveLength(0);
    value("query-disk", "0");
    $("query-disk").dispatchEvent(new Event("input"));
    expect(disk.value).toBe("0");
    $("resources-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await vi.waitFor(() =>
      expect($("resources-status").textContent).toContain("Saved."),
    );
    expect(bridge.call).toHaveBeenCalledWith("Workbench.SetResources", {
      memoryAuto: false,
      memoryMiB: 8124,
      tempAuto: false,
      tempGiB: 0,
      timeoutSeconds: 300,
    });
  });
  it("locks both memory controls in automatic mode and restores custom values", async () => {
    await boot();
    await click("settings");
    await click("settings-tab-performance");
    value("query-memory", "1537");
    $("query-memory").dispatchEvent(new Event("input"));
    await click("query-memory-mode");
    const memory = $<HTMLInputElement>("query-memory-range");
    expect($<HTMLInputElement>("query-memory-mode").checked).toBe(true);
    expect(memory.disabled).toBe(true);
    expect(memory.value).toBe("8192");
    value("query-memory-range", "16384");
    memory.dispatchEvent(new Event("input"));
    expect($<HTMLInputElement>("query-memory").value).toBe("8192");
    await click("query-memory-mode");
    expect(memory.disabled).toBe(false);
    expect(memory.value).toBe("1537");
  });
});

describe("automatic temporary disk", () => {
  it("uses free-space limits above 64 GiB, retains typed custom values, and persists Auto", async () => {
    await boot();
    await click("settings");
    await click("settings-tab-performance");
    const number = $<HTMLInputElement>("query-disk"),
      range = $<HTMLInputElement>("query-disk-range");
    expect(number.max).toBe("256");
    expect(range.max).toBe("256");
    value("query-disk", "123");
    number.dispatchEvent(new Event("input"));
    expect(range.value).toBe("123");
    await click("query-disk-mode");
    expect(number.disabled).toBe(true);
    expect(range.disabled).toBe(true);
    expect(number.value).toBe("64");
    await click("query-disk-mode");
    expect(number.value).toBe("123");
    expect(number.disabled).toBe(false);
    await click("query-disk-mode");
    $("resources-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await vi.waitFor(() =>
      expect($("resources-status").textContent).toContain("Saved."),
    );
    expect(bridge.call).toHaveBeenCalledWith("Workbench.SetResources", {
      memoryAuto: false,
      memoryMiB: 256,
      tempAuto: true,
      tempGiB: 123,
      timeoutSeconds: 300,
    });
    await click("query-disk-mode");
    expect(number.value).toBe("123");
    const { setLanguage } = await import("../src/i18n");
    setLanguage("zh-CN");
    expect($("query-disk-summary").textContent).toContain("可用：257 GiB");
    expect($("query-disk-mode").getAttribute("aria-label")).toBe(
      "自动临时磁盘",
    );
  });

  it("refreshes available space on reopening settings without discarding a custom draft", async () => {
    await boot();
    await click("settings");
    value("query-disk", "128");
    await click("settings-dismiss");
    responses["Workbench.DiskLimits"] = () => ({
      detected: true,
      availableGiB: 17,
      reserveGiB: 1,
      maxTempGiB: 16,
      autoTempGiB: 4,
    });
    await click("settings");
    const number = $<HTMLInputElement>("query-disk");
    await vi.waitFor(() => expect(number.max).toBe("16"));
    expect(number.value).toBe("128");
    expect(number.validity.rangeOverflow).toBe(true);
    $("resources-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    expect(
      bridge.call.mock.calls.filter(
        ([name]) => name === "Workbench.SetResources",
      ),
    ).toHaveLength(0);
    value("query-disk", "8");
    $("resources-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await vi.waitFor(() =>
      expect($("resources-status").textContent).toContain("Saved."),
    );
  });

  it("keeps a zero-capacity slider at zero and allows explicitly disabling disk use", async () => {
    responses["Workbench.DiskLimits"] = () => ({
      detected: true,
      availableGiB: 0,
      reserveGiB: 1,
      maxTempGiB: 0,
      autoTempGiB: 0,
    });
    responses["Workbench.Resources"] = () => ({
      memoryMiB: 256,
      memoryAuto: false,
      tempGiB: 0,
      tempAuto: false,
      timeoutSeconds: 300,
    });
    await boot();
    expect($<HTMLInputElement>("query-disk-range").max).toBe("0");
    expect($<HTMLInputElement>("query-disk-range").value).toBe("0");
    expect($("query-disk-ticks").textContent).toBe("0");
    $("resources-form").dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await vi.waitFor(() =>
      expect($("resources-status").textContent).toContain("Saved."),
    );
    expect(bridge.call).toHaveBeenCalledWith(
      "Workbench.SetResources",
      expect.objectContaining({ tempAuto: false, tempGiB: 0 }),
    );
  });

  it("restores saved Auto and shows a safe detection fallback", async () => {
    responses["Workbench.Resources"] = () => ({
      memoryMiB: 256,
      memoryAuto: false,
      tempGiB: 128,
      tempAuto: true,
      timeoutSeconds: 300,
    });
    responses["Workbench.DiskLimits"] = () => ({
      detected: false,
      availableGiB: 0,
      reserveGiB: 1,
      maxTempGiB: 0,
      autoTempGiB: 0,
    });
    await boot();
    expect($<HTMLInputElement>("query-disk-mode").checked).toBe(true);
    expect($<HTMLInputElement>("query-disk").value).toBe("0");
    expect($<HTMLInputElement>("query-disk-range").disabled).toBe(true);
    expect($("query-disk-summary").textContent).toContain(
      "detection unavailable",
    );
  });
});

describe("signed application updates", () => {
  it("shows the installed version, checks updates and saves the automatic preference", async () => {
    await boot();
    await click("settings");
    expect($("update-version").textContent).toBe("Version 0.1.0");
    expect($<HTMLInputElement>("automatic-updates").checked).toBe(true);
    await click("check-updates");
    expect(bridge.call).toHaveBeenCalledWith("Workbench.CheckForUpdates");
    const toggle = $<HTMLInputElement>("automatic-updates");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(bridge.call).toHaveBeenCalledWith(
        "Workbench.SetAutomaticUpdates",
        false,
      ),
    );
    expect(toggle.checked).toBe(false);
  });
  it("keeps the saved preference after errors and prevents duplicate update requests", async () => {
    await boot();
    await click("settings");
    responses["Workbench.SetAutomaticUpdates"] = () => {
      throw new Error("could not start the updater");
    };
    const toggle = $<HTMLInputElement>("automatic-updates");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(toggle.checked).toBe(true));
    expect($("update-message").textContent).toBe("could not start the updater");
    let finish!: () => void;
    responses["Workbench.CheckForUpdates"] = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    $("check-updates").click();
    $("check-updates").click();
    await vi.waitFor(() =>
      expect($<HTMLButtonElement>("check-updates").disabled).toBe(true),
    );
    expect(
      bridge.call.mock.calls.filter(
        ([name]) => name === "Workbench.CheckForUpdates",
      ),
    ).toHaveLength(1);
    finish();
    await vi.waitFor(() =>
      expect($<HTMLButtonElement>("check-updates").disabled).toBe(false),
    );
    responses["Workbench.CheckForUpdates"] = () => {
      throw "an update check is already in progress";
    };
    await click("check-updates");
    expect($("update-message").textContent).toBe(
      "an update check is already in progress",
    );
  });
  it("opens manual updates only on request and leaves automatic updates disabled", async () => {
    responses["Workbench.UpdateStatus"] = () => ({
      version: "0.1.0-x64.preview.1",
      available: false,
      automatic: false,
      canCheck: true,
    });
    await boot();
    await click("settings");
    expect($<HTMLButtonElement>("check-updates").disabled).toBe(false);
    expect($<HTMLInputElement>("automatic-updates").disabled).toBe(true);
    expect($("update-message").textContent).toContain(
      "Download and install manually",
    );
    expect(bridge.call).not.toHaveBeenCalledWith("Workbench.CheckForUpdates");
    await click("check-updates");
    expect(bridge.call).toHaveBeenCalledWith("Workbench.CheckForUpdates");
    expect($<HTMLInputElement>("automatic-updates").disabled).toBe(true);
    responses["Workbench.UpdateStatus"] = () => {
      throw new Error("status failed");
    };
    await click("settings-dismiss");
    await click("settings");
    expect($<HTMLButtonElement>("check-updates").disabled).toBe(true);
  });
  it("disables unsupported builds and renders version strings as plain text", async () => {
    responses["Workbench.UpdateStatus"] = () => ({
      version: "<img src=x>",
      available: false,
      automatic: false,
      canCheck: false,
    });
    await boot();
    await click("settings");
    expect($<HTMLButtonElement>("check-updates").disabled).toBe(true);
    expect($<HTMLInputElement>("automatic-updates").disabled).toBe(true);
    expect($("update-version").querySelector("img")).toBeNull();
    expect($("update-message").textContent).toBe(
      "updates are unavailable in this build",
    );
    responses["Workbench.UpdateStatus"] = () => {
      throw new Error("could not read update settings");
    };
    await click("settings-dismiss");
    await click("settings");
    expect($("update-message").textContent).toBe(
      "could not read update settings",
    );
  });
  it("translates update settings into Chinese", async () => {
    responses["Workbench.Language"] = () => "zh-CN";
    await boot();
    await click("settings");
    expect($("check-updates").textContent).toBe("检查更新");
    expect($("update-version").textContent).toBe("版本 0.1.0");
  });
});

describe("update status request races", () => {
  it("ignores stale responses when settings is reopened", async () => {
    let finish!: (value: unknown) => void;
    responses["Workbench.UpdateStatus"] = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await boot();
    await click("settings");
    await click("settings-dismiss");
    responses["Workbench.UpdateStatus"] = () => ({
      version: "2.0.0",
      available: false,
      automatic: false,
      canCheck: false,
    });
    await click("settings");
    finish({
      version: "1.0.0",
      available: true,
      automatic: true,
      canCheck: true,
    });
    await settled();
    expect($("update-version").textContent).toBe("Version 2.0.0");
    expect($<HTMLButtonElement>("check-updates").disabled).toBe(true);
  });
  it("ignores stale errors and fails closed for missing bridge results", async () => {
    let reject!: (error: unknown) => void;
    responses["Workbench.UpdateStatus"] = () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      });
    await boot();
    await click("settings");
    await click("settings-dismiss");
    responses["Workbench.UpdateStatus"] = () => ({
      version: "2.0.0",
      available: true,
      automatic: false,
      canCheck: true,
    });
    await click("settings");
    reject("stale error");
    await settled();
    expect($("update-message").textContent).toBe("");
    await click("settings-dismiss");
    responses["Workbench.UpdateStatus"] = () => null;
    await click("settings");
    expect($("update-message").textContent).toBe(
      "updates are unavailable in this build",
    );
    expect($<HTMLButtonElement>("check-updates").disabled).toBe(true);
  });
});

describe("settings recovery and keyboard boundaries", () => {
  it("keeps an empty welcome page usable when optional startup preferences are absent", async () => {
    responses["Workbench.Resources"] = () => null;
    responses["Workbench.Appearance"] = () => "invalid-saved-theme";
    responses["Workbench.RestoreWorkspaces"] = () => null;
    await boot();
    expect($("welcome").hidden).toBe(false);
    expect($("notification").hidden).toBe(true);
    await click("settings");
    expect($<HTMLDialogElement>("settings-dialog").open).toBe(true);
  });

  it("wraps settings navigation backwards and supports the final tab", async () => {
    await boot();
    await click("settings");
    const general = $("settings-tab-general");
    const unrelated = new KeyboardEvent("keydown", {
      key: "x",
      cancelable: true,
    });
    general.dispatchEvent(unrelated);
    expect(unrelated.defaultPrevented).toBe(false);
    general.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }),
    );
    expect(document.activeElement?.id).toBe("settings-tab-performance");
    $("settings-tab-performance").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", cancelable: true }),
    );
    expect(document.activeElement).toBe(general);
    general.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", cancelable: true }),
    );
    expect(document.activeElement?.id).toBe("settings-tab-performance");
  });

  it("shows string-valued update errors and restores the saved toggle", async () => {
    responses["Workbench.UpdateStatus"] = () => {
      throw "native status unavailable";
    };
    await boot();
    await click("settings");
    expect($("update-message").textContent).toBe("native status unavailable");
    await click("settings-dismiss");
    responses["Workbench.UpdateStatus"] = () => ({
      version: "0.1.0",
      available: true,
      automatic: true,
      canCheck: true,
    });
    await click("settings");
    responses["Workbench.SetAutomaticUpdates"] = () => {
      throw "preferences are read-only";
    };
    const toggle = $<HTMLInputElement>("automatic-updates");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(toggle.checked).toBe(true));
    expect($("update-message").textContent).toBe("preferences are read-only");
    responses["Workbench.CheckForUpdates"] = () => {
      throw new Error("update service unavailable");
    };
    await click("check-updates");
    expect($("update-message").textContent).toBe("update service unavailable");
  });
});

describe("retained IPC compatibility", () => {
  it("preserves export cancellation and rejects a failed saved-connection probe", async () => {
    const { Workbench } = await import("../src/mygo");
    responses["Workbench.ExportPage"] = () => "";
    expect(await Workbench.exportPage()).toBe("");
    responses["Workbench.ExportPage"] = () => "/exports/竹.parquet.json";
    expect(await Workbench.exportPage()).toBe("/exports/竹.parquet.json");
    responses["Workbench.TestR2Connection"] = () => {
      throw new Error("saved connection is unavailable");
    };
    await expect(
      Workbench.testR2Connection("s3://fixture-bucket/data"),
    ).rejects.toThrow("saved connection is unavailable");
    expect(
      bridge.call.mock.calls.filter(
        ([name]) => name === "Workbench.OpenConnection",
      ),
    ).toHaveLength(0);
  });
});

describe("quiet sidebar update reminders", () => {
  const pending = (version = "0.2.0") => ({
    version: "0.1.0",
    available: true,
    automatic: true,
    canCheck: true,
    updateVersion: version,
  });
  const refresh = async () => {
    const callback = vi
      .mocked(window.setInterval)
      .mock.calls.find(([, interval]) => interval === 60_000)![0];
    if (typeof callback !== "function")
      throw new Error("missing status refresh");
    callback();
    await vi.waitFor(() =>
      expect(bridge.call).toHaveBeenCalledWith("Workbench.UpdateStatus"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  it("announces a version without checking or installing until the user clicks", async () => {
    responses["Workbench.UpdateStatus"] = () => pending();
    await boot();
    expect($("update-reminder").hidden).toBe(false);
    expect($("update-reminder-label").textContent).toBe("Update to 0.2.0");
    expect(
      bridge.call.mock.calls.some(
        ([name]) => name === "Workbench.CheckForUpdates",
      ),
    ).toBe(false);
    let finish!: () => void;
    responses["Workbench.CheckForUpdates"] = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    $("update-reminder").click();
    $("update-reminder").click();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(
      bridge.call.mock.calls.filter(
        ([name]) => name === "Workbench.CheckForUpdates",
      ),
    ).toHaveLength(1);
    responses["Workbench.UpdateStatus"] = () => pending("");
    finish();
    await vi.waitFor(() => expect($("update-reminder").hidden).toBe(true));
    expect($("welcome").hidden).toBe(false);
  });
  it("keeps failed checks recoverable and versions as translated plain text", async () => {
    responses["Workbench.Language"] = () => "zh-CN";
    responses["Workbench.UpdateStatus"] = () => pending("<img src=x>");
    responses["Workbench.CheckForUpdates"] = () => {
      throw new Error("network unavailable");
    };
    await boot();
    expect($("update-reminder").querySelector("img")).toBeNull();
    expect($("update-reminder-label").textContent).toBe("升级至 <img src=x>");
    await click("update-reminder");
    expect($("notification").textContent).toBe("network unavailable");
    expect($("update-reminder").hidden).toBe(false);
    responses["Workbench.UpdateStatus"] = () => {
      throw new Error("status unavailable");
    };
    await refresh();
    expect($("update-reminder").hidden).toBe(true);
  });
  it("ignores outdated status replies and does not start network checks during polling", async () => {
    let finish!: (value: unknown) => void;
    responses["Workbench.UpdateStatus"] = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await boot();
    responses["Workbench.UpdateStatus"] = () => pending("0.3.0");
    await refresh();
    finish(pending("0.2.0"));
    await vi.waitFor(() =>
      expect($("update-reminder-label").textContent).toBe("Update to 0.3.0"),
    );
    expect(
      bridge.call.mock.calls.some(
        ([name]) => name === "Workbench.CheckForUpdates",
      ),
    ).toBe(false);
    responses["Workbench.UpdateStatus"] = () => null;
    await refresh();
    expect($("update-reminder").hidden).toBe(true);
  });
});

describe("persistent sessions", () => {
  it("restores independent and workspace files lazily with the saved active selection", async () => {
    folderResponses();
    responses["Workbench.RestoreWorkspaces"] = () => ({
      workspaces: [workspaceInfo],
      warning: "",
      session: {
        files: [
          "/analysis/orders.parquet",
          "/outside/a.parquet",
          "/outside/b.parquet",
        ],
        active: "/outside/b.parquet",
      },
    });
    responses["Workbench.OpenPath"] = (path: string) => ({
      ...dataFile(),
      path,
      name: path.split("/").at(-1),
    });
    await boot();
    expect(document.querySelectorAll(".opened-file")).toHaveLength(3);
    expect(
      bridge.call.mock.calls.filter(([name]) => name === "Workbench.OpenPath"),
    ).toEqual([["Workbench.OpenPath", "/outside/b.parquet"]]);
    expect(
      bridge.call.mock.calls.some(
        ([name]) => name === "Workbench.OpenWorkspaceFile",
      ),
    ).toBe(false);
    expect(lastRequest().sql).toBe("SELECT * FROM data");
    expect($("breadcrumb").textContent).toBe("b.parquet");
    await treeFile();
    expect($<HTMLTextAreaElement>("sql").value).toBe("SELECT draft");
    expect(lastRequest().sql).toBe("SELECT * FROM data");
    const close = document.querySelector<HTMLButtonElement>(
      '.opened-file[data-path="/outside/a.parquet"] .close-file',
    )!;
    responses["Workbench.CloseFile"] = () => {
      throw new Error("disk denied");
    };
    close.click();
    await settled();
    expect(document.querySelectorAll(".opened-file")).toHaveLength(3);
    expect($("notification").textContent).toContain("disk denied");
    responses["Workbench.CloseFile"] = () => undefined;
    close.click();
    await settled();
    expect(document.querySelectorAll(".opened-file")).toHaveLength(2);
  });

  it("retains an offline root while restoring another root and skips closed cloud documents", async () => {
    folderResponses();
    responses["Workbench.RestoreWorkspaces"] = () => ({
      workspaces: [
        { root: "/offline", name: "Offline", active: "lost.parquet" },
        workspaceInfo,
      ],
      warning: "",
      session: {
        files: [
          "/offline/lost.parquet",
          "s3://closed/private.parquet",
          "/analysis/orders.parquet",
        ],
        active: "/analysis/orders.parquet",
      },
    });
    const list = responses["Workbench.ListDirectory"];
    responses["Workbench.ListDirectory"] = (root: string, ...args: any[]) => {
      if (root === "/offline") throw new Error("drive unavailable");
      return list(root, ...args);
    };
    await boot();
    expect(document.querySelectorAll(".workspace-group")).toHaveLength(2);
    expect(
      document.querySelector('[data-root="/offline"]')?.textContent,
    ).toContain("saved state is preserved");
    expect($("breadcrumb").textContent).toBe("orders.parquet");
    expect(
      bridge.call.mock.calls.filter(
        ([name]) => name === "Workbench.OpenWorkspaceFile",
      ),
    ).toHaveLength(1);
    expect(
      document.querySelector('[data-path="s3://closed/private.parquet"]'),
    ).toBeNull();
  });

  it("keeps a temporarily unavailable independent file available for retry", async () => {
    responses["Workbench.RestoreWorkspaces"] = () => ({
      workspaces: [],
      warning: "",
      session: {
        files: ["/offline/data.parquet"],
        active: "/offline/data.parquet",
      },
    });
    responses["Workbench.OpenPath"] = () => {
      throw new Error("permission denied");
    };
    await boot();
    expect(document.querySelectorAll(".opened-file")).toHaveLength(1);
    expect($("notification").textContent).toContain("permission denied");
    expect(
      bridge.call.mock.calls.some(([name]) => name === "Workbench.CloseFile"),
    ).toBe(false);
    responses["Workbench.OpenPath"] = () => ({
      ...dataFile(),
      path: "/offline/data.parquet",
      name: "data.parquet",
    });
    document
      .querySelector<HTMLButtonElement>(".opened-file .activate-file")!
      .click();
    await settled();
    expect($("breadcrumb").textContent).toBe("data.parquet");
  });

  it("opens a launch argument after restoring the existing session", async () => {
    responses["Workbench.RestoreWorkspaces"] = () => ({
      workspaces: [],
      warning: "",
      session: { files: ["/saved.parquet"], active: "/saved.parquet" },
    });
    responses["Workbench.InitialFile"] = () => "/new.parquet";
    responses["Workbench.OpenPath"] = (path: string) => ({
      ...dataFile(),
      path,
      name: path.slice(1),
    });
    await boot();
    expect(document.querySelectorAll(".opened-file")).toHaveLength(2);
    expect($("breadcrumb").textContent).toBe("new.parquet");
  });
});

it("shows an independent file persistence warning while keeping its preview usable", async () => {
  responses["Workbench.Open"] = () => ({
    ...dataFile(),
    warning: "settings denied",
  });
  await open();
  expect($("notification").textContent).toContain(
    "File opened, but its session could not be saved: settings denied",
  );
  expect(document.querySelectorAll("#grid tbody tr")).toHaveLength(2);
  await click("next");
  expect(lastRequest().offset).toBe(100);
});
