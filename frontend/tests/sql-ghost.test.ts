import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attachSQLGhost } from "../src/sql-ghost";
let editor: HTMLTextAreaElement;
let enabled = true;
let selectionListener: EventListenerOrEventListenerObject;
let resize: () => void;
const originalExec = Object.getOwnPropertyDescriptor(document, "execCommand");
beforeEach(() => {
  document.body.innerHTML = '<div><textarea id="editor"></textarea></div>';
  editor = document.getElementById("editor") as HTMLTextAreaElement;
  enabled = true;
  Object.defineProperty(editor, "clientWidth", { value: 400 });
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(
    (type, listener, options) => {
      if (type === "selectionchange") selectionListener = listener;
      add(type, listener, options);
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
    },
  );
  attachSQLGhost(
    editor,
    () => ({ tables: [{ name: "data", columns: ["customer_id"] }] }),
    () => enabled,
  );
});
afterEach(() => {
  document.removeEventListener("selectionchange", selectionListener);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalExec)
    Object.defineProperty(document, "execCommand", originalExec);
  else delete (document as any).execCommand;
});
function type(text: string) {
  editor.focus();
  editor.value = text;
  editor.setSelectionRange(text.length, text.length);
  editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
}
function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    cancelable: true,
    ...options,
  });
  editor.dispatchEvent(event);
  return event;
}
const ghost = () => document.getElementById("sql-ghost")!.textContent;
it("keeps geometry synced and hides during composition or disabled execution", () => {
  type("select * fro");
  expect(ghost()).toBe("m");
  resize();
  expect(ghost()).toBe("m");
  editor.scrollTop = 20;
  editor.scrollLeft = 10;
  editor.dispatchEvent(new Event("scroll"));
  expect(document.getElementById("sql-ghost")!.style.left).toBe("-11px");
  editor.dispatchEvent(new InputEvent("input", { isComposing: true }));
  expect(ghost()).toBe("");
  editor.dispatchEvent(new CompositionEvent("compositionend"));
  expect(ghost()).toBe("m");
  enabled = false;
  document.dispatchEvent(new Event("selectionchange"));
  expect(ghost()).toBe("");
  enabled = true;
  editor.disabled = true;
  resize();
  expect(ghost()).toBe("");
  editor.disabled = false;
  resize();
  expect(ghost()).toBe("m");
  expect(press("Tab", { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(press("ArrowRight").defaultPrevented).toBe(false);
});
it("prefers native text insertion so browser undo stays available", () => {
  const execute = vi.fn((_command: string, _ui: boolean, suffix: string) => {
    editor.setRangeText(
      suffix,
      editor.selectionStart,
      editor.selectionEnd,
      "end",
    );
    editor.dispatchEvent(new Event("input"));
    return true;
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execute,
  });
  type("select * fro");
  press("Tab");
  expect(execute).toHaveBeenCalledWith("insertText", false, "m");
  expect(editor.value).toBe("select * from");
});
it.each(["unavailable", "throws"])(
  "falls back when native insertion %s",
  (mode) => {
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => {
        if (mode === "throws") throw Error("unsupported");
        return false;
      },
    });
    type("select * fro");
    press("Tab");
    expect(editor.value).toBe("select * from");
    expect(ghost()).toBe("");
  },
);
