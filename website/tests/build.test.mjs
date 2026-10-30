/** Exercise the real builder in disposable repositories, without deployment credentials. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { translations } from "../content.js";
import { renderPage } from "../scripts/website-render.mjs";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "bamboo-website-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "website/scripts"), { recursive: true });
  for (const file of [
    "index.html",
    "styles.css",
    "site.js",
    "content.js",
    "downloads.json",
    "scripts/download-catalog.mjs",
    "_headers",
    "assets",
    "scripts/website-build.mjs",
    "scripts/website-render.mjs",
  ])
    await cp(join(source, file), join(root, "website", file), {
      recursive: true,
    });
  return {
    root,
    site: join(root, "build/website"),
    build(...args) {
      return spawnSync(
        process.execPath,
        [join(root, "website/scripts/website-build.mjs"), ...args],
        {
          cwd: tmpdir(),
          encoding: "utf8",
          timeout: 15000,
        },
      );
    },
  };
}
function success(result) {
  assert.equal(result.status, 0, result.stderr || String(result.error));
}
async function files(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...(await files(root, path)));
    else result.push(path);
  }
  return result.sort();
}
async function snapshot(root) {
  return Promise.all(
    (await files(root)).map(async (path) => [
      path,
      digest(await readFile(join(root, path))),
    ]),
  );
}

test("deployment includes only public files and removes stale build contents", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "website/.env",
    "website/README.md",
    "website/performance-provenance.json",
    "website/node_modules/private.txt",
    "build/website/stale/private.txt",
  ]) {
    await mkdir(dirname(join(f.root, path)), { recursive: true });
    await writeFile(join(f.root, path), "DO_NOT_DEPLOY_TEST_SENTINEL");
  }
  success(f.build());
  const output = await files(f.site);
  assert.deepEqual(
    output.filter((path) => !path.startsWith("assets/")),
    [
      "_headers",
      "en/index.html",
      "index.html",
      "robots.txt",
      "sitemap.xml",
      "zh/index.html",
    ],
  );
  assert.equal(output.filter((path) => /\.(css|js)$/.test(path)).length, 2);
  assert.equal(
    output.length,
    (await readdir(join(source, "assets"))).length + 8,
  );
  for (const path of output) {
    assert(!path.includes("private"));
    assert(
      !(await readFile(join(f.site, path))).includes(
        Buffer.from("DO_NOT_DEPLOY_TEST_SENTINEL"),
      ),
    );
  }
  assert.deepEqual(
    await readFile(join(f.site, "_headers")),
    await readFile(join(source, "_headers")),
  );
});

test("all deployed asset names match their bytes and HTML references resolve", async (t) => {
  const f = await fixture(t);
  success(f.build());
  for (const name of await readdir(join(f.site, "assets"))) {
    const hash = name.match(/-([a-f0-9]{16})\.(png|svg|css|js)$/)?.[1];
    assert.equal(
      hash,
      digest(await readFile(join(f.site, "assets", name))).slice(0, 16),
      name,
    );
  }
  const html = await readFile(join(f.site, "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"\s]+)"/g)].map(
    (match) => match[1],
  );
  assert(
    refs.some((ref) => ref.endsWith(".css")) &&
      refs.some((ref) => ref.endsWith(".js")),
  );
  for (const ref of refs)
    assert((await readFile(join(f.site, ref))).length > 0, ref);
});

test("identical sources produce identical deployment bytes", async (t) => {
  const f = await fixture(t);
  success(f.build());
  const first = await snapshot(f.site);
  success(f.build());
  assert.deepEqual(await snapshot(f.site), first);
});

test("standalone preview embeds unchanged assets and has no local runtime dependencies", async (t) => {
  const f = await fixture(t);
  success(f.build("--standalone"));
  const preview = await readFile(
    join(f.root, "build/bamboo-website-preview.html"),
    "utf8",
  );
  assert(
    preview.includes("<style>") && preview.includes('<script type="module">'),
  );
  assert(
    !/(?:src|href)="\/?assets\/|<script[^>]+src=|<link[^>]+rel="stylesheet"/.test(
      preview,
    ),
  );
  for (const name of await readdir(join(source, "assets"))) {
    const bytes = await readFile(join(source, "assets", name));
    const mime = name.endsWith(".svg") ? "image/svg+xml" : "image/png";
    assert(
      preview.includes(`data:${mime};base64,${bytes.toString("base64")}`),
      name,
    );
  }
});

test("modified screenshot bytes fail the build instead of bypassing the content hash", async (t) => {
  const f = await fixture(t);
  const name = (await readdir(join(source, "assets"))).find((name) =>
    name.endsWith(".png"),
  );
  await writeFile(join(f.root, "website/assets", name), "tampered image");
  const result = f.build();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Asset hash mismatch/);
});

test("unexpected files in the public asset directory fail the build", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.root, "website/assets/credentials.json"),
    "test-only sentinel",
  );
  const result = f.build();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected public asset/);
});

test("both locale routes serve translated content and reciprocal SEO without JavaScript", async (t) => {
  const f = await fixture(t);
  success(f.build());
  for (const [language, file, route] of [
    ["en", "en/index.html", "/en/"],
    ["zh", "zh/index.html", "/zh/"],
    ["zh", "index.html", "/"],
  ]) {
    const html = await readFile(join(f.site, file), "utf8");
    const canonical = `https://getbamboo.app${route}`;
    assert(
      html.includes(`<html lang="${language === "en" ? "en" : "zh-CN"}">`),
    );
    assert.equal([...html.matchAll(/rel="canonical"/g)].length, 1);
    assert(html.includes(`<link rel="canonical" href="${canonical}"`));
    for (const [code, path] of [
      ["en", "/en/"],
      ["zh-CN", "/zh/"],
      ["x-default", "/"],
    ])
      assert(
        html.includes(`hreflang="${code}" href="https://getbamboo.app${path}"`),
      );
    for (const match of html.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)) {
      const expected = translations[match[1]][language]
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      assert.equal(match[2], expected, `${language}: ${match[1]}`);
    }
    assert(
      html.includes(
        language === "en" ? "Open a file, see your data" : "打开文件，看见数据",
      ),
    );
    assert(html.includes(language === "en" ? "Privacy Policy" : "隐私政策"));
    assert(
      !/noindex|nofollow|SEO_HEAD|undefined|\/Users\/|\/home\//.test(html),
    );
    const meta = (name) =>
      html.match(
        new RegExp(`<meta (?:property|name)="${name}" content="([^"]+)"`),
      )?.[1];
    assert.equal(meta("og:url"), canonical);
    assert.equal(meta("og:title"), html.match(/<title>([^<]+)<\/title>/)[1]);
    assert.equal(meta("twitter:title"), meta("og:title"));
    assert.equal(meta("description"), meta("og:description"));
    assert.equal(meta("twitter:description"), meta("description"));
    assert.equal(meta("twitter:image"), meta("og:image"));
    const imagePath = new URL(meta("og:image")).pathname;
    const imageBytes = await readFile(join(f.site, imagePath));
    assert.equal(String(imageBytes.readUInt32BE(16)), meta("og:image:width"));
    assert.equal(String(imageBytes.readUInt32BE(20)), meta("og:image:height"));
    const schema = JSON.parse(
      html.match(
        /<script id="structured-data" type="application\/ld\+json">([^<]+)<\/script>/,
      )[1],
    );
    assert.equal(schema["@context"], "https://schema.org");
    assert.equal(
      schema["@graph"].find((item) => item["@type"] === "WebPage").url,
      canonical,
    );
    assert(
      !/aggregateRating|reviewCount|ratingValue|downloadUrl|softwareVersion/.test(
        JSON.stringify(schema),
      ),
    );
    for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"\s]+)"/g))
      assert((await readFile(join(f.site, match[1]))).length > 0);
  }
  const xml = await readFile(join(f.site, "sitemap.xml"), "utf8");
  assert.deepEqual(
    [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
    [
      "https://getbamboo.app/",
      "https://getbamboo.app/en/",
      "https://getbamboo.app/zh/",
    ],
  );
  assert(!/lastmod|priority|changefreq|\?lang=|#privacy/.test(xml));
  assert.equal(
    await readFile(join(f.site, "robots.txt"), "utf8"),
    "User-agent: *\nAllow: /\n\nSitemap: https://getbamboo.app/sitemap.xml\n",
  );
});

test("static translations fail closed on missing copy or nested markup", () => {
  assert.throws(
    () => renderPage('<span data-i18n="missing">test</span>', "en", "/en/"),
    /Missing en translation/,
  );
  assert.throws(
    () =>
      renderPage(
        '<span data-i18n="t0"><strong>test</strong></span>',
        "en",
        "/en/",
      ),
    /leaf text nodes/,
  );
});

test("download catalog is embedded in deployment and standalone preview", async (t) => {
  const f = await fixture(t);
  success(f.build("--standalone"));
  const catalog = JSON.parse(
    await readFile(join(source, "downloads.json"), "utf8"),
  );
  const script = (await files(f.site)).find((name) => name.endsWith(".js"));
  for (const code of [
    await readFile(join(f.site, script), "utf8"),
    await readFile(join(f.root, "build/bamboo-website-preview.html"), "utf8"),
  ]) {
    assert(!code.includes("/* DOWNLOAD_CATALOG */ null"));
    assert(code.includes(JSON.stringify(catalog)));
  }
});

test("invalid download targets stop the real build", async (t) => {
  const f = await fixture(t);
  const catalog = JSON.parse(
    await readFile(join(source, "downloads.json"), "utf8"),
  );
  catalog.platforms.macos.url = "https://example.com/installer.dmg";
  await writeFile(
    join(f.root, "website/downloads.json"),
    JSON.stringify(catalog),
  );
  const result = f.build();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid download catalog/);
});
