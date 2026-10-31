/** Strict release verification for unattended updates; no writes on failure. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { catalogFromRelease, validateCatalog } from "./download-catalog.mjs";

/** Compare stable numeric versions without rounding large version components. */
export function compareTags(left, right) {
  const parse = (tag) => {
    assert(
      /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag),
      "Expected a stable version tag",
    );
    return tag.slice(1).split(".").map(BigInt);
  };
  const a = parse(left),
    b = parse(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

/** Never downgrade or rewrite the metadata of an already advertised version. */
export function catalogDecision(current, candidate) {
  validateCatalog(current);
  validateCatalog(candidate);
  assert(
    candidate.tag && Object.values(candidate.packages).every(Boolean),
    "Release must contain all five packages",
  );
  const order = current.tag ? compareTags(candidate.tag, current.tag) : 1;
  if (order < 0) return "older";
  if (order === 0) {
    assert.deepEqual(
      current,
      candidate,
      "An advertised release changed; investigate instead of silently replacing it",
    );
    return "unchanged";
  }
  return "update";
}

/** Fetch public bytes with bounded memory, length and deadline; never send API credentials. */
async function readAsset(url, limit, fetcher, onChunk) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(600000) });
  assert(response.ok, `Asset download failed: HTTP ${response.status}`);
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert(size <= limit, "Asset exceeds expected size");
    onChunk(chunk);
  }
  return size;
}

/** Check all five hosted packages against their published SHA-256 sidecars. */
export async function verifyReleaseDownloads(release, fetcher = fetch) {
  const catalog = catalogFromRelease(release);
  assert(
    catalog.tag && !release.draft && !release.prerelease,
    "Expected a published stable release",
  );
  compareTags(catalog.tag, catalog.tag);
  assert(
    Object.values(catalog.packages).every(Boolean),
    "Release must contain all five packages",
  );
  for (const asset of Object.values(catalog.packages)) {
    assert(
      asset.size <= 1024 ** 3,
      "Package exceeds the 1 GiB verification budget",
    );
    assert.equal(
      release.assets.filter((a) => a.name === asset.name).length,
      1,
      "Duplicate package",
    );
    const checksums = release.assets.filter(
      (a) => a.name === `${asset.name}.sha256`,
    );
    assert.equal(checksums.length, 1, "Missing or duplicate checksum");
    const checksum = checksums[0];
    assert(
      checksum.state === "uploaded" &&
        checksum.size > 0 &&
        checksum.size <= 1024,
      "Invalid checksum asset",
    );
    assert.equal(
      checksum.browser_download_url,
      `${asset.url}.sha256`,
      "Unexpected checksum URL",
    );
    const chunks = [];
    const checksumSize = await readAsset(
      checksum.browser_download_url,
      1024,
      fetcher,
      (chunk) => chunks.push(chunk),
    );
    assert.equal(checksumSize, checksum.size, "Checksum size changed");
    const match = Buffer.concat(chunks)
      .toString("utf8")
      .trim()
      .match(/^([a-fA-F0-9]{64}) [ *](\S+)$/);
    assert(match && match[2] === asset.name, "Invalid checksum contents");
    const hash = createHash("sha256");
    const size = await readAsset(asset.url, asset.size, fetcher, (chunk) =>
      hash.update(chunk),
    );
    assert.equal(size, asset.size, "Package size changed");
    assert.equal(
      hash.digest("hex"),
      match[1].toLowerCase(),
      "Package checksum mismatch",
    );
    console.log(`Verified ${asset.name}: ${size} bytes, SHA-256 matched`);
  }
  return catalog;
}
