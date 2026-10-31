const checks = [];
const assert = (ok, text) => {
  if (!ok) throw new Error(text);
  checks.push(text);
};
const $ = (id) => document.getElementById(id);
const wait = async () => {
  for (let i = 0; i < 300; i++) {
    if ($("busy").hidden) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("workspace query stayed busy");
};
const click = async (element) => {
  element.click();
  await wait();
};
const query = async (sql) => {
  $("sql").value = sql;
  $("sql").dispatchEvent(new Event("input"));
  await click($("run"));
};
const count =
  'SELECT count(*) AS matched FROM workspace."orders.parquet" a JOIN workspace."nested/orders-copy.parquet" b USING(order_id)';
const draft = count + " -- saved workspace draft";
if (workspacePhase === "root-query-restore") {
  assert(
    $("welcome").hidden && !$("workspace").hidden,
    "workspace editor restores without a file",
  );
  assert(
    !document.querySelector(".tree-file.selected") &&
      !document.querySelector(".opened-file"),
    "no document reopened for workspace query",
  );
  assert(
    $("sql").value === draft,
    "workspace draft restored independently of last successful SQL",
  );
  assert(
    !document.querySelector("#grid tbody tr") && $("export").disabled,
    "restart does not run historical workspace SQL",
  );
  await click($("run"));
  assert(
    document.querySelector("#grid tbody tr").textContent.includes("240") &&
      !$("export").disabled,
    "workspace JOIN result restored and export available",
  );
} else {
  // The prior phase restored a file: explicitly enter its workspace editor.
  await click(document.querySelector('[data-control="folder-name"]'));
  assert(
    $("welcome").hidden && !$("sql-panel").hidden && $("run").disabled,
    "workspace editor available with a blank draft",
  );
  assert(
    !$("workspace-tables").hidden &&
      !document
        .querySelector(".table-reference")
        .textContent.includes('workspace."."'),
    "table helper lists only real files",
  );
  await query(count);
  assert(
    document.querySelector("#grid tbody tr").textContent.includes("240"),
    "JOIN runs with no active file",
  );
  assert(!$("export").disabled, "workspace results can be exported");
  await query(
    'SELECT order_id FROM workspace."orders.parquet" ORDER BY order_id',
  );
  await click($("next"));
  assert(
    $("page-label").textContent === "Page 2",
    "workspace query supports paging",
  );
  const file = [...document.querySelectorAll(".tree-file")].find(
    (b) => b.dataset.path === "orders.parquet",
  );
  await click(file);
  await click(document.querySelector('[data-control="folder-name"]'));
  assert(
    $("page-label").textContent === "Page 2" &&
      $("sql").value.includes("ORDER BY"),
    "return from file preserves workspace query and page",
  );
  await click(file);
  await click(document.querySelector(".close-file"));
  assert(
    $("welcome").hidden &&
      !$("sql-panel").hidden &&
      !document.querySelector(".opened-file"),
    "closing last document keeps workspace query editor",
  );
  await query(count);
  $("sql").value = draft;
  $("sql").dispatchEvent(new Event("input"));
  $("sql").dispatchEvent(new Event("blur"));
  await new Promise((r) => setTimeout(r, 450));
  assert(
    $("query-save").textContent === "Saved locally" &&
      !$("notification").classList.contains("error"),
    "workspace draft persisted without executing it",
  );
}
return { checks };
