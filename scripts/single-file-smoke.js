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
await click("export");
$("export-scope").value = "full";
for (const format of ["json", "csv", "jsonl", "tsv"]) {
  if (!$("export-dialog").open) await click("export");
  await click("export-" + format);
  const progress = await mygo.call("Workbench.GetExportProgress");
  assert(
    !progress.running &&
      progress.rows === "240" &&
      !$("notification").classList.contains("error"),
    "native complete " + format + " export writes every row through IPC",
  );
}
assert(
  document.querySelectorAll("#grid tbody tr").length === 100,
  "complete export preserves the bounded preview",
);
assert(
  $("tab-explore").textContent === "Explore Data" &&
    !$("sql-panel").hidden &&
    !$("data-panel").hidden &&
    $("sql").getBoundingClientRect().bottom <=
      $("grid-scroll").getBoundingClientRect().top &&
    !document.querySelector("#tab-data, #tab-sql"),
  "Explore Data shows query editor above preview on file open",
);
await click("analyze");
$("profile-column").value = "city";
await click("profile-run");
let statistics = document.querySelectorAll(
  "#profile-result table:first-child tbody tr",
);
assert(
  statistics[0].lastChild.textContent === "240" &&
    statistics[2].lastChild.textContent === "4",
  "native column profile uses all 240 query rows",
);
$("profile-column").value = "note";
await click("profile-run");
statistics = document.querySelectorAll(
  "#profile-result table:first-child tbody tr",
);
assert(
  statistics[1].lastChild.textContent === "35" &&
    statistics[2].lastChild.textContent === "1",
  "native profile preserves NULL and distinct semantics",
);
$("pivot-group").value = "city";
$("pivot-operation").value = "SUM";
$("pivot-operation").dispatchEvent(new Event("change"));
$("pivot-metric").value = "order_id";
await click("pivot-run");
const pivotRows = document.querySelectorAll("#pivot-result tbody tr");
assert(
  pivotRows.length === 4 &&
    pivotRows[0].firstChild.textContent === "Copenhagen" &&
    pivotRows[0].lastChild.textContent === "67320",
  "native pivot matches the complete-query aggregate oracle",
);
await click("pivot-export");
await click("export-json");
assert(
  $("analysis-status").textContent.includes("bamboo-pivot.json"),
  "native pivot export writes its separate snapshot",
);
await click("analysis-dismiss");
assert(
  document.querySelectorAll("#grid tbody tr").length === 100 &&
    document.querySelectorAll("#grid tbody tr:first-child td")[1]
      .textContent === "1001",
  "native analysis retains the original preview",
);
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
  document.querySelectorAll("#grid tbody tr:first-child td")[1]
    .textContent === "1240",
  "descending sort: highest order first",
);
await click("tab-explore");
$("sql").value =
  "SELECT city, count(*) AS orders, sum(amount) AS revenue FROM data GROUP BY city ORDER BY city";
