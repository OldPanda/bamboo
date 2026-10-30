/** Published assets, not anticipated filenames, determine download availability. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogFromRelease,
  validateCatalog,
} from "../scripts/download-catalog.mjs";
const release = (
  suffixes = ["macOS-arm64.dmg", "windows-x64-setup.exe", "linux-x64.deb"],
) => ({
  tag_name: "v1.2.3",
  draft: false,
  prerelease: false,
  assets: suffixes.map((suffix) => ({
    name: `Bamboo-1.2.3-${suffix}`,
    state: "uploaded",
    size: 123,
    browser_download_url: `https://github.com/OldPanda/bamboo/releases/download/v1.2.3/Bamboo-1.2.3-${suffix}`,
  })),
});
test("stable release selects only uploaded supported installers and preserves actual URLs", () => {
  const catalog = catalogFromRelease(release());
  assert.deepEqual(
    Object.values(catalog.platforms).map((a) => a.name),
    release().assets.map((a) => a.name),
  );
  assert.deepEqual(validateCatalog(catalog), catalog);
});
test("missing desktop assets remain unavailable; archives and checksums are not installers", () => {
  const catalog = catalogFromRelease(
    release([
      "macOS-arm64.dmg",
      "windows-x64.zip",
      "linux-x64.tar.gz",
      "linux-x64.deb.sha256",
    ]),
  );
  assert(catalog.platforms.macos);
  assert.equal(catalog.platforms.windows, null);
  assert.equal(catalog.platforms.linux, null);
});
test("preview, draft, absent or malformed releases never become stable downloads", () => {
  for (const input of [
    null,
    { ...release(), draft: true },
    { ...release(), prerelease: true },
    { ...release(), tag_name: "v1.2.3-preview" },
    { ...release(), tag_name: "../bad" },
  ]) {
    assert.deepEqual(catalogFromRelease(input), {
      tag: null,
      platforms: { macos: null, windows: null, linux: null },
    });
  }
});
test("wrong host, wrong release, zero-length and incomplete uploads fail closed", () => {
  for (const change of [
    { browser_download_url: "https://example.com/installer" },
    {
      browser_download_url:
        "https://github.com/OldPanda/bamboo/releases/download/v1.2.2/Bamboo-1.2.3-macOS-arm64.dmg",
    },
    { size: 0 },
    { state: "new" },
  ]) {
    const input = release(["macOS-arm64.dmg"]);
    Object.assign(input.assets[0], change);
    assert.equal(catalogFromRelease(input).platforms.macos, null);
  }
});
test("build rejects edited catalog URLs, unexpected fields and wrong platform assignments", () => {
  for (const mutate of [
    (c) => {
      c.platforms.macos.url = "javascript:alert(1)";
    },
    (c) => {
      c.platforms.linux = c.platforms.macos;
    },
    (c) => {
      c.extra = "</script>";
    },
  ]) {
    const catalog = catalogFromRelease(release());
    mutate(catalog);
    assert.throws(() => validateCatalog(catalog), /Invalid download catalog/);
  }
});
