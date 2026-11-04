const checks = [];
const assert = (ok, message) => {
  if (!ok) throw Error(message);
  checks.push(message);
};
const call = (name, ...args) => mygo.call("Workbench." + name, ...args);
if (workspacePhase === "restart") {
  const entries = await call("QueryLibrary");
  assert(entries.length === 1, "favorite survives process restart");
  assert(
    entries[0].favorite === true && entries[0].history === false,
    "native boolean membership survives restart and clear",
  );
  assert(
    entries[0].sql.includes("9223372036854775807"),
    "exact SQL survives native IPC and disk",
  );
  assert(
    entries[0].name === "Daily <img> total",
    "named query survives process restart",
  );
  await call("ChangeSavedQuery", entries[0].id, "delete");
  assert(
    (await call("QueryLibrary")).length === 0,
    "deletion persists through native IPC",
  );
} else {
  assert((await call("QueryLibrary")).length === 0, "new library is empty");
  const file = await call(
    "OpenPath",
    smokeDirectory + "/data/orders.parquet",
  );
  const scope = { kind: "file", path: file.path };
  const sql =
    "SELECT 9223372036854775807::BIGINT AS exact, '<img onerror=x>' AS text, NULL AS missing, '' AS empty FROM data";
  const page = await call("Query", {
    sql,
    offset: 0,
    limit: 100,
    sort: "",
    desc: false,
    filterColumn: "",
    filterValue: "",
  });
  assert(
    page.rows[0][0] === "9223372036854775807" &&
      page.rows[0][2] === null &&
      page.rows[0][3] === "",
    "real DuckDB query preserves exact values through IPC",
  );
  assert(
    (await call("QueryLibrary")).length === 0,
    "automatic query does not record history",
  );
  await call("RememberQuery", scope, sql);
  await call("SaveFavorite", scope, sql);
  const entries = await call("QueryLibrary");
  assert(
    entries.length === 1 && entries[0].sql === sql,
    "successful SQL deduplicates history and favorites",
  );
  assert(
    entries[0].history === true && entries[0].favorite === true,
    "native IPC returns booleans",
  );
  assert(
    !entries[0].name,
    "legacy saved query remains compatible without a name",
  );
  await call("SaveNamedQuery", scope, sql, "Daily count");
  assert(
    (await call("QueryLibrary"))[0].name === "Daily count",
    "named save crosses real native IPC",
  );
  await call("RenameSavedQuery", entries[0].id, "Daily <img> total");
  const renamed = (await call("QueryLibrary"))[0];
  assert(
    renamed.name === "Daily <img> total" &&
      renamed.sql === sql &&
      renamed.scope.path === scope.path,
    "rename preserves exact SQL and source",
  );
  let rejected = false;
  try {
    await call("RememberQuery", { kind: "workspace", path: file.path }, sql);
  } catch {
    rejected = true;
  }
  assert(rejected, "different scope cannot record another result");
  await call("ChangeSavedQuery", "", "clear");
  const kept = await call("QueryLibrary");
  assert(
    kept.length === 1 && kept[0].favorite && !kept[0].history,
    "clear history retains favorites",
  );
}
return { checks, phase: workspacePhase };
