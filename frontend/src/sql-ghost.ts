import { setText } from "./i18n";
import { suggestSQL, type SQLCompletionContext } from "./sql-completion";

/** A visual overlay on the native textarea: no menu, network or editor replacement. */
export function attachSQLGhost(
  editor: HTMLTextAreaElement,
  context: () => SQLCompletionContext,
  enabled: () => boolean,
) {
  const host = editor.parentElement!;
  const mirror = document.createElement("div");
  mirror.className = "sql-caret-mirror";
  mirror.setAttribute("aria-hidden", "true");
  const prefix = document.createTextNode("");
  const anchor = document.createElement("span");
  anchor.textContent = "\u200b";
  mirror.append(prefix, anchor);
  const clip = document.createElement("div");
  clip.className = "sql-ghost-clip";
  clip.setAttribute("aria-hidden", "true");
  const ghost = document.createElement("span");
  ghost.id = "sql-ghost";
  clip.append(ghost);
  const hint = document.createElement("span");
  hint.id = "sql-completion-help";
  hint.className = "sr-only";
  setText(hint, "Inline suggestions: Tab to accept, Escape to dismiss.");
  editor.setAttribute("aria-describedby", hint.id);
  editor.setAttribute("aria-autocomplete", "inline");
  host.append(mirror, clip, hint);
  let composing = false,
    dismissed = "",
    suffix = "";
  const key = () => `${editor.selectionStart}:${editor.value}`;
  const hide = () => {
    suffix = "";
    ghost.textContent = "";
    clip.hidden = true;
  };
  function refresh() {
    hide();
    if (
      composing ||
      !enabled() ||
      editor.disabled ||
      document.activeElement !== editor ||
      editor.selectionStart !== editor.selectionEnd ||
      dismissed === key()
    )
      return;
    suffix = suggestSQL(editor.value, editor.selectionStart, context());
    if (!suffix) return;
    prefix.textContent = editor.value.slice(0, editor.selectionStart);
    // clientWidth excludes the scrollbar, so line wrapping agrees with the textarea.
    mirror.style.width = `${editor.clientWidth + 2}px`;
    ghost.textContent = suffix;
    ghost.style.left = `${anchor.offsetLeft - editor.scrollLeft - 1}px`;
    ghost.style.top = `${anchor.offsetTop - editor.scrollTop - 1}px`;
    clip.hidden = false;
  }
  editor.addEventListener("input", (event) => {
    dismissed = "";
    if (!(event as InputEvent).isComposing) refresh();
    else hide();
  });
  editor.addEventListener("compositionstart", () => {
    composing = true;
    hide();
  });
  editor.addEventListener("compositionend", () => {
    composing = false;
    dismissed = "";
    refresh();
  });
  for (const type of ["focus", "click", "keyup", "scroll", "select"])
    editor.addEventListener(type, refresh);
  editor.addEventListener("blur", hide);
  document.addEventListener("selectionchange", refresh);
  editor.addEventListener("keydown", (event) => {
    if (event.isComposing || composing) return;
    if (event.key === "Escape" && suffix) {
      event.preventDefault();
      event.stopPropagation();
      dismissed = key();
      hide();
      return;
    }
    if (
      event.key !== "Tab" ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    refresh();
    if (!suffix) return;
    event.preventDefault();
    const insertion = suffix;
    hide();
    // WebKit insertText preserves native undo; tests/other hosts have a range fallback.
    let inserted = false;
    if (typeof document.execCommand === "function") {
      try {
        inserted = document.execCommand("insertText", false, insertion);
      } catch {
        /* use the native range fallback */
      }
    }
    if (!inserted) {
      editor.setRangeText(
        insertion,
        editor.selectionStart,
        editor.selectionEnd,
        "end",
      );
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
    refresh();
  });
  if (typeof ResizeObserver !== "undefined")
    new ResizeObserver(refresh).observe(editor);
  hide();
  return { refresh, hide };
}