await click("run");
assert(
  document.querySelectorAll("#grid tbody tr").length === 4,
  "SQL aggregation: four cities",
);
await click("tab-schema");
assert(
  $("sql-panel").hidden && $("data-panel").hidden,
  "Schema hides editor and preview together",
);
assert(
  document.querySelectorAll("#schema-body tr").length === 7,
  "schema: seven typed columns",
);
await click("tab-explore");
assert(
  !$("sql-panel").hidden &&
    !$("data-panel").hidden &&
    document.querySelectorAll("#grid tbody tr").length === 4,
  "Explore Data restores query results after Schema",
);
const path = await mygo.call("Workbench.InitialFile");
const special = path.replace(/orders\.parquet$/, "special.parquet");
await mygo.call("Workbench.OpenPath", special);
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
// Exercise native settings IPC without starting the network updater in smoke builds.
await mygo.call("Workbench.SetAppearance", "dark");
assert(
  (await mygo.call("Workbench.Appearance")) === "dark",
  "appearance persists through native IPC",
);
await mygo.call("Workbench.SetAppearance", "system");
const updateStatus = await mygo.call("Workbench.UpdateStatus");
assert(
  updateStatus.available === false &&
    updateStatus.canCheck === (smokePlatform !== "darwin") &&
    typeof updateStatus.automatic === "boolean",
  "smoke updater reports platform-appropriate manual checks and boolean preferences",
);
for (const [method, args] of [
  ...(smokePlatform === "darwin" ? [["Workbench.CheckForUpdates", []]] : []),
  ["Workbench.SetAutomaticUpdates", [true]],
  ["Workbench.SetAutomaticUpdates", [false]],
]) {
  let failed = false;
  try {
    await mygo.call(method, ...args);
  } catch {
    failed = true;
  }
  assert(failed, method + " rejects unavailable updater without opening UI");
}
// Restore the actual UI/session after direct IPC checks.
await mygo.call("Workbench.OpenPath", path);
$("sql").value = "SELECT * FROM data";
await click("run");
await click("tab-explore");
const plainCell = document.querySelectorAll(
  "#grid tbody tr:first-child td",
)[1];
plainCell.click();
const cellRange = document.createRange();
cellRange.selectNodeContents(plainCell);
const cellSelection = window.getSelection();
cellSelection.removeAllRanges();
cellSelection.addRange(cellRange);
assert(
  !document.querySelector("dialog[open], [role=dialog]:not([hidden])") &&
    cellSelection.toString() === "1001" &&
    getComputedStyle(plainCell).cursor === "text",
  "cell click stays in table; exact text remains selectable",
);
cellSelection.removeAllRanges();
await click("tab-explore");
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
await click("tab-explore");
// Reopen the real CSV produced by the native full-result export above.
const originalPath = await mygo.call("Workbench.InitialFile");
const csvPath = smokeDirectory + "/bamboo-result.csv";
const csvFile = await mygo.call("Workbench.OpenPath", csvPath);
assert(
  csvFile.textOptions.header &&
    csvFile.columns.every((c) => c.type === "VARCHAR"),
  "native CSV preserves text by default",
);
// Drive the existing UI document activation using the already-created export.
window.__mygo.receive({
  t: "event",
  n: "mygo:file-drop",
  p: { paths: [csvPath], x: 0, y: 0 },
});
await new Promise((resolve) => setTimeout(resolve, 100));
await wait();
assert(
  !$("text-info").hidden && $("row-count").textContent === "—",
  "native CSV displays reading options and unknown row count",
);
await click("text-options");
$("text-header").checked = false;
$("text-form").requestSubmit();
await wait();
assert(
  document.querySelectorAll("#grid tbody tr:first-child td")[1]
    .textContent === "order_id",
  "native header option retains the first record as data",
);
await click("text-options");
$("text-header").checked = true;
$("text-types").value = "infer";
$("text-form").requestSubmit();
await wait();
$("sql").value =
  "SELECT count(*) AS n, max(order_id) + 1 AS next_id FROM data";
await click("run");
assert(
  document.querySelectorAll("#grid tbody tr:first-child td")[1]
    .textContent === "240" &&
    document.querySelectorAll("#grid tbody tr:first-child td")[2]
      .textContent === "1241",
  "native CSV query covers all 240 rows with inferred integers",
);
window.__mygo.receive({
  t: "event",
  n: "mygo:file-drop",
  p: { paths: [originalPath], x: 0, y: 0 },
});
await new Promise((resolve) => setTimeout(resolve, 100));
await wait();
assert(
  $("text-info").hidden &&
    document.querySelectorAll("#grid tbody tr").length === 100,
  "native Parquet recovery after CSV",
);
// Exercise the production wide renderer through native IPC on every platform.
// The source is the real generated Parquet; the projection keeps the SQL bounded.
const wideColumns = Array.from({ length: 2048 }, (_, i) => `1 c${i}`);
wideColumns[0] = "order_id c0";
wideColumns[1] = "9007199254740993::BIGINT c1";
wideColumns[2] = "NULL::VARCHAR c2";
wideColumns[3] = "'' c3";
wideColumns[2047] = "12345678901234567890.1234::DECIMAL(30,4) c2047";
$("sql").value =
  `SELECT ${wideColumns.join(",")} FROM data ORDER BY order_id`;
