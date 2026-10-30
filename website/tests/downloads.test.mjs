/** Published assets, not anticipated filenames, determine download availability. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogFromRelease,
  validateCatalog,
  packageSuffixes,
} from "../scripts/download-catalog.mjs";
const release = (suffixes = Object.values(packageSuffixes)) => ({
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
    Object.values(catalog.packages).map((a) => a.name),
    release().assets.map((a) => a.name),
  );
  assert.deepEqual(validateCatalog(catalog), catalog);
});
test("installers and portable archives have independent availability; checksums are excluded", () => {
  const catalog = catalogFromRelease(
    release([
      "macOS-arm64.dmg",
      "windows-x64.zip",
      "linux-x64.tar.gz",
      "linux-x64.deb.sha256",
    ]),
  );
  assert(catalog.packages.macosDmg);
  assert.equal(catalog.packages.windowsSetup, null);
  assert.equal(catalog.packages.linuxDeb, null);
  assert(catalog.packages.windowsZip);
  assert(catalog.packages.linuxTar);
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
      packages: Object.fromEntries(
        Object.keys(packageSuffixes).map((key) => [key, null]),
      ),
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
    assert.equal(catalogFromRelease(input).packages.macosDmg, null);
  }
});
test("build rejects edited catalog URLs, unexpected fields and wrong platform assignments", () => {
  for (const mutate of [
    (c) => {
      c.packages.macosDmg.url = "javascript:alert(1)";
    },
    (c) => {
      c.packages.linuxDeb = c.packages.macosDmg;
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
