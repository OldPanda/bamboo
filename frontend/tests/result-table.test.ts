import { afterEach, describe, expect, it } from "vitest";
import { updateWideTable } from "../src/result-table";
import { setLanguage } from "../src/i18n";
import type { Result } from "../src/mygo";

function page(width = 65, rows = 2): Result {
  return {
    columns: Array.from({ length: width }, (_, i) => ({
      name: `c${i}`,
      type: i === 1 ? "BIGINT" : "VARCHAR",
    })),
    rows: Array.from({ length: rows }, () =>
      Array.from({ length: width }, (_, i) =>
        i === 1
          ? "9007199254740993"
          : i === 2
            ? null
            : i === 3
              ? ""
              : `<script>${i}</script>`,
      ),
    ),
    offset: 999,
    pageSize: rows,
    more: false,
    elapsedMS: 1,
  };
}
function table() {
  const table = document.createElement("table");
  table.createTHead();
  table.createTBody();
  document.body.append(table);
  return table;
}
afterEach(() => {
  document.body.replaceChildren();
  setLanguage("en");
});
describe("complete wide result tables", () => {
  it("keeps every exact value as text, with NULL and localized empty cells", () => {
    const t = table(),
      r = page(2048, 62);
    expect(updateWideTable(t, r)).toBe(true);
    expect(t.tBodies[0].rows.length).toBe(62);
    for (const row of t.tBodies[0].rows) expect(row.cells.length).toBe(2049);
    expect(t.querySelector("script")).toBeNull();
    const cells = t.tBodies[0].rows[0].cells;
    expect(cells[0].textContent).toBe("1,000");
    expect(cells[2].textContent).toBe("9007199254740993");
    expect(cells[2].className).toBe("numeric");
    expect(cells[3].textContent).toBe("NULL");
    expect(cells[3].className).toBe("null");
    expect(cells[4].textContent).toBe("empty");
    setLanguage("zh-CN");
    expect(cells[4].textContent).not.toBe("empty");
    expect(cells[2048].textContent).toBe(r.rows[0][2047]);
    expect(t.querySelectorAll("[aria-hidden]").length).toBe(0);
  });
  it("reuses cells, clears obsolete rows/columns, and removes stale translations", () => {
    const t = table(),
      r = page();
    updateWideTable(t, r);
    const cells = t.tBodies[0].rows[0].cells;
    const node = cells[1].firstChild;
    updateWideTable(t, r);
    expect(cells[1].firstChild).toBe(node);
    r.rows[0][3] = "empty";
    r.columns[0].type = "DECIMAL(38,9)";
    r.rows[0][0] = "12345678901234567890.123456789";
    updateWideTable(t, r);
    setLanguage("zh-CN");
    expect(cells[4].textContent).toBe("empty");
    expect(cells[1].dataset.type).toBe("DECIMAL(38,9)");
    expect(cells[1].textContent).toBe(r.rows[0][0]);
    updateWideTable(t, page(70, 3));
    expect(t.tBodies[0].rows[2].cells.length).toBe(71);
    updateWideTable(t, page(65, 1));
    expect(t.tBodies[0].rows.length).toBe(1);
    expect(t.tBodies[0].rows[0].cells.length).toBe(66);
    expect(t.querySelector("colgroup")!.children.length).toBe(66);
    updateWideTable(t, page(65, 0));
    expect(t.tBodies[0].rows.length).toBe(0);
  });
  it("bounds wide widths in font-relative units and restores narrow auto layout", () => {
    const t = table(),
      r = page();
    r.columns[0].name = "长".repeat(200);
    r.rows[0][1] = "9".repeat(1000);
    updateWideTable(t, r);
    expect(t.querySelectorAll("col")[1].style.width).toBe("27.6em");
    expect(t.querySelectorAll("col")[2].style.width).toBe("27.6em");
    expect(t.style.width).toMatch(/em$/);
    expect(updateWideTable(t, page(64))).toBe(false);
    expect(t.className).toBe("");
    expect(t.style.width).toBe("");
    expect(t.querySelector("colgroup")).toBeNull();
    expect(updateWideTable(t, page(0, 0))).toBe(false);
  });
});
