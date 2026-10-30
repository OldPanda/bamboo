/** Build only public website files; optionally emit a standalone review copy. */
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
const template = await readFile(join(source, "index.html"), "utf8");
const css = await readFile(join(source, "styles.css"), "utf8");
// Bundle the single shared copy module into the browser entry without dependencies.
const content = (await readFile(join(source, "content.js"), "utf8")).replaceAll(
  "export const ",
  "const ",
);
const entry = await readFile(join(source, "site.js"), "utf8");
const importLine =
  'import { translations, pageMetadata, siteOrigin } from "./content.js";';
if (!entry.startsWith(importLine))
  throw Error("Unexpected website content import");
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
for (const [language, path, file] of [
  ["zh", "/", "index.html"],
  ["en", "/en/", "en/index.html"],
  ["zh", "/zh/", "zh/index.html"],
]) {
  const html = renderPage(template, language, path)
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
  let standalone = renderPage(template, "zh", "/")
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
    .replace('href="/en/"', 'href="?lang=en"')
    .replace('href="/zh/"', 'href="?lang=zh"');
  await writeFile(join(root, "build/bamboo-website-preview.html"), standalone);
}
console.log(`Built ${images.size} images, CSS, JS and HTML into build/website`);
