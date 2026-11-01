const checks = [];
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
  checks.push(message);
};
const $ = (id) => document.getElementById(id);
const waitFor = async (predicate) => {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("display operation did not settle");
};
const saved = await mygo.call("Workbench.Display");
if (workspacePhase === "display-restore") {
  assert(
    saved.zoomPercent === 125 && saved.dataFontSize === 16,
    "display settings restored in a second native process",
  );
  assert(
    Math.abs(innerWidth * 1.25 - 700) <= 40,
    "native startup restored 125% page zoom",
  );
  assert(
    getComputedStyle($("sql")).fontSize === "17px" &&
      getComputedStyle($("grid")).fontSize === "16px",
    "table and SQL fonts restored",
  );
} else {
  assert(
    saved.zoomPercent === 100 && saved.dataFontSize === 13,
    "fresh display defaults",
  );
  const before = innerWidth;
  $("settings").click();
  $("display-zoom").value = "200";
  $("display-font").value = "20";
  $("display-save").focus();
  $("display-form").requestSubmit();
  await waitFor(
    () =>
      $("display-form").getAttribute("aria-busy") === "false" &&
      innerWidth < before * 0.6,
  );
  assert(
    Math.abs(innerWidth * 2 - before) <= 2,
    "native WebView zoom changes the layout viewport",
  );
  const dialog = $("settings-dialog").getBoundingClientRect();
  $("display-reset").scrollIntoView({ block: "nearest" });
  const reset = $("display-reset").getBoundingClientRect();
  assert(
    dialog.bottom <= innerHeight + 1 &&
      reset.top >= 0 &&
      reset.bottom <= innerHeight,
    "display reset reachable at 200% in a narrow native window",
  );
  $("display-reset").click();
  await waitFor(
    () =>
      $("display-form").getAttribute("aria-busy") === "false" &&
      Math.abs(innerWidth - before) <= 2,
  );
  assert(
    $("display-font").value === "13",
    "display reset restores default zoom and text",
  );
  $("display-zoom").value = "125";
  $("display-font").value = "16";
  $("display-form").requestSubmit();
  await waitFor(
    () =>
      $("display-form").getAttribute("aria-busy") === "false" &&
      innerWidth < before * 0.9,
  );
  $("settings-dismiss").click();
}
assert(
  document.querySelectorAll("#grid tbody tr").length === 100,
  "display changes retain the bounded query result",
);
$("sql").value =
  "SELECT NULL::VARCHAR AS missing, '' AS empty_text FROM data LIMIT 1";
$("run").click();
await waitFor(() => $("busy").hidden);
assert(
  getComputedStyle(document.querySelector("#grid .null")).fontSize ===
    "16px" &&
    getComputedStyle(document.querySelector("#grid .empty-string"))
      .fontSize === "16px",
  "NULL and empty-string data cells use the saved data text size",
);
$("sql").value = "SELECT count(*) AS n FROM data";
$("run").click();
await waitFor(() => $("busy").hidden);
assert(
  document.querySelectorAll("#grid tbody td")[1].textContent === "240",
  "query remains usable after native display changes",
);
$("sql").value = "SELECT * FROM data";
$("run").click();
await waitFor(() => $("busy").hidden);
return { checks, viewport: { width: innerWidth, height: innerHeight } };
