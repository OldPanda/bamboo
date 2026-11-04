import { Workbench, type QueryEntry, type QueryScope } from "./mygo";
import { rawText, setAttribute, setText, t } from "./i18n";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, key?: string) {
  const element = document.createElement(tag);
  if (key) setText(element, key);
  return element;
}
function button(id: string, key: string, action: () => void) {
  const element = node("button", key);
  element.id = id;
  element.type = "button";
  element.onclick = action;
  return element;
}
function same(a: QueryScope | undefined, b: QueryScope) {
  return a?.kind === b.kind && a.path === b.path;
}
function title(entry: QueryEntry) {
  return entry.name || entry.sql.trim().split(/\r?\n/)[0].slice(0, 120);
}

type Naming = { scope: QueryScope; sql: string } | { id: string };

/** On-demand history and saved-query dialog; opening SQL never executes it. */
export class QueryLibrary {
  private panel = node("dialog");
  private list = node("ul");
  private detail = node("section");
  private heading = node("h3");
  private source = node("p");
  private sql = node("pre");
  private status = node("p");
  private search = node("input");
  private current = node("input");
  private nameForm = node("form");
  private name = node("input");
  private nameSource = node("p");
  private tabs: HTMLButtonElement[] = [];
  private restoreButton: HTMLButtonElement;
  private saveButton: HTMLButtonElement;
  private remove: HTMLButtonElement;
  private clear: HTMLButtonElement;
  private cancelReplace: HTMLButtonElement;
  private entries: QueryEntry[] = [];
  private selected = "";
  private view = "history";
  private pending = false;
  private failed = false;
  private externalBusy = false;
  private confirmClear = false;
  private confirmDraft: string | undefined;
  private naming: Naming | undefined;
  private generation = 0;
  private context = "";
  private lastDraft = "";
  private host: HTMLElement;

