/** Select supported installers from one published stable GitHub release. */
export function catalogFromRelease(release) {
  const empty = {
    tag: null,
    platforms: { macos: null, windows: null, linux: null },
  };
  if (
    !release ||
    release.draft ||
    release.prerelease ||
    !/^v\d+\.\d+\.\d+$/.test(release.tag_name)
  )
    return empty;
  const tag = release.tag_name;
  const suffixes = {
    macos: "macOS-arm64.dmg",
    windows: "windows-x64-setup.exe",
    linux: "linux-x64.deb",
  };
  const platforms = Object.fromEntries(
    Object.entries(suffixes).map(([platform, suffix]) => {
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
  return { tag, platforms };
}

/** Reject edited catalog URLs or unsupported installers before embedding in a page. */
export function validateCatalog(catalog) {
  const reconstructed = catalogFromRelease({
    tag_name: catalog.tag,
    assets: Object.values(catalog.platforms ?? {})
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
