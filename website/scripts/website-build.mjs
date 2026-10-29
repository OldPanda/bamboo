/** Build only public website files; optionally emit a standalone review copy. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(root, "website");
const output = join(root, "build/website");
const hash = (bytes) =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 16);
await rm(output, { recursive: true, force: true });
await mkdir(join(output, "assets"), { recursive: true });
let html = await readFile(join(source, "index.html"), "utf8");
const css = await readFile(join(source, "styles.css"), "utf8");
const js = await readFile(join(source, "site.js"), "utf8");
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
const jsName = `assets/site-${hash(js)}.js`;
await writeFile(join(output, cssName), builtCSS);
await writeFile(join(output, jsName), js);
html = html
  .replace('href="styles.css"', `href="${cssName}"`)
  .replace('src="site.js"', `src="${jsName}"`);
await writeFile(join(output, "index.html"), html);
await writeFile(
  join(output, "_headers"),
  await readFile(join(source, "_headers")),
);
if (process.argv.includes("--standalone")) {
  let standalone = (await readFile(join(source, "index.html"), "utf8"))
    .replace(
      '<link rel="stylesheet" href="styles.css" />',
      () => `<style>\n${css}</style>`,
    )
    .replace(
      '<script src="site.js" defer></script>',
      () => `<script>\n${js}</script>`,
    );
  for (const [name, bytes] of images) {
    const mime = name.endsWith(".svg") ? "image/svg+xml" : "image/png";
    standalone = standalone.replaceAll(
      name,
      `data:${mime};base64,${bytes.toString("base64")}`,
    );
  }
  await writeFile(join(root, "build/bamboo-website-preview.html"), standalone);
}
console.log(`Built ${images.size} images, CSS, JS and HTML into build/website`);
