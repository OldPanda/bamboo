const checks = [];
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
  checks.push(message);
};
const $ = (id) => document.getElementById(id);
const wait = async () => {
  for (let i = 0; i < 200; i++) {
    if ($("busy").hidden) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("UI stayed busy");
};
const click = async (id) => {
  $(id).click();
  await wait();
};
assert(
  document.querySelectorAll("#grid tbody tr").length === 100,
  "first page: 100 real rows",
);
assert($("row-count").textContent === "240", "footer metadata: 240 rows");
await click("next");
assert(
  document.querySelector("#grid tbody tr td").textContent === "101",
  "next page starts at row 101",
);
await click("next");
assert(
  document.querySelectorAll("#grid tbody tr").length === 40 &&
    $("next").disabled,
  "last page: 40 rows, next disabled",
);
$("filter-column").value = "city";
$("filter-value").value = "Kyoto";
$("filter-form").requestSubmit();
await wait();
assert(
  document.querySelectorAll("#grid tbody tr").length === 60,
  "contains filter: 60 Kyoto rows",
);
await click("clear-filter");
document.querySelectorAll("#grid th button")[0].click();
await wait();
document.querySelectorAll("#grid th button")[0].click();
await wait();
assert(
  document.querySelectorAll("#grid tbody tr:first-child td")[1].textContent ===
    "1240",
  "descending sort: highest order first",
);
await click("tab-sql");
$("sql").value =
  "SELECT city, count(*) AS orders, sum(amount) AS revenue FROM data GROUP BY city ORDER BY city";
await click("run");
assert(
  document.querySelectorAll("#grid tbody tr").length === 4,
  "SQL aggregation: four cities",
);
await click("tab-schema");
assert(
  document.querySelectorAll("#schema-body tr").length === 7,
  "schema: seven typed columns",
);
await click("tab-sql");
const path = await mygo.call("Workbench.InitialFile");
const special = path.replace(/orders\.parquet$/, "special.parquet");
const specialMeta = await mygo.call("Workbench.OpenPath", special);
const specialRows = await mygo.call("Workbench.Query", {
  sql: "SELECT * FROM data",
  offset: 0,
  limit: 100,
  sort: "",
  desc: false,
  filterColumn: "",
  filterValue: "",
});
assert(
  specialRows.rows[0][0] === "9223372036854775807",
  "IPC keeps 64-bit integer exact",
);
assert(
  specialRows.rows[0][2] === "12345678901234567890.123456789",
  "IPC keeps decimal exact",
);
assert(
  specialRows.rows[0][8] === null && specialRows.rows[0][9] === "",
  "IPC distinguishes null and empty string",
);
let rejected = false;
try {
  await mygo.call("Workbench.Query", {
    sql: "SELECT 1; DROP VIEW data",
    limit: 100,
    offset: 0,
  });
} catch {
  rejected = true;
}
assert(rejected, "IPC rejects multiple SQL statements");
// Restore the actual UI/session after direct IPC checks.
await mygo.call("Workbench.OpenPath", path);
$("sql").value = "SELECT * FROM data";
await click("run");
await click("tab-data");
const plainCell = document.querySelectorAll("#grid tbody tr:first-child td")[1];
plainCell.click();
const cellRange = document.createRange();
cellRange.selectNodeContents(plainCell);
const cellSelection = window.getSelection();
cellSelection.removeAllRanges();
cellSelection.addRange(cellRange);
assert(
  !document.querySelector("dialog, [role=dialog]") &&
    cellSelection.toString() === "1001" &&
    getComputedStyle(plainCell).cursor === "text",
  "cell click stays in table; exact text remains selectable",
);
cellSelection.removeAllRanges();
await click("tab-sql");
$("sql").value =
  "SELECT '<img src=x onerror=alert(1)>' AS html, NULL AS missing, '' AS empty_text, 9223372036854775807::BIGINT AS exact_id";
await click("run");
assert(
  !document.querySelector("#grid img") &&
    document.querySelectorAll("#grid tbody tr:first-child td")[1]
      .textContent === "<img src=x onerror=alert(1)>",
  "untrusted HTML renders as literal text",
);
assert(
  document.querySelectorAll("#grid tbody td.null").length === 1 &&
    document.querySelectorAll("#grid tbody td.empty-string").length === 1,
  "grid distinguishes null and empty string",
);
$("sql").value = "SELECT * FROM data";
await click("run");
await click("tab-data");
assert($("notification").hidden, "no frontend error");
return {
  checks,
  userAgent: navigator.userAgent,
  rows: document.querySelectorAll("#grid tbody tr").length,
  viewport: { width: innerWidth, height: innerHeight },
  layout: (() => {
    const grid = $("grid-scroll").getBoundingClientRect();
    const rows = [...document.querySelectorAll("#grid tbody tr")];
    return {
      gridTop: grid.top,
      gridHeight: grid.height,
      fullyVisibleRows: rows.filter(row => {
        const rect = row.getBoundingClientRect();
        return rect.top >= document.querySelector("#grid thead").getBoundingClientRect().bottom && rect.bottom <= grid.bottom;
      }).length,
      numericAlignment: getComputedStyle(document.querySelector("#grid td.numeric")).textAlign,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  })(),
};
