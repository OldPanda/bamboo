/** Build only public website files; optionally emit a standalone review copy. */
import { validateCatalog, renderPackages } from "./download-catalog.mjs";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPage, sitemap } from "./website-render.mjs";
import { siteOrigin } from "../content.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(root, "website");
const output = join(root, "build/website");
const hash = (bytes) =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 16);
await rm(output, { recursive: true, force: true });
await mkdir(join(output, "assets"), { recursive: true });
const sourceTemplate = await readFile(join(source, "index.html"), "utf8");
const css =
  (await readFile(join(source, "styles.css"), "utf8")) +
  "\n" +
  (await readFile(join(source, "docs.css"), "utf8"));
const catalog = validateCatalog(
  JSON.parse(await readFile(join(source, "downloads.json"), "utf8")),
);
const template = renderPackages(sourceTemplate, catalog);
// Share the actual header, footer and preference controls with the homepage.
const docsMain = await readFile(join(source, "docs.html"), "utf8");
const docsTemplate = renderPackages(
  sourceTemplate
    .replace("<body>", '<body data-page="docs">')
    .replace(/<main id="main">[\s\S]*?<\/main>/, () => docsMain)
    .replaceAll('href="#"', 'data-route="home" href="/zh/"')
    .replace(
      /href="#(features|install|faq|download)"/g,
      'data-route="home" href="/zh/#$1"',
    )
    .replaceAll('data-route="docs"', 'aria-current="page" data-route="docs"')
    .replace('href="/en/" hreflang', 'href="/en/docs/" hreflang')
    .replace('href="/zh/" hreflang', 'href="/zh/docs/" hreflang'),
  catalog,
).replace(
  "<!-- LINUX_DEB_NAME -->",
  catalog.packages.linuxDeb?.name || "Bamboo-&lt;version&gt;-linux-x64.deb",
);
// Bundle shared copy and the verified catalog without runtime network requests.
const content = (await readFile(join(source, "content.js"), "utf8")).replaceAll(
  "export const ",
  "const ",
);
const entry = (await readFile(join(source, "site.js"), "utf8")).replace(
  "/* DOWNLOAD_CATALOG */ null",
  JSON.stringify(catalog),
);
const importLine =
  /^import\s*\{\s*translations,\s*pageMetadata,\s*docsMetadata,\s*siteOrigin\s*,?\s*\}\s*from "\.\/content\.js";\s*/;
if (!importLine.test(entry)) throw Error("Unexpected website content import");
const js = content + "\n" + entry.replace(importLine, "");
const images = new Map();
for (const file of await readdir(join(source, "assets"))) {
  if (!/^[a-z0-9-]+-[a-f0-9]{16}\.(png|svg)$/.test(file))
    throw Error(`Unexpected public asset: ${file}`);
  const bytes = await readFile(join(source, "assets", file));
  if (!file.includes(`-${hash(bytes)}.`))
    throw Error(`Asset hash mismatch: ${file}`);
  images.set(`assets/${file}`, bytes);
  await writeFile(join(output, "assets", file), bytes);
}
const builtCSS = css.replaceAll("assets/", "./");
const cssName = `assets/styles-${hash(builtCSS)}.css`;
const builtJS =
  content +
  "\n" +
  entry.replace(importLine, "").replaceAll('"assets/', '"/assets/');
const jsName = `assets/site-${hash(builtJS)}.js`;
await writeFile(join(output, cssName), builtCSS);
await writeFile(join(output, jsName), builtJS);
for (const [language, path, file, page] of [
  ["zh", "/", "index.html", template],
  ["en", "/en/", "en/index.html", template],
  ["zh", "/zh/", "zh/index.html", template],
  ["zh", "/docs/", "docs/index.html", docsTemplate],
  ["en", "/en/docs/", "en/docs/index.html", docsTemplate],
  ["zh", "/zh/docs/", "zh/docs/index.html", docsTemplate],
]) {
  const html = renderPage(page, language, path)
    .replace('href="styles.css"', `href="${cssName}"`)
    .replace('src="site.js"', `src="${jsName}"`)
    .replaceAll('="assets/', '="/assets/');
  await mkdir(dirname(join(output, file)), { recursive: true });
  await writeFile(join(output, file), html);
}
await writeFile(join(output, "sitemap.xml"), sitemap());
await writeFile(
  join(output, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin}/sitemap.xml\n`,
);
await writeFile(
  join(output, "_headers"),
  await readFile(join(source, "_headers")),
);
if (process.argv.includes("--standalone")) {
  for (const [page, path, filename] of [
    [template, "/", "bamboo-website-preview.html"],
    [docsTemplate, "/docs/", "bamboo-docs-preview.html"],
  ]) {
    let standalone = renderPage(page, "zh", path)
      .replace(
        '<link rel="stylesheet" href="styles.css" />',
        () => `<style>\n${css}</style>`,
      )
      .replace(
        '<script type="module" src="site.js"></script>',
        () => `<script type="module">\n${js}</script>`,
      );
    for (const [name, bytes] of images) {
      const mime = name.endsWith(".svg") ? "image/svg+xml" : "image/png";
      standalone = standalone.replaceAll(
        new RegExp(`(?<!/)${name.replaceAll(".", "\\.")}`, "g"),
        `data:${mime};base64,${bytes.toString("base64")}`,
      );
    }
    // Language links in the portable file stay in the file; production has real routes.
    standalone = standalone
      .replace(
        `href="/en/${path === "/docs/" ? "docs/" : ""}" hreflang`,
        'href="?lang=en" hreflang',
      )
      .replace(
        `href="/zh/${path === "/docs/" ? "docs/" : ""}" hreflang`,
        'href="?lang=zh" hreflang',
      );
    await writeFile(join(root, "build", filename), standalone);
  }
}
console.log(`Built ${images.size} images, CSS, JS and HTML into build/website`);
