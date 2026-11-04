import { beforeEach, expect, it, vi } from "vitest";
import type { QueryEntry, QueryScope } from "../src/mygo";
import { QueryLibrary } from "../src/query-library";
import { setLanguage } from "../src/i18n";
const call = vi.hoisted(() => vi.fn());
vi.mock("mygo-runtime", () => ({ call }));
const scope: QueryScope = { kind: "file", path: "/fixtures/<img>.parquet" };
const entry = (id = "one", other = false): QueryEntry => ({
  id,
  scope: other ? { kind: "workspace", path: "s3://other" } : scope,
  sql: "SELECT '<img onerror=x>', 9223372036854775807, NULL, '' FROM data",
  updated: "2026-11-02T12:00:00Z",
  history: true,
  favorite: false,
});
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const rows = () => [
  ...document.querySelectorAll<HTMLButtonElement>(".library-entry"),
];
let entries: QueryEntry[],
  current: QueryScope | undefined,
  draft: string,
  dirty: boolean;
let restore: ReturnType<typeof vi.fn>,
  report: ReturnType<typeof vi.fn>,
  library: QueryLibrary;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  document.body.innerHTML =
    '<textarea id="sql"></textarea><button id="query-history">Queries</button><div><div id="query-library-host" hidden></div></div>';
  setLanguage("en");
  call.mockReset();
  entries = [entry(), entry("two", true)];
  current = scope;
  draft = "SELECT 7";
  dirty = false;
  call.mockImplementation(async (name: string, ...args: any[]) => {
    if (name === "Workbench.QueryLibrary")
      return entries.map((e) => ({ ...e }));
    if (name === "Workbench.SaveNamedQuery") {
      const [scope, sql, title] = args;
      const existing = entries.find(
        (e) => e.sql === sql && e.scope.path === scope.path,
      );
      if (existing) {
        existing.favorite = true;
        existing.name = title;
      } else
        entries.unshift({
          ...entry("new"),
          scope,
          sql,
          name: title,
          history: false,
          favorite: true,
        });
      return;
    }
    if (name === "Workbench.RenameSavedQuery") {
      entries.find((e) => e.id === args[0])!.name = args[1];
      return;
    }
    if (name === "Workbench.ChangeSavedQuery") {
      const [id, action] = args;
      if (action === "clear")
        entries = entries
          .filter((e) => e.favorite)
          .map((e) => ({ ...e, history: false }));
      if (action === "delete") entries = entries.filter((e) => e.id !== id);
      return;
    }
  });
  restore = vi.fn((sql: string) => {
    draft = sql;
  });
  report = vi.fn();
  library = new QueryLibrary(
    () => current,
    () => draft,
    restore,
    report,
    () => dirty,
  );
});
async function settled() {
  await vi.waitFor(() =>
    expect($("library-reload").getAttribute("aria-disabled")).toBe("false"),
  );
}
function submit() {
  $("library-name-form").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
}
function search(value: string) {
  $<HTMLInputElement>("library-search").value = value;
  $("library-search").dispatchEvent(new Event("input"));
}
it("uses an on-demand modal list/detail browser and searches exact SQL, paths and names safely", async () => {
  expect(call).not.toHaveBeenCalled();
  await library.show();
  expect($("query-library").tagName).toBe("DIALOG");
  expect(rows()).toHaveLength(1);
  expect($("library-preview").textContent).toBe(entry().sql);
  expect(document.querySelector("#query-library img")).toBeNull();
  expect(rows()[0].getAttribute("aria-pressed")).toBe("true");
  search("missing");
  expect(rows()).toHaveLength(0);
  expect($("library-preview").parentElement!.hidden).toBe(true);
  search("9223372036854775807");
  expect(rows()).toHaveLength(1);
  $<HTMLInputElement>("library-current").checked = false;
  $("library-current").dispatchEvent(new Event("change"));
  expect(rows()).toHaveLength(2);
  rows()
    .find((b) => b.dataset.libraryKey === "two")!
    .click();
  expect($<HTMLButtonElement>("library-open").disabled).toBe(true);
  $("library-open").click();
  expect(restore).not.toHaveBeenCalled();
  rows()
    .find((b) => b.dataset.libraryKey === "one")!
    .click();
  current = undefined;
  $("library-open").click();
  expect(restore).not.toHaveBeenCalled();
  current = scope;
  $("library-open").click();
  expect(restore).toHaveBeenCalledWith(entry().sql);
  expect($("query-library-host").hidden).toBe(true);
  expect(document.activeElement).toBe($("sql"));
  expect(call.mock.calls.every(([n]) => n === "Workbench.QueryLibrary")).toBe(
    true,
  );
});
it("names captured drafts, renames titles and finds saved queries by name", async () => {
  current = undefined;
  await library.saveCurrent();
  expect(call).not.toHaveBeenCalled();
  current = scope;
  await library.saveCurrent();
  expect($("library-name-form").hidden).toBe(false);
  expect(document.activeElement?.id).toBe("library-name");
  draft = "SELECT 999";
  $<HTMLInputElement>("library-name").value = "Daily <img> total";
  submit();
  await settled();
  expect(call).toHaveBeenCalledWith(
    "Workbench.SaveNamedQuery",
    scope,
    "SELECT 7",
    "Daily <img> total",
  );
  expect($("library-tab-1").getAttribute("aria-selected")).toBe("true");
  expect($("library-preview").textContent).toBe("SELECT 7");
  expect($("library-detail-title").textContent).toBe("Daily <img> total");
  expect(document.querySelector("#query-library img")).toBeNull();
  $("library-save").click();
  $<HTMLInputElement>("library-name").value = "Renamed query";
  submit();
  await settled();
  expect(call).toHaveBeenCalledWith(
    "Workbench.RenameSavedQuery",
    "new",
    "Renamed query",
  );
  search("Renamed");
  expect(rows()).toHaveLength(1);
  expect(report).toHaveBeenCalledWith("Query saved locally.", false);
});
it("requires explicit replacement of an edited draft and rechecks scope and busy state", async () => {
  dirty = true;
  await library.show();
  $("library-open").click();
  expect(restore).not.toHaveBeenCalled();
  expect($("library-open").textContent).toBe("Replace draft");
  $("library-cancel-replace").click();
  expect($("library-open").textContent).toBe("Open in editor");
  $("library-open").click();
  draft = "changed again";
  $("library-open").click();
  expect(restore).not.toHaveBeenCalled();
  library.update(true);
  $("library-open").click();
  $("library-save").click();
  $("library-delete").click();
  $("library-clear").click();
  await library.saveCurrent();
  expect(restore).not.toHaveBeenCalled();
  expect($("library-name-form").hidden).toBe(true);
  library.update(false);
  $("library-open").click();
  $("library-open").click();
  expect(restore).toHaveBeenCalledTimes(1);
});
it("has keyboard tabs and Escape, preserves saved queries when clearing, and deletes explicitly", async () => {
  entries[0].favorite = true;
  entries[0].name = "Saved title";
  await library.show();
  $("library-tab-0").dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  expect($("library-tab-1").getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement?.id).toBe("library-tab-1");
  expect($("library-clear").hidden).toBe(true);
  $("library-tab-1").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
  );
  expect($("library-tab-0").getAttribute("aria-selected")).toBe("true");
  $("library-clear").click();
  expect($("library-status").textContent).toContain("Saved queries are kept");
  $("library-clear").click();
  await settled();
  expect(entries).toHaveLength(1);
  expect(entries[0].history).toBe(false);
  $("library-tab-1").click();
  $("library-save").click();
  $("library-name").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect($("library-name-form").hidden).toBe(true);
  expect($("query-library-host").hidden).toBe(false);
  $("library-save").click();
  $("library-name-cancel").click();
  $("library-delete").click();
  await settled();
  expect(entries).toHaveLength(0);
  $("query-library").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect($("query-library-host").hidden).toBe(true);
  expect(document.activeElement?.id).toBe("query-history");
  library.toggle();
  await settled();
  library.toggle();
  expect($("query-library-host").hidden).toBe(true);
});
it("keeps focus during delayed saves, ignores repeat activation, and reports errors without losing the form", async () => {
  await library.saveCurrent();
  let finish!: () => void;
  call.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  $("library-name-submit").focus();
  submit();
  expect($("library-name-submit").getAttribute("aria-disabled")).toBe("true");
  submit();
  $("library-reload").click();
  expect(call).toHaveBeenCalledTimes(2);
  $("library-search").focus();
  finish();
  await settled();
  expect(document.activeElement?.id).toBe("library-search");
  await library.saveCurrent();
  call.mockRejectedValueOnce(new Error("invalid name"));
  submit();
  await settled();
  expect($("library-status").textContent).toContain("invalid name");
  expect($("library-name-form").hidden).toBe(false);
  call.mockRejectedValueOnce(new Error("denied"));
  $("library-delete").click();
  await settled();
  expect($("library-status").textContent).toContain("denied");
});
it("preserves unreadable state and ignores stale loads across collapse and reopen", async () => {
  call.mockResolvedValueOnce(undefined);
  await library.show();
  expect($("library-status").textContent).toContain(
    "No query library returned",
  );
  $("library-clear").click();
  expect(call).toHaveBeenCalledTimes(1);
  $("library-reload").click();
  await settled();
  expect(rows()).toHaveLength(1);
  let finish!: (value: QueryEntry[]) => void;
  call.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const loading = library.show();
  $("library-close").click();
  await library.show();
  finish([]);
  await loading;
  await settled();
  expect(rows()).toHaveLength(1);
  let reject!: (error: Error) => void;
  call.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const failing = library.show();
  $("library-close").click();
  reject(new Error("stale"));
  await failing;
  expect($("library-status").textContent).not.toContain("stale");
  call.mockRejectedValueOnce(new Error("read denied"));
  await library.saveCurrent();
  expect($("library-name-form").hidden).toBe(true);
});
it("cancels an unsent name on source change and translates controls without translating user text", async () => {
  await library.saveCurrent();
  current = { kind: "workspace", path: "/other" };
  library.update(false);
  expect($("library-name-form").hidden).toBe(true);
  expect(rows()).toHaveLength(0);
  current = scope;
  library.update(false);
  setLanguage("zh-CN");
  expect($("query-library-title").textContent).toBe("查询记录");
  expect($("library-tab-1").textContent).toBe("已保存");
  expect($("library-open").textContent).toBe("打开到编辑器");
  expect($("library-preview").textContent).toBe(entry().sql);
  dirty = true;
  $("library-open").click();
  $("query-library").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect($("query-library-host").hidden).toBe(false);
});

it("closes a native dialog cancellation and returns focus to its edge button", async () => {
  await library.show();
  expect($<HTMLDialogElement>("query-library").open).toBe(true);
  $("query-library").dispatchEvent(new Event("cancel", { cancelable: true }));
  expect($<HTMLDialogElement>("query-library").open).toBe(false);
  expect($("query-library-host").hidden).toBe(true);
  expect(document.activeElement).toBe($("query-history"));
});
