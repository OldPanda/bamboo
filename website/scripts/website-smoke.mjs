/** Verify the built website over HTTP in headless Chrome without opening the app. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = join(root, "artifacts/website");
const site = resolve(root, "build/website");
const html = await readFile(join(site, "index.html"), "utf8");
assert(
  !/\/Users\/|\/home\/|__APP_ICON__|__BRAND_ART__/.test(html),
  "Private paths or unexpanded assets",
);
assert(
  !/<(?:script|link)[^>]+(?:src|href)=["']https?:/i.test(html),
  "External runtime dependency",
);
assert(!/<form\b/i.test(html), "Feedback must link to GitHub, not a form");
// Bind each published screenshot to the original native capture record.
const provenance = JSON.parse(
  await readFile(join(root, "website/screenshot-provenance.json"), "utf8"),
);
const macOSProvenance = JSON.parse(
  await readFile(
    join(root, "website/macos-screenshot-provenance.json"),
    "utf8",
  ),
);
assert.equal(provenance.mockedIPC, false);
assert.equal(provenance.result.nativeIPC, true);
for (const [mode, name] of [
  ["light", "bamboo-sql.png"],
  ["dark", "bamboo-sql-dark.png"],
]) {
  const image = html.match(
    new RegExp(
      `class="native-shot native-shot-${mode}"[\\s\\S]*?src="([^"]+)"`,
    ),
  );
  assert(image, `Missing ${mode} native screenshot`);
  const bytes = await readFile(join(site, image[1]));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    provenance.images[name],
    "Screenshot bytes changed since native capture",
  );
}
// Serve the actual Pages build, including its CSP, rather than a file:// mock.
const headers = Object.fromEntries(
  (await readFile(join(site, "_headers"), "utf8"))
    .split("\n\n")[0]
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    }),
);
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    const file = resolve(
      site,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!file.startsWith(site + sep)) {
      response.writeHead(403).end();
      return;
    }
    const bytes = await readFile(file);
    const mime =
      {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
      }[extname(file)] || "application/octet-stream";
    response.writeHead(200, { ...headers, "Content-Type": mime }).end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
server.unref();
const origin = `http://127.0.0.1:${server.address().port}`;
const assetBytes = async (url) => {
  assert.equal(new URL(url).origin, origin, "Screenshots must be local assets");
  const response = await fetch(url);
  assert(response.ok, `Missing asset: ${url}`);
  return Buffer.from(await response.arrayBuffer());
};
const profile = await mkdtemp(join(tmpdir(), "bamboo-site-chrome-"));
const chrome =
  process.env.BAMBOO_CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const proc = spawn(
  chrome,
  [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-gpu",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let socket;
try {
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    let data = "";
    const timeout = setTimeout(
      () => reject(Error("Headless browser startup timeout")),
      15000,
    );
    proc.stderr.on("data", (bytes) => {
      data += bytes;
      const match = data.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolveEndpoint(match[1]);
      }
    });
    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolveSocket, reject) => {
    socket.onopen = resolveSocket;
    socket.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map();
  const errors = [],
    remoteRequests = [];
  socket.onmessage = (event) => {
    const reply = JSON.parse(event.data);
    if (pending.has(reply.id)) {
      const { done, fail, timeout } = pending.get(reply.id);
      pending.delete(reply.id);
      clearTimeout(timeout);
      if (reply.error) fail(Error(JSON.stringify(reply.error)));
      else done(reply.result);
    } else if (reply.method === "Runtime.exceptionThrown")
      errors.push(reply.params.exceptionDetails);
    else if (
      reply.method === "Network.requestWillBeSent" &&
      /^https?:/.test(reply.params.request.url) &&
      new URL(reply.params.request.url).origin !== origin
    )
      remoteRequests.push(reply.params.request.url);
  };
  function call(method, params = {}, sessionId) {
    return new Promise((done, fail) => {
      const id = ++sequence;
      const timeout = setTimeout(() => {
        pending.delete(id);
        fail(Error(`CDP timeout: ${method}`));
      }, 15000);
      pending.set(id, { done, fail, timeout });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  const { targetId } = await call("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const send = (method, params) => call(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send("Runtime.enable");
  await send("Network.enable");
  await mkdir(output, { recursive: true });
  const cases = [
    { width: 1280, height: 960, mode: "light" },
    { width: 1280, height: 960, mode: "dark" },
    { width: 768, height: 1024, mode: "light" },
    { width: 390, height: 844, mode: "light" },
    { width: 320, height: 780, mode: "dark" },
  ];
  const results = [];
  for (const scenario of cases) {
    const { width, height, mode } = scenario;
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: mode },
        { name: "prefers-reduced-motion", value: "reduce" },
      ],
    });
    await send("Page.navigate", {
      url: origin + "/",
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await evaluate(
          "document.readyState === 'complete' && [...document.querySelectorAll('.native-shot')].length === 2 && [...document.querySelectorAll('.native-shot')].every(image => image.complete && image.naturalWidth > 1000)",
        )
      )
        break;
      await new Promise((done) => setTimeout(done, 50));
    }
    await evaluate(
      "localStorage.removeItem('bamboo-site-theme'); delete document.documentElement.dataset.theme; window.dispatchEvent(new Event('resize'))",
    );
    for (const language of ["zh", "en"]) {
      await evaluate(
        `(() => { const select = document.getElementById('language-select'); select.value = '${language}'; select.dispatchEvent(new Event('change')); })()`,
      );
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          await evaluate(
            "[...document.querySelectorAll('.native-shot')].every(image => image.complete && image.naturalWidth === 2560)",
          )
        )
          break;
        await new Promise((done) => setTimeout(done, 30));
      }
      const localizedShots = await evaluate(
        "[...document.querySelectorAll('.native-shot')].map(image => ({dark: image.classList.contains('native-shot-dark'), src: image.src, loaded: image.complete && image.naturalWidth === 2560}))",
      );
      assert.equal(localizedShots.length, 2);
      for (const shot of localizedShots) {
        assert(shot.loaded, "Localized native screenshot must load");
        const name = shot.dark ? "bamboo-sql-dark.png" : "bamboo-sql.png";
        const hash = createHash("sha256")
          .update(await assetBytes(shot.src))
          .digest("hex");
        assert.equal(
          hash,
          provenance.localizedCaptures[language].images[name],
          "Website language must select the matching actual native screenshot",
        );
      }
      if (width === 1280 && mode === "light") {
        const localizedHero = await send("Page.captureScreenshot", {
          format: "png",
        });
        await writeFile(
          join(output, `bamboo-hero-${language}.png`),
          Buffer.from(localizedHero.data, "base64"),
        );
      }
      const permissionShot = await evaluate(`(async () => {
        const image = document.querySelector('.permission-screenshot img');
        image.loading = 'eager';
        await image.decode();
        return {src: image.src, width: image.naturalWidth, height: image.naturalHeight, support: [...document.querySelectorAll('[data-apple-support]')].map(link => link.href)};
      })()`);
      const permissionSource = macOSProvenance.localizedImages[language];
      assert.equal(
        createHash("sha256")
          .update(await assetBytes(permissionShot.src))
          .digest("hex"),
        permissionSource.sha256,
        "Installation image must use the matching real macOS language screenshot",
      );
      assert.equal(permissionShot.width, permissionSource.width);
      assert.equal(permissionShot.height, permissionSource.height);
      assert(
        permissionShot.support.length >= 2 &&
          permissionShot.support.every(
            (link) => link === permissionSource.sourcePage,
          ),
      );
      const locale = await evaluate(`(() => {
        const heading = document.getElementById('hero-heading').textContent;
        const privacy = document.getElementById('privacy-title').textContent;
        const terms = document.getElementById('terms-title').textContent;
        const translations = [...document.querySelectorAll('[data-i18n]')];
        return {lang: document.documentElement.lang, heading, privacy, terms, saved: localStorage.getItem('bamboo-site-language'), blank: translations.some(node => !node.textContent.trim() || node.textContent === 'undefined'), overflow: document.documentElement.scrollWidth > innerWidth, englishHasChinese: translations.some(node => /[\u4e00-\u9fff]/.test(node.textContent))};
      })()`);
      assert.equal(locale.lang, language === "en" ? "en" : "zh-CN");
      assert.equal(locale.saved, language);
      assert.equal(locale.blank, false);
      assert.equal(
        locale.overflow,
        false,
        JSON.stringify({ scenario, locale }),
      );
      assert.equal(
        locale.privacy,
        language === "en" ? "Privacy Policy" : "隐私政策",
      );
      assert.equal(
        locale.terms,
        language === "en" ? "Terms of Use" : "使用条款",
      );
      const cards = await evaluate(`(() => {
        const grid = document.querySelector('.feature-grid');
        const items = [...grid.querySelectorAll('.feature-card')];
        const rects = selector => items.map(card => { const r = card.querySelector(selector).getBoundingClientRect(); return {top:r.top, bottom:r.bottom}; });
        return {columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, art:rects('.feature-art'), headings:rects('h3'), paragraphs:rects('.feature-copy p'), clipped:items.some(card => {const art=card.querySelector('.feature-art'); return art.scrollHeight > art.clientHeight + 1;})};
      })()`);
      assert.equal(
        cards.clipped,
        false,
        "Feature visual content must not be clipped",
      );
      if (cards.columns === 3) {
        for (const row of [cards.art, cards.headings, cards.paragraphs]) {
          assert(
            Math.max(...row.map((r) => r.top)) -
              Math.min(...row.map((r) => r.top)) <
              1,
            "Feature images and text must align across cards",
          );
        }
        assert(
          Math.max(...cards.art.map((r) => r.bottom)) -
            Math.min(...cards.art.map((r) => r.bottom)) <
            1,
          "Feature images need equal heights",
        );
      }
      if (language === "en") {
        assert.equal(
          locale.englishHasChinese,
          false,
          "Untranslated English content",
        );
        assert.match(locale.heading, /Parquet data/);
      } else assert.match(locale.heading, /Parquet 数据/);
    }
    const layout = await evaluate(`(() => {
      const ids = [...document.querySelectorAll('[id]')].map(item => item.id);
      const brokenAnchors = [...document.querySelectorAll('a[href^="#"]')].filter(link => link.hash && !document.getElementById(link.hash.slice(1))).map(link => link.hash);
      const footer = document.querySelector('.made-with');
      return {footerRight: Math.abs(footer.getBoundingClientRect().right - document.querySelector('.site-footer .shell').getBoundingClientRect().right) < 1, overflow: document.documentElement.scrollWidth > innerWidth, duplicates: ids.filter((id, index) => ids.indexOf(id) !== index), brokenAnchors, features: document.querySelectorAll('.feature-card').length, footer: footer.textContent.replace(/\\s+/g, ' ').trim(), creator: footer.querySelector('a').href, issues: !!document.querySelector('a[href="https://github.com/OldPanda/bamboo/issues"]'), discussions: !!document.querySelector('a[href="https://github.com/OldPanda/bamboo/discussions"]'), guide: !!document.getElementById('first-open'), dark: matchMedia('(prefers-color-scheme: dark)').matches};
    })()`);
    assert.equal(layout.overflow, false, JSON.stringify({ scenario, layout }));
    assert.deepEqual(layout.duplicates, []);
    assert.deepEqual(layout.brokenAnchors, []);
    assert.equal(
      layout.footerRight,
      true,
      "Creator attribution must remain at the right edge",
    );
    assert.equal(layout.features, 3);
    assert.equal(layout.footer, "Made with ♡ by OldPanda");
    assert.equal(layout.creator, "https://x.com/OldPanda");
    assert(layout.issues && layout.discussions && layout.guide);
    assert.equal(layout.dark, mode === "dark");
    for (const id of ["terms", "privacy"]) {
      await evaluate(
        `document.querySelector('.footer-links a[href="#${id}"]').click()`,
      );
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await evaluate(`document.getElementById('${id}').open`)) break;
        await new Promise((done) => setTimeout(done, 20));
      }
      assert.equal(
        await evaluate(`document.getElementById('${id}').open`),
        true,
      );
      const legal = await evaluate(`(() => {
        const dialog = document.getElementById('${id}');
        return {overflow: dialog.scrollWidth > dialog.clientWidth, withinViewport: dialog.getBoundingClientRect().width <= innerWidth, sections: dialog.querySelectorAll('h3').length, focused: dialog.contains(document.activeElement)};
      })()`);
      assert.equal(legal.overflow, false);
      assert(legal.withinViewport && legal.focused && legal.sections >= 6);
      if (id === "privacy") {
        const legalShot = await send("Page.captureScreenshot", {
          format: "png",
        });
        await writeFile(
          join(output, `bamboo-privacy-${width}-${mode}.png`),
          Buffer.from(legalShot.data, "base64"),
        );
      }
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      for (let attempt = 0; attempt < 50; attempt++) {
        if (
          await evaluate(
            `!document.getElementById('${id}').open && location.hash === ''`,
          )
        )
          break;
        await new Promise((done) => setTimeout(done, 20));
      }
      assert.equal(
        await evaluate(
          `!document.getElementById('${id}').open && location.hash === ''`,
        ),
        true,
      );
    }
    assert.equal(
      await evaluate(
        "document.querySelector('#theme-toggle use').getAttribute('href')",
      ),
      mode === "dark" ? "#i-sun" : "#i-moon",
    );
    await evaluate("document.getElementById('theme-toggle').click()");
    assert.equal(
      await evaluate("document.documentElement.dataset.theme"),
      mode === "dark" ? "light" : "dark",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('#theme-toggle use').getAttribute('href')",
      ),
      mode === "dark" ? "#i-moon" : "#i-sun",
    );
    await evaluate("document.getElementById('theme-toggle').click()");
    const images = await evaluate(`(() => {
      const light = document.querySelector('.native-shot-light'), dark = document.querySelector('.native-shot-dark');
      return {light: getComputedStyle(light).display !== 'none', dark: getComputedStyle(dark).display !== 'none', loaded: [light, dark].every(image => image.complete && image.naturalWidth > 1000), simulatedControls: document.querySelectorAll('[data-source], [data-query], #run-query').length};
    })()`);
    assert.equal(images.loaded, true);
    assert.equal(images.light, mode === "light");
    assert.equal(images.dark, mode === "dark");
    assert.equal(images.simulatedControls, 0, "Simulated UI must be removed");
    if (width < 700) {
      await evaluate("document.getElementById('menu-toggle').click()");
      assert.equal(
        await evaluate("document.getElementById('mobile-nav').hidden"),
        false,
      );
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      assert.equal(
        await evaluate("document.getElementById('mobile-nav').hidden"),
        true,
      );
    }
    await evaluate("document.querySelector('#first-open > summary').click()");
    assert.equal(
      await evaluate("document.getElementById('first-open').open"),
      true,
    );
    assert.equal(
      await evaluate("document.documentElement.scrollWidth > innerWidth"),
      false,
    );
    await evaluate(
      "document.querySelector('#first-open > summary').click(); document.querySelector('.faq-list summary').click()",
    );
    assert.equal(
      await evaluate("document.querySelector('.faq-list details').open"),
      true,
    );
    await evaluate(
      "document.querySelector('.faq-list summary').click(); window.scrollTo(0, 0)",
    );
    await new Promise((done) => setTimeout(done, 120));
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      join(output, `bamboo-${width}-${mode}.png`),
      Buffer.from(shot.data, "base64"),
    );
    const metrics = await send("Page.getLayoutMetrics");
    const full = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width,
        height: metrics.cssContentSize.height,
        scale: 1,
      },
    });
    await writeFile(
      join(output, `bamboo-${width}-${mode}-full.png`),
      Buffer.from(full.data, "base64"),
    );
    results.push({ ...scenario, ...layout, interactions: "passed" });
    console.log(
      `${width}px ${mode}: layout, native screenshots, disclosures, theme, navigation and links passed`,
    );
  }
  await send("Page.reload");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await evaluate(
        "document.readyState === 'complete' && document.getElementById('language-select')?.value === 'en' && document.documentElement.lang === 'en'",
      )
    )
      break;
    await new Promise((done) => setTimeout(done, 30));
  }
  assert.equal(
    await evaluate("document.documentElement.lang"),
    "en",
    "Restore saved language",
  );
  await send("Emulation.setUserAgentOverride", {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  });
  assert.equal(
    await evaluate(
      "(() => { const event = new MouseEvent('click', {bubbles:true, cancelable:true}); const allowed = document.querySelector('.download-link').dispatchEvent(event); return !allowed && !document.getElementById('download-hint').hidden; })()",
    ),
    true,
    "Phone download must explain the Mac requirement instead of downloading a DMG",
  );
  assert.deepEqual(
    remoteRequests,
    [],
    "Website must work without external asset requests",
  );
  assert.deepEqual(errors, [], "Website JavaScript errors");
  await writeFile(
    join(output, "verification.json"),
    JSON.stringify(
      {
        results,
        phoneDownload: "passed",
        externalRequests: remoteRequests,
        javascriptErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Website verification passed; screenshots saved in artifacts/website.",
  );
} finally {
  server.close();
  socket?.close();
  proc.kill("SIGTERM");
  await new Promise((done) => {
    if (proc.exitCode !== null || proc.signalCode !== null || !proc.pid) done();
    else proc.once("exit", done);
  });
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
