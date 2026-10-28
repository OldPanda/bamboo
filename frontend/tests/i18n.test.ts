import { beforeEach, describe, expect, it, vi } from "vitest";
let i: typeof import("../src/i18n");
beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = "";
  i = await import("../src/i18n");
  i.setLanguage("en");
});
describe("interface localization", () => {
  it("translates static text and labels in place, retaining icons, inputs and SQL", () => {
    document.body.innerHTML =
      '<section id="s"><button title="Open data" aria-label="Open data">  Open data <svg><text>Open data</text></svg></button><label>Text to match<input placeholder="Text to match" value="Settings"></label><textarea>SELECT * FROM data</textarea><code>Settings</code><div>Unknown copy</div></section>';
    const root = document.querySelector("section")!;
    const input = document.querySelector("input")!;
    input.focus();
    i.localizeStatic(root);
    i.setLanguage("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.querySelector("button")!.firstChild!.textContent).toBe(
      "  打开数据 ",
    );
    expect(document.querySelector("svg text")!.textContent).toBe("Open data");
    expect(input.placeholder).toBe("要匹配的文本");
    expect(input.value).toBe("Settings");
    expect(document.activeElement).toBe(input);
    expect(document.querySelector("textarea")!.value).toBe(
      "SELECT * FROM data",
    );
    expect(document.querySelector("code")!.textContent).toBe("Settings");
    expect(document.querySelector("button")!.title).toBe("打开数据");
    i.setLanguage("en");
    expect(input.placeholder).toBe("Text to match");
    expect(document.querySelector("button")!.firstChild!.textContent).toBe(
      "  Open data ",
    );
  });
  it("binds safe dynamic values, keeps placeholders and does not translate data", () => {
    const p = document.createElement("p");
    document.body.append(p);
    i.setText(p, "Delete “{name}”?", { name: "<img src=x>Settings" });
    i.setLanguage("zh-CN");
    expect(p.textContent).toBe("删除“<img src=x>Settings”？");
    expect(p.children.length).toBe(0);
    expect(i.t("Missing {name}")).toBe("Missing {name}");
    expect(i.t("{name} {rows}", { name: "{rows}", rows: 42 })).toBe(
      "{rows} 42",
    );
    i.rawText(p, "Settings");
    i.setLanguage("en");
    i.setLanguage("zh-CN");
    expect(p.textContent).toBe("Settings");
    const raw = document.createElement("p");
    i.rawText(raw, "Settings");
    expect(raw.textContent).toBe("Settings");
  });
  it("drops stale bindings without overwriting newly assigned data or retaining detached nodes", () => {
    const a = document.createElement("p"),
      b = document.createElement("p"),
      c = document.createElement("p");
    document.body.append(a, b, c);
    i.setText(a, "Settings");
    i.setText(a, "Mode");
    i.setAttribute(a, "title", "Settings");
    i.setText(b, "Settings");
    i.setText(c, "Settings");
    a.textContent = "user value";
    a.title = "custom title";
    b.remove();
    i.setLanguage("zh-CN");
    expect(a.textContent).toBe("user value");
    expect(a.title).toBe("custom title");
    expect(b.textContent).toBe("Settings");
    c.remove();
    i.pruneTranslations();
    document.body.append(c);
    i.setLanguage("en");
    expect(c.textContent).toBe("设置");
  });
  it("contains complete translations with matching interpolation names", () => {
    for (const [key, value] of Object.entries(i.chinese)) {
      expect(value.trim()).not.toBe("");
      expect([...value.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort()).toEqual(
        [...key.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort(),
      );
    }
  });
});
