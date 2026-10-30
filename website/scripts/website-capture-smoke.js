// Run in the real WKWebView through the native desktop smoke harness.
// All controls and query results below belong to the actual App and IPC.
const $ = (id) => document.getElementById(id);
for (let i = 0; i < 200 && !$("busy").hidden; i++) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
if (!$("busy").hidden)
  throw new Error("App did not finish opening the sample file");
$("tab-explore").click();
$("sql").value =
  "SELECT order_id, city, customer, amount, ordered_on\nFROM data WHERE fulfilled = true\nORDER BY amount DESC LIMIT 12;";
$("run").click();
for (let i = 0; i < 200 && !$("busy").hidden; i++) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
if (!$("busy").hidden) throw new Error("Sample query did not finish");
const rows = [...document.querySelectorAll("#grid tbody tr")];
if (rows.length !== 12) throw new Error("Expected 12 real query-result rows");
const amounts = rows.map((row) => Number(row.cells[4].textContent));
if (
  amounts.some(
    (value, index) =>
      !Number.isFinite(value) || (index > 0 && value > amounts[index - 1]),
  )
) {
  throw new Error("Result amounts are not sorted descending");
}
const visible = document.body.innerText;
if (/\/Users\/|\/home\/|oldpanda|@/.test(visible)) {
  throw new Error("Capture contains a personal path or identifier");
}
return {
  nativeIPC: true,
  mockedIPC: false,
  sampleRows: $("row-count").textContent,
  resultRows: rows.length,
  sql: $("sql").value,
  firstRow: [...rows[0].cells].map((cell) => cell.textContent),
  personalPaths: false,
};