await click("run");
const wideGrid = $("grid");
assert(
  wideGrid.classList.contains("wide-result") &&
    wideGrid.tBodies[0].rows.length === 62 &&
    [...wideGrid.tBodies[0].rows].every((row) => row.cells.length === 2049),
  "native wide page retains all 2048 columns within 128000 cells",
);
let wideRow = wideGrid.tBodies[0].rows[0];
assert(
  wideRow.cells[2].textContent === "9007199254740993" &&
    wideRow.cells[3].textContent === "NULL" &&
    wideRow.cells[4].className === "empty-string" &&
    wideRow.cells[2048].textContent === "12345678901234567890.1234",
  "native wide page preserves exact integers decimals NULL and empty text",
);
const wideSelection = document.createRange();
wideSelection.setStart(wideRow.cells[2].firstChild, 0);
wideSelection.setEnd(wideRow.cells[2048].firstChild, 25);
getSelection().removeAllRanges();
getSelection().addRange(wideSelection);
assert(
  getSelection().toString().includes("9007199254740993") &&
    getSelection().toString().includes("12345678901234567890.1234"),
  "native selection spans offscreen columns without losing values",
);
getSelection().removeAllRanges();
const wideViewport = innerWidth;
for (const [zoom, font] of [
  [75, 12],
  [200, 20],
  [100, 13],
]) {
  $("settings").click();
  $("display-zoom").value = String(zoom);
  $("display-font").value = String(font);
  $("display-form").requestSubmit();
  for (let attempt = 0; attempt < 150; attempt++) {
    if (
      $("display-form").getAttribute("aria-busy") === "false" &&
      Math.abs((innerWidth * zoom) / 100 - wideViewport) <= 3
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  $("settings-dismiss").click();
  assert(
    Math.abs((innerWidth * zoom) / 100 - wideViewport) <= 3 &&
      [wideRow.cells[1], wideRow.cells[3], wideRow.cells[4]].every(
        (cell) => getComputedStyle(cell).fontSize === font + "px",
      ),
    "native wide ordinary NULL and empty cells at " +
      zoom +
      "% zoom and " +
      font +
      "px",
  );
}
$("grid-scroll").scrollLeft = 1000000;
await new Promise((resolve) => setTimeout(resolve, 80));
assert(
  wideRow.cells[2048].getBoundingClientRect().left <
    $("grid-scroll").getBoundingClientRect().right,
  "native horizontal scrolling reaches the last wide column",
);
await click("next");
wideRow = wideGrid.tBodies[0].rows[0];
assert(
  wideRow.cells[1].textContent === "1063" &&
    wideGrid.tBodies[0].rows.length === 62,
  "native wide pagination reuses cells at the effective row offset",
);
await click("previous");
assert(
  wideGrid.tBodies[0].rows[0].cells[1].textContent === "1001",
  "native wide previous page restores exact first row",
);
$("sql").value = "SELECT * FROM data";
await click("run");
assert(
  !wideGrid.classList.contains("wide-result") &&
    !wideGrid.querySelector("colgroup") &&
    wideGrid.tBodies[0].rows.length === 100,
  "native narrow table recovers auto layout after a wide result",
);
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
      fullyVisibleRows: rows.filter((row) => {
        const rect = row.getBoundingClientRect();
        return (
          rect.top >=
            document.querySelector("#grid thead").getBoundingClientRect()
              .bottom && rect.bottom <= grid.bottom
        );
      }).length,
      numericAlignment: getComputedStyle(
        document.querySelector("#grid td.numeric"),
      ).textAlign,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  })(),
};
