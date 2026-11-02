import type { Result } from "./mygo";
import { rawText, setText } from "./i18n";

/** Keep wide pages as complete native tables. Fixed, font-relative columns avoid
 * auto-layout scanning every cell; updating existing text nodes avoids rebuilding
 * the bounded page. Selection, browser find and accessibility keep every column.
 */
export function updateWideTable(
  table: HTMLTableElement,
  result: Result,
): boolean {
  const wide = result.columns.length > 64;
  table.classList.toggle("wide-result", wide);
  if (!wide) {
    table.querySelector("colgroup")?.remove();
    table.style.width = "";
    return false;
  }
  const widths = result.columns.map((column, index) => {
    let length = Math.max(column.name.length, column.type.length, 16);
    for (const row of result.rows)
      length = Math.max(length, (row[index] ?? "NULL").length);
    return Math.min(40, length) * 0.64 + 2;
  });
  let group = table.querySelector("colgroup");
  if (!group) {
    group = document.createElement("colgroup");
    table.prepend(group);
  }
  const allWidths = [4, ...widths];
  while (group.children.length > allWidths.length)
    group.lastElementChild!.remove();
  const cols = Array.from(group.children) as HTMLTableColElement[];
  allWidths.forEach((width, index) => {
    let col = cols[index];
    if (!col) {
      col = document.createElement("col");
      group!.append(col);
    }
    col.style.width = width + "em";
  });
  table.style.width = allWidths.reduce((sum, width) => sum + width, 0) + "em";
  const body = table.tBodies[0];
  while (body.rows.length > result.rows.length) body.deleteRow(-1);
  const rows = Array.from(body.rows);
  const added = document.createDocumentFragment();
  result.rows.forEach((values, rowIndex) => {
    const row = rows[rowIndex] ?? document.createElement("tr");
    if (!rows[rowIndex]) added.append(row);
    while (row.cells.length > allWidths.length) row.deleteCell(-1);
    const cells = Array.from(row.cells);
    allWidths.forEach((_, index) => {
      const cell = cells[index] ?? document.createElement("td");
      if (!cells[index]) row.append(cell);
      const value = index
        ? values[index - 1]
        : String(result.offset + rowIndex + 1).replace(
            /\B(?=(\d{3})+(?!\d))/g,
            ",",
          );
      const type = index ? result.columns[index - 1].type : "";
      const text = value === null ? "NULL" : value;
      const cls = !index
        ? "row-number"
        : value === null
          ? "null"
          : value === ""
            ? "empty-string"
            : /INT|DECIMAL|FLOAT|DOUBLE/.test(type)
              ? "numeric"
              : "";
      // Keeping unchanged nodes also preserves selections during a no-op refresh.
      if (value === "") {
        if (!cells[index] || cell.className !== "empty-string")
          setText(cell, "empty");
      } else if (!cells[index]) cell.textContent = text;
      else if (cell.textContent !== text || cell.className === "empty-string")
        rawText(cell, text);
      if (!cells[index] || cell.className !== cls) cell.className = cls;
      if (index && (!cells[index] || cell.dataset.type !== type))
        cell.dataset.type = type;
    });
  });
  body.append(added);
  return true;
}
