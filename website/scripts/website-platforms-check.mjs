/** Exercise OS detection, manual choices and install disclosures in the actual built page. */
import assert from "node:assert/strict";

/** Browser readiness predicate, also tested against the empty document during navigation. */
export function platformPageReady(marker) {
  const root = document.documentElement;
  const label = document.querySelector("[data-download-label]");
  return Boolean(
    root &&
    !root.dataset.platformTestLeaving &&
    new URLSearchParams(location.search).get("platform-test") === marker &&
    document.readyState === "complete" &&
    label?.textContent &&
    label.textContent !== "选择下载平台",
  );
}

export async function checkPlatforms({
  send,
  evaluate,
  origin,
  catalog,
  screenshot,
}) {
  const results = [];
  let navigation = 0;
  const navigate = async (path = "/?lang=en") => {
    const marker = String(++navigation);
    await evaluate(
      "document.documentElement.dataset.platformTestLeaving = 'true'",
    );
    const url = new URL(path, origin);
    url.searchParams.set("platform-test", marker);
    await send("Page.navigate", { url: url.href });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await evaluate(
          `(${platformPageReady.toString()})(${JSON.stringify(marker)})`,
        )
      )
        return;
      await new Promise((done) => setTimeout(done, 30));
    }
    throw Error("Platform page did not initialize");
  };
  const cases = [
    {
      name: "macOS",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      expected: "macos",
    },
    {
      name: "Windows",
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      platform: "Win32",
      expected: "windows",
    },
    {
      name: "Linux",
      ua: "Mozilla/5.0 (X11; Linux x86_64)",
      platform: "Linux x86_64",
      expected: "linux",
    },
    {
      name: "iPhone",
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      platform: "iPhone",
      expected: "",
    },
    {
      name: "iPad desktop mode",
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      touch: 5,
      expected: "",
    },
    {
      name: "Android",
      ua: "Mozilla/5.0 (Linux; Android 15)",
      platform: "Linux armv8l",
      expected: "",
    },
    {
      name: "ChromeOS",
      ua: "Mozilla/5.0 (X11; CrOS x86_64 12345)",
      platform: "Linux x86_64",
      expected: "",
    },
    { name: "Unknown", ua: "Unrecognized browser", platform: "", expected: "" },
    {
      name: "Client hints",
      ua: "Reduced UA",
      platform: "",
      hints: { platform: "Windows", mobile: false },
      expected: "windows",
    },
    {
      name: "Mobile client hints",
      ua: "Reduced UA",
      platform: "Linux",
      hints: { platform: "Linux", mobile: true },
      expected: "",
    },
  ];
  for (const scenario of cases) {
    const { identifier } = await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `Object.defineProperties(navigator, {
      userAgent: {get:()=>${JSON.stringify(scenario.ua)}},
      platform: {get:()=>${JSON.stringify(scenario.platform)}},
      maxTouchPoints: {get:()=>${scenario.touch || 0}},
      userAgentData: {get:()=>(${JSON.stringify(scenario.hints || null)})}
    });`,
    });
    try {
      await navigate();
      assert.equal(
        await evaluate("navigator.userAgent"),
        scenario.ua,
        "Platform emulation must be active before checking detection",
      );
      assert.equal(
        await evaluate("document.getElementById('platform-select').value"),
        scenario.expected,
        scenario.name,
      );
      if (!scenario.expected) {
        assert.equal(
          await evaluate(
            "document.querySelector('.download-link').getAttribute('href')",
          ),
          "#platform-select",
        );
        await evaluate(
          "document.querySelector('.closing .download-link').click()",
        );
        assert.equal(
          await evaluate("document.activeElement.id"),
          "platform-select",
        );
        assert.equal(
          await evaluate("document.getElementById('download-hint').hidden"),
          false,
        );
      }
      results.push(scenario.name);
    } finally {
      await send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    }
  }
  // A phone visitor can deliberately select a desktop download; choices survive language/theme changes.
  for (const width of [1280, 320]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const mode of ["light", "dark"]) {
      await evaluate(`document.documentElement.dataset.theme = '${mode}'`);
      for (const language of ["zh", "en"]) {
        await evaluate(
          `(() => {const s=document.getElementById('language-select'); s.value='${language}'; s.dispatchEvent(new Event('change'));})()`,
        );
        for (const platform of ["macos", "windows", "linux"]) {
          await evaluate(
            `(() => {const s=document.getElementById('platform-select'); s.value='${platform}'; s.dispatchEvent(new Event('change'));})()`,
          );
          const state = await evaluate(`(() => {
            const panel = document.querySelector('[data-install-platform="${platform}"]');
            const select = document.getElementById('install-platform-select');
            const links = [...document.querySelectorAll('.download-link')];
            return {selected:select.value, visible:[...document.querySelectorAll('[data-install-platform]')].filter(p=>!p.hidden).map(p=>p.dataset.installPlatform), urls:links.map(a=>a.href), labels:links.map(a=>a.textContent.trim()), icons:links.map(a=>a.querySelector('[data-platform-icon]').getAttribute('href')), status:document.getElementById('download-status').textContent, overflow:document.documentElement.scrollWidth > innerWidth, language:document.documentElement.lang, background:getComputedStyle(select).backgroundColor, panelText:panel.textContent};
          })()`);
          assert.equal(state.selected, platform);
          assert.deepEqual(state.visible, [platform]);
          const asset = catalog.platforms[platform];
          assert(
            state.urls.every(
              (url) =>
                url ===
                (asset?.url || "https://github.com/OldPanda/bamboo/releases"),
            ),
          );
          assert(
            state.icons.every(
              (icon) =>
                icon ===
                `#i-${{ macos: "apple", windows: "windows", linux: "linux" }[platform]}`,
            ),
          );
          assert(
            state.labels.every((label) =>
              label.includes(
                { macos: "macOS", windows: "Windows", linux: "Linux" }[
                  platform
                ],
              ),
            ),
          );
          assert.match(
            state.status,
            asset
              ? /Apple Silicon|x64/
              : language === "en"
                ? /No published .* installer yet/
                : /尚未正式发布/,
          );
          assert.equal(
            state.overflow,
            false,
            `${width} ${mode} ${language} ${platform}`,
          );
          assert.equal(
            /[\u4e00-\u9fff]/.test(state.panelText),
            language === "zh",
          );
          assert.notEqual(state.background, "rgba(0, 0, 0, 0)");
          await evaluate(
            `document.querySelector('[data-install-platform="${platform}"] summary').click()`,
          );
          assert.equal(
            await evaluate(
              `document.querySelector('[data-install-platform="${platform}"] details').open`,
            ),
            true,
          );
          if (language === "en") {
            await evaluate(
              "document.getElementById('install').scrollIntoView({behavior:'instant'})",
            );
            await screenshot(`platform-${platform}-${width}-${mode}-install`);
          }
          await evaluate(
            `document.querySelector('[data-install-platform="${platform}"] summary').click(); window.scrollTo({top:0,behavior:'instant'})`,
          );
          if (language === "en")
            await screenshot(`platform-${platform}-${width}-${mode}`);
        }
      }
    }
  }
  await evaluate(
    "(() => {const s=document.getElementById('install-platform-select'); s.value='windows'; s.dispatchEvent(new Event('change')); document.getElementById('theme-toggle').click(); const l=document.getElementById('language-select');l.value='zh';l.dispatchEvent(new Event('change'));})()",
  );
  assert.equal(
    await evaluate("document.getElementById('platform-select').value"),
    "windows",
  );
  assert.match(
    await evaluate(
      "document.querySelector('[data-download-label]').textContent",
    ),
    /Windows/,
  );
  // Combining SEO routes with downloads must preserve the manual platform choice.
  for (const language of ["en", "zh"]) {
    await navigate(`/${language}/?integration=platform#install`);
    assert.equal(
      await evaluate("document.documentElement.lang"),
      language === "en" ? "en" : "zh-CN",
    );
    const other = language === "en" ? "zh" : "en";
    await evaluate(`(() => {
      const platform = document.getElementById('platform-select');
      platform.value = 'linux'; platform.dispatchEvent(new Event('change'));
      const locale = document.getElementById('language-select');
      locale.value = '${other}'; locale.dispatchEvent(new Event('change'));
    })()`);
    assert.deepEqual(
      await evaluate(`({
      platform: document.getElementById('install-platform-select').value,
      path: location.pathname, hash: location.hash,
      query: new URLSearchParams(location.search).get('integration'),
      canonical: document.querySelector('link[rel="canonical"]').href,
      label: document.querySelector('[data-download-label]').textContent.includes('Linux'),
    })`),
      {
        platform: "linux",
        path: `/${other}/`,
        hash: "#install",
        query: "platform",
        canonical: `https://getbamboo.app/${other}/`,
        label: true,
      },
    );
  }
  return results;
}
