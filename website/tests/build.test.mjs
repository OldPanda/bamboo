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
    "downloads.json",
    "scripts/download-catalog.mjs",
    "_headers",
    "assets",
    "scripts/website-build.mjs",
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
    ["_headers", "index.html"],
  );
  assert.equal(output.filter((path) => /\.(css|js)$/.test(path)).length, 2);
  assert.equal(
    output.length,
    (await readdir(join(source, "assets"))).length + 4,
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
  const refs = [...html.matchAll(/(?:src|href)="(assets\/[^"\s]+)"/g)].map(
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
  assert(preview.includes("<style>") && preview.includes("<script>"));
  assert(!/assets\/|<script[^>]+src=|<link[^>]+rel="stylesheet"/.test(preview));
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
