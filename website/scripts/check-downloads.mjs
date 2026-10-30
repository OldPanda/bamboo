/** Opt-in network check; never publishes releases or changes hosting configuration. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { catalogFromRelease, validateCatalog } from "./download-catalog.mjs";

const path = new URL("../downloads.json", import.meta.url);
const response = await fetch(
  "https://api.github.com/repos/OldPanda/bamboo/releases/latest",
  {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30000),
  },
);
if (!response.ok && response.status !== 404)
  throw Error(`GitHub release check failed: HTTP ${response.status}`);
const catalog = catalogFromRelease(
  response.status === 404 ? null : await response.json(),
);
for (const [platform, asset] of Object.entries(catalog.packages)) {
  if (!asset) {
    console.log(
      `${platform}: no published installer in the latest stable release`,
    );
    continue;
  }
  const download = await fetch(asset.url, {
    method: "HEAD",
    signal: AbortSignal.timeout(30000),
  });
  assert(download.ok, `${platform}: download returned HTTP ${download.status}`);
  assert.equal(
    Number(download.headers.get("content-length")),
    asset.size,
    `${platform}: download size differs from release metadata`,
  );
  console.log(
    `${platform}: HTTP ${download.status}, ${asset.size} bytes, ${asset.name}`,
  );
}
if (process.argv.includes("--update")) {
  await writeFile(path, JSON.stringify(catalog, null, 2) + "\n");
  console.log(
    "Updated website/downloads.json; review the diff and installation guidance before shipping.",
  );
} else {
  assert.deepEqual(
    validateCatalog(JSON.parse(await readFile(path, "utf8"))),
    catalog,
    "Published downloads changed; run check:downloads -- --update, review, and rebuild.",
  );
  console.log(
    "Website download catalog matches the latest stable GitHub Release.",
  );
}
