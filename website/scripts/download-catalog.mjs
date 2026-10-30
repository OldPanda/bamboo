/** Exact package names emitted by the native packaging scripts. */
export const packageSuffixes = {
  macosDmg: "macOS-arm64.dmg",
  windowsSetup: "windows-x64-setup.exe",
  windowsZip: "windows-x64.zip",
  linuxDeb: "linux-x64.deb",
  linuxTar: "linux-x64.tar.gz",
};

/** Select supported installers from one published stable GitHub release. */
export function catalogFromRelease(release) {
  const empty = {
    tag: null,
    packages: Object.fromEntries(
      Object.keys(packageSuffixes).map((key) => [key, null]),
    ),
  };
  if (
    !release ||
    release.draft ||
    release.prerelease ||
    !/^v\d+\.\d+\.\d+$/.test(release.tag_name)
  )
    return empty;
  const tag = release.tag_name;
  const packages = Object.fromEntries(
    Object.entries(packageSuffixes).map(([platform, suffix]) => {
      const name = `Bamboo-${tag.slice(1)}-${suffix}`;
      const url = `https://github.com/OldPanda/bamboo/releases/download/${tag}/${name}`;
      const asset = release.assets?.find(
        (asset) =>
          asset.name === name &&
          asset.state === "uploaded" &&
          Number.isSafeInteger(asset.size) &&
          asset.size > 0 &&
          asset.browser_download_url === url,
      );
      return [platform, asset ? { name, url, size: asset.size } : null];
    }),
  );
  return { tag, packages };
}

/** Reject edited catalog URLs or unsupported installers before embedding in a page. */
export function validateCatalog(catalog) {
  const reconstructed = catalogFromRelease({
    tag_name: catalog.tag,
    assets: Object.values(catalog.packages ?? {})
      .filter(Boolean)
      .map((asset) => ({
        ...asset,
        state: "uploaded",
        browser_download_url: asset.url,
      })),
  });
  if (JSON.stringify(catalog) !== JSON.stringify(reconstructed))
    throw Error("Invalid download catalog; run check:downloads -- --update");
  return catalog;
}

/** Render truthful package controls before locale translation, including without JavaScript. */
export function renderPackages(template, catalog) {
  validateCatalog(catalog);
  return template.replace(/<!-- PACKAGE:(\w+) -->/g, (_, key) => {
    if (!Object.hasOwn(packageSuffixes, key))
      throw Error(`Unknown package: ${key}`);
    const asset = catalog.packages[key];
    const label = `<span data-i18n="package${key}">Package</span>`;
    return asset
      ? `<a class="package-link" data-package="${key}" href="${asset.url}">${label}<svg aria-hidden="true"><use href="#i-down" /></svg></a><small class="package-meta">${catalog.tag} · ${(asset.size / 1000000).toFixed(1)} MB</small>`
      : `<span class="package-unavailable" data-package="${key}">${label}<small data-i18n="packageUnavailable">Not published</small></span>`;
  });
}
