// Sample real layout during IPC and at DOM commits; no mocked data or transport.
// Timers are used because WKWebView may suspend requestAnimationFrame in automation.
const checks = [];
const assert = (ok, text) => {
  if (!ok) throw Error(text);
  checks.push(text);
};
const $ = (id) => document.getElementById(id);
const pause = () => new Promise((r) => setTimeout(r, 20));
const wait = async () => {
  for (let i = 0; i < 400; i++) {
    if ($("busy").hidden) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("switch stayed busy");
};
const select = (name) =>
  [...document.querySelectorAll(".tree-file")].find(
    (b) => b.dataset.path === name,
  );
const load = async (name) => {
  select(name).click();
  await wait();
  await pause();
};
const anchors = [
  ".sidebar",
  "header",
  ".file-heading",
  ".tabs",
  "#sql-panel",
  ".toolbar",
  "#grid-scroll",
  ".table-footer",
];
const snapshot = () => ({
  title: $("file-name").textContent,
  rows: document.querySelectorAll("#grid tbody tr").length,
  head: document.querySelector("#grid thead").textContent,
  opacity: getComputedStyle($("open-folder")).opacity,
  anchors: anchors.map((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  }),
});
const expected = {};
for (const name of [
  "orders.parquet",
  "million.parquet",
  "special.parquet",
  "empty.parquet",
]) {
  await load(name);
  expected[name] = snapshot();
}
await load("orders.parquet");
const traces = [];
for (const name of [
  "million.parquet",
  "special.parquet",
  "empty.parquet",
  "orders.parquet",
]) {
  const frames = [snapshot()];
  const timer = setInterval(() => frames.push(snapshot()), 16);
  const observer = new MutationObserver(() => frames.push(snapshot()));
  observer.observe(document.getElementById("app"), {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  await load(name);
  await pause();
  clearInterval(timer);
  observer.disconnect();
  frames.push(snapshot());
  const base = frames[0].anchors;
  const maxGeometryDelta = Math.max(
    ...frames.flatMap((f) =>
      f.anchors.flatMap((a, i) => a.map((v, j) => Math.abs(v - base[i][j]))),
    ),
  );
  assert(
    frames.every((f) => f.opacity === "1"),
    name + ": navigation never dims during loading",
  );
  assert(
    maxGeometryDelta <= 0.5,
    name + ": workbench geometry stays within 0.5 CSS px",
  );
  assert(
    frames.every(
      (f) =>
        expected[f.title] &&
        f.rows === expected[f.title].rows &&
        f.head === expected[f.title].head,
    ),
    name +
      ": metadata and data commit together without empty intermediate table",
  );
  traces.push({ file: name, maxGeometryDelta, frames });
}
return {
  checks,
  traces,
  viewport: { width: innerWidth, height: innerHeight },
};