  constructor(
    private scope: () => QueryScope | undefined,
    private draft: () => string,
    private restore: (sql: string) => void,
    private report: (message: string, error: boolean) => void,
    private dirty: () => boolean = () => false,
  ) {
    this.host = document.getElementById("query-library-host")!;
    this.panel.id = "query-library";
    this.panel.className = "query-library";
    this.panel.setAttribute("aria-labelledby", "query-library-title");
    const header = node("div");
    header.className = "library-header";
    const heading = node("h2", "Query history");
    heading.id = "query-library-title";
    header.append(
      heading,
      button("library-close", "Close query library", () => this.hide()),
    );
    const tabs = node("div");
    tabs.className = "tabs library-tabs";
    tabs.setAttribute("role", "tablist");
    setAttribute(tabs, "aria-label", "Query collections");
    for (const [index, key] of ["History", "Saved"].entries()) {
      const tab = button("library-tab-" + index, key, () => {
        this.view = index === 0 ? "history" : "saved";
        this.selected = "";
        this.cancelNaming();
        this.resetConfirmation();
        this.render();
      });
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "library-content");
      tab.onkeydown = (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const next =
          event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
        this.tabs[next].click();
        this.tabs[next].focus();
      };
      this.tabs.push(tab);
      tabs.append(tab);
    }
    const tools = node("div");
    tools.className = "library-tools";
    this.search.type = "search";
    this.search.id = "library-search";
    setAttribute(this.search, "aria-label", "Search queries");
    setAttribute(this.search, "placeholder", "Search queries");
    this.search.oninput = () => {
      this.resetConfirmation();
      this.render();
    };
    const label = node("label");
    this.current.type = "checkbox";
    this.current.id = "library-current";
    this.current.checked = true;
    this.current.onchange = () => {
      this.resetConfirmation();
      this.render();
    };
    label.append(this.current, node("span", "Current source only"));
    tools.append(this.search, label);
    this.status.id = "library-status";
    this.status.setAttribute("role", "status");
    const content = node("div");
    content.id = "library-content";
    content.setAttribute("role", "tabpanel");
    this.list.id = "library-list";
    this.list.className = "library-list";
    this.detail.className = "library-detail";
    this.heading.id = "library-detail-title";
    this.detail.setAttribute("aria-labelledby", this.heading.id);
    this.source.className = "library-source";
    this.sql.id = "library-preview";
    this.sql.tabIndex = 0;
    setAttribute(this.sql, "aria-label", "SQL preview");
    const actions = node("div");
    actions.className = "library-actions";
    this.restoreButton = button("library-open", "Open in editor", () =>
      this.openSelected(),
    );
    this.saveButton = button("library-save", "Save query", () => {
      const entry = this.entries.find((e) => e.id === this.selected);
      if (!entry || this.blocked()) return;
      this.beginNaming(
        entry.favorite
          ? { id: entry.id }
          : { scope: entry.scope, sql: entry.sql },
        title(entry),
      );
    });
    this.remove = button(
      "library-delete",
      "Delete query",
      () => void this.change(this.selected, "delete"),
    );
    this.cancelReplace = button("library-cancel-replace", "Keep draft", () => {
      this.resetConfirmation();
      this.render();
    });
    actions.append(
      this.restoreButton,
      this.cancelReplace,
      this.saveButton,
      this.remove,
    );
    this.detail.append(this.heading, this.source, this.sql, actions);
    this.nameForm.id = "library-name-form";
    this.nameForm.hidden = true;
    const nameLabel = node("label", "Query name");
    this.name.id = "library-name";
    nameLabel.htmlFor = this.name.id;
    this.name.type = "text";
    this.name.maxLength = 200;
    this.name.required = true;
    const submit = node("button", "Save query");
    submit.type = "submit";
    submit.id = "library-name-submit";
    const namingActions = node("div");
    namingActions.className = "library-actions";
    namingActions.append(
      submit,
      button("library-name-cancel", "Cancel", () => {
        this.cancelNaming();
        this.saveButton.focus();
      }),
    );
    this.nameForm.append(nameLabel, this.name, this.nameSource, namingActions);
    this.nameForm.onsubmit = (event) => {
      event.preventDefault();
      void this.submitName();
    };
    content.append(this.list, this.detail, this.nameForm);
    const footer = node("div");
    footer.className = "library-footer";
    this.clear = button("library-clear", "Clear history", () => {
      if (this.blocked()) return;
      if (!this.confirmClear) {
        this.confirmClear = true;
        setText(this.clear, "Confirm clear history");
        setText(
          this.status,
          "Clear history for all sources? Saved queries are kept.",
        );
        return;
      }
      void this.change("", "clear");
    });
    footer.append(
      button("library-reload", "Refresh queries", () => void this.load()),
      this.clear,
    );
    this.panel.append(header, tabs, tools, this.status, content, footer);
    this.panel.onkeydown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (this.naming) {
        this.cancelNaming();
        this.saveButton.focus();
      } else if (this.confirmDraft !== undefined) {
        this.resetConfirmation();
        this.render();
        this.restoreButton.focus();
      } else this.hide();
    };
    this.panel.oncancel = (event) => {
      event.preventDefault();
      this.hide();
    };
    this.host.append(this.panel);
    this.update(false);
  }

  /** Toggle the dialog without reserving space beside the editor. */
  toggle() {
    if (this.host.hidden) void this.show();
    else this.hide();
  }

  /** Load only on demand; opening a source or preview never reads the library. */
  async show() {
    this.host.hidden = false;
    if (!this.panel.open) {
      this.panel.showModal();
      this.search.focus();
    }
    document
      .getElementById("query-history")
      ?.setAttribute("aria-expanded", "true");
    this.resetConfirmation();
    await this.load();
  }

  private hide() {
    this.host.hidden = true;
    if (this.panel.open) this.panel.close();
    this.generation++;
    this.cancelNaming();
    this.resetConfirmation();
    const toggle = document.getElementById("query-history");
    toggle?.setAttribute("aria-expanded", "false");
    toggle?.focus();
  }

  /** Reflect source changes and app busy state without disabling the focused button. */
  update(busy: boolean) {
    const context = JSON.stringify(this.scope());
    const draft = this.draft();
    if (
      context !== this.context ||
      draft !== this.lastDraft ||
      busy !== this.externalBusy
    ) {
      if (context !== this.context) this.cancelNaming();
      this.context = context;
      this.lastDraft = draft;
      this.externalBusy = busy;
      this.resetConfirmation();
      this.render();
    }
  }

  /** Start a named save for a captured draft; typing and source switches never alter its SQL. */
  async saveCurrent() {
    const scope = this.scope();
    if (!scope || this.blocked()) return;
    const sql = this.draft();
    await this.show();
    if (same(this.scope(), scope) && !this.failed && !this.host.hidden)
      this.beginNaming(
        { scope, sql },
        sql.trim().split(/\r?\n/)[0].slice(0, 48),
      );
  }

  private blocked() {
    return this.pending || this.failed || this.externalBusy;
  }
  private cancelNaming() {
    this.naming = undefined;
    this.nameForm.hidden = true;
  }
  private resetConfirmation() {
    if (this.confirmClear || this.confirmDraft !== undefined)
      rawText(this.status, "");
    this.confirmClear = false;
    this.confirmDraft = undefined;
    setText(this.clear, "Clear history");
    setText(this.restoreButton, "Open in editor");
    this.cancelReplace.hidden = true;
  }
  private beginNaming(naming: Naming, name: string) {
    this.naming = naming;
    this.nameForm.hidden = false;
    this.name.value = name;
    rawText(
      this.nameSource,
      "scope" in naming ? naming.scope.path : this.source.textContent || "",
    );
    this.name.focus();
    this.name.select();
  }
  private async submitName() {
    const naming = this.naming;
    if (!naming || this.blocked()) return;
    const name = this.name.value.trim();
    this.pending = true;
    this.render();
    try {
      if ("id" in naming) await Workbench.renameSavedQuery(naming.id, name);
      else await Workbench.saveNamedQuery(naming.scope, naming.sql, name);
      this.cancelNaming();
      this.view = "saved";
      this.report("Query saved locally.", false);
      this.pending = false;
      if (!this.host.hidden) await this.load();
    } catch (error) {
      rawText(
        this.status,
        t("Could not save query: {error}", { error: String(error) }),
      );
    } finally {
      this.pending = false;
      this.render();
    }
  }
  private openSelected() {
    const entry = this.entries.find((e) => e.id === this.selected);
    if (!entry || this.blocked() || !same(this.scope(), entry.scope)) return;
    if (
      this.dirty() &&
      this.draft() !== entry.sql &&
      this.confirmDraft !== this.draft()
    ) {
      this.confirmDraft = this.draft();
      setText(this.restoreButton, "Replace draft");
      this.cancelReplace.hidden = false;
      setText(
        this.status,
        "Your editor has changes. Replace them with this query?",
      );
      return;
    }
    this.resetConfirmation();
    this.restore(entry.sql);
    this.hide();
    document.getElementById("sql")?.focus();
  }
  private async load() {
    if (this.pending) return;
    const generation = ++this.generation;
    this.pending = true;
    this.render();
    setText(this.status, "Loading saved queries…");
    try {
      const entries = await Workbench.queryLibrary();
      if (!Array.isArray(entries)) throw new Error("No query library returned");
      if (generation !== this.generation) return;
      this.entries = entries;
      this.failed = false;
      rawText(this.status, "");
    } catch (error) {
      if (generation !== this.generation) return;
      this.failed = true;
      rawText(
        this.status,
        t("Could not load saved queries: {error}", { error: String(error) }),
      );
    } finally {
      this.pending = false;
      if (generation === this.generation) this.render();
      else if (!this.host.hidden) void this.load();
    }
  }
  private async change(id: string, action: string) {
    if (this.blocked()) return;
    this.pending = true;
    this.render();
    try {
      await Workbench.changeSavedQuery(id, action);
      this.resetConfirmation();
      this.cancelNaming();
      this.pending = false;
      if (!this.host.hidden) await this.load();
    } catch (error) {
      rawText(
        this.status,
        t("Could not update saved queries: {error}", { error: String(error) }),
      );
    } finally {
      this.pending = false;
      this.render();
    }
  }
  private render() {
    const focused = (document.activeElement as HTMLElement)?.dataset.libraryKey;
    const query = this.search.value.toLocaleLowerCase();
    const entries = this.entries
      .filter(
        (e) =>
          (this.view === "saved" ? e.favorite : e.history) &&
          (!this.current.checked || same(this.scope(), e.scope)) &&
          (title(e) + "\n" + e.sql + "\n" + e.scope.path)
            .toLocaleLowerCase()
            .includes(query),
      )
      .sort((a, b) => b.updated.localeCompare(a.updated));
    const entry = entries.find((e) => e.id === this.selected) || entries[0];
    this.selected = entry?.id || "";
    this.tabs.forEach((tab, index) => {
      const selected = (this.view === "history") === (index === 0);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.classList.toggle("active", selected);
    });
    document
      .getElementById("library-content")!
      .setAttribute(
        "aria-labelledby",
        this.tabs[this.view === "history" ? 0 : 1].id,
      );
    this.list.replaceChildren();
    if (!entries.length) this.list.append(node("li", "No queries match."));
    for (const item of entries) {
      const row = node("li");
      const select = button("", "", () => {
        this.selected = item.id;
        this.cancelNaming();
        this.resetConfirmation();
        this.render();
      });
      select.className = "library-entry";
      select.dataset.libraryKey = item.id;
      select.setAttribute("aria-pressed", String(item.id === this.selected));
      const name = node("strong");
      rawText(name, title(item));
      const source = node("span");
      rawText(source, item.scope.path);
      const date = node("time");
      date.dateTime = item.updated;
      rawText(date, new Date(item.updated).toLocaleString());
      select.append(name);
      if (item.name) {
        const summary = node("span");
        rawText(summary, item.sql.trim().split(/\r?\n/)[0].slice(0, 120));
        select.append(summary);
      }
      select.append(source, date);
      row.append(select);
      this.list.append(row);
    }
    this.detail.hidden = !entry;
    if (entry) {
      rawText(this.heading, title(entry));
      rawText(this.source, entry.scope.path);
      rawText(this.sql, entry.sql);
      setText(this.saveButton, entry.favorite ? "Rename query" : "Save query");
      this.restoreButton.disabled = !same(this.scope(), entry.scope);
      if (this.restoreButton.disabled)
        setAttribute(
          this.restoreButton,
          "title",
          "Open the original source to use this query.",
        );
      else this.restoreButton.removeAttribute("title");
    }
    this.clear.hidden = this.view !== "history";
    for (const control of Array.from(
      this.panel.querySelectorAll<HTMLButtonElement>("button"),
    )) {
      if (
        !control.matches(
          "[role=tab],.library-entry,#library-close,#library-name-cancel,#library-cancel-replace",
        )
      )
        control.setAttribute(
          "aria-disabled",
          String(
            control.id === "library-reload" ? this.pending : this.blocked(),
          ),
        );
    }
    if (focused && !this.host.hidden) {
      const target = Array.from(
        this.list.querySelectorAll<HTMLButtonElement>("button"),
      ).find((b) => b.dataset.libraryKey === focused);
      (target || this.search).focus();
    }
  }
}
