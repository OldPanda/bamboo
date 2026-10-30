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
    root.dataset.downloadReady === "true",
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

  const names = { macos: "macOS", windows: "Windows", linux: "Linux" };
  const keys = {
    macos: ["macosDmg"],
    windows: ["windowsSetup", "windowsZip"],
    linux: ["linuxDeb", "linuxTar"],
  };
  const assetFor = (platform) =>
    keys[platform]?.map((key) => catalog.packages[key]).find(Boolean);
  const press = async (key) => {
    const code = key === "Enter" ? 13 : 9;
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code: key,
      windowsVirtualKeyCode: code,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: key,
      windowsVirtualKeyCode: code,
    });
  };
  const anchor = async (selector, target) => {
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).focus()`,
    );
    await press("Enter");
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await evaluate(
          `location.hash === '#${target}' && document.activeElement.id === '${target}'`,
        )
      )
        break;
      await new Promise((done) => setTimeout(done, 30));
    }
    assert.deepEqual(
      await evaluate(`({hash:location.hash, focus:document.activeElement.id})`),
      { hash: `#${target}`, focus: target },
    );
  };
  for (const scenario of cases) {
    const { identifier } = await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `Object.defineProperties(navigator, {
      userAgent: {get:()=>${JSON.stringify(scenario.ua)}}, platform: {get:()=>${JSON.stringify(scenario.platform)}},
      maxTouchPoints: {get:()=>${scenario.touch || 0}}, userAgentData: {get:()=>(${JSON.stringify(scenario.hints || null)})}
    });`,
    });
    try {
      await navigate();
      assert.equal(
        await evaluate("navigator.userAgent"),
        scenario.ua,
        "Platform emulation must be active",
      );
      const state = await evaluate(`({
        select: !!document.getElementById('platform-select'),
        href: document.querySelector('.download-link').getAttribute('href'),
        icon: document.querySelector('[data-platform-icon]').getAttribute('href'),
        label: document.querySelector('[data-download-label]').textContent,
        others: [...document.querySelectorAll('[data-other-platform]')].filter(a=>!a.hidden).map(a=>a.dataset.otherPlatform),
      })`);
      assert.equal(state.select, false);
      const platform = scenario.expected;
      assert.equal(
        state.href,
        assetFor(platform)?.url ||
          (platform ? `#download-${platform}` : "#downloads"),
      );
      assert.equal(
        state.icon,
        `#i-${{ macos: "apple", windows: "windows", linux: "linux" }[platform] || "down"}`,
      );
      assert(state.label.includes(names[platform] || "View all downloads"));
      assert.deepEqual(
        state.others,
        Object.keys(names).filter((p) => p !== platform),
      );
      const other = state.others[0];
      await anchor(`[data-other-platform="${other}"]`, `download-${other}`);
      await press("Tab");
      assert.equal(
        await evaluate(`document.activeElement.closest('.download-card')?.id`),
        `download-${other}`,
      );
      assert.equal(
        await evaluate(
          "document.querySelector('.download-link').getAttribute('href')",
        ),
        state.href,
        "Other-platform link never changes detected CTA",
      );
      if (!platform) await anchor(".download-link", "downloads");
      results.push(scenario.name);
    } finally {
      await send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    }
  }
  // Each package remains visible in either locale/theme, independently of the installation guide.
  for (const width of [1280, 320]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const mode of ["light", "dark"]) {
      await evaluate(`document.documentElement.dataset.theme = '${mode}'`);
      for (const language of ["zh", "en"]) {
        await evaluate(
          `(() => {const s=document.getElementById('language-select');s.value='${language}';s.dispatchEvent(new Event('change'));})()`,
        );
        for (const platform of Object.keys(names)) {
          await anchor(
            `[data-other-platform="${platform}"]`,
            `download-${platform}`,
          );
          for (const key of keys[platform]) {
            const state = await evaluate(
              `(() => {const item=document.querySelector('[data-package="${key}"]');return {tag:item.tagName,href:item.getAttribute('href'),text:item.textContent,disabled:item.classList.contains('package-unavailable')};})()`,
            );
            const asset = catalog.packages[key];
            assert.equal(state.tag, asset ? "A" : "SPAN");
            assert.equal(state.href, asset?.url || null);
            assert.equal(state.disabled, !asset);
            if (!asset)
              assert.match(
                state.text,
                language === "en" ? /Not published yet/ : /尚未正式发布/,
              );
          }
          await evaluate(
            `document.querySelector('[data-guide-platform="${platform}"]').click()`,
          );
          assert.equal(
            await evaluate(
              "document.getElementById('install-platform-select').value",
            ),
            platform,
          );
          assert.deepEqual(
            await evaluate(
              "[...document.querySelectorAll('[data-install-platform]')].filter(p=>!p.hidden).map(p=>p.dataset.installPlatform)",
            ),
            [platform],
          );
          assert.equal(
            await evaluate(
              "document.querySelector('.download-link').getAttribute('href')",
            ),
            "#downloads",
            "Guide selection is independent of device detection",
          );
          assert.equal(
            await evaluate("document.documentElement.scrollWidth > innerWidth"),
            false,
          );
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
            `document.querySelector('[data-install-platform="${platform}"] summary').click()`,
          );
        }
        await evaluate(
          "document.getElementById('downloads').scrollIntoView({behavior:'instant'})",
        );
        await screenshot(`downloads-${language}-${width}-${mode}`);
        await evaluate("window.scrollTo({top:0,behavior:'instant'})");
        await screenshot(`hero-${language}-${width}-${mode}`);
      }
    }
  }
  // Locale routing retains the guide choice and the download anchor, without changing OS detection.
  for (const language of ["en", "zh"]) {
    await navigate(`/${language}/?integration=platform#download-linux`);
    const other = language === "en" ? "zh" : "en";
    await evaluate(
      `(() => {const s=document.getElementById('install-platform-select');s.value='linux';s.dispatchEvent(new Event('change'));const l=document.getElementById('language-select');l.value='${other}';l.dispatchEvent(new Event('change'));})()`,
    );
    assert.deepEqual(
      await evaluate(
        `({guide:document.getElementById('install-platform-select').value,path:location.pathname,hash:location.hash,query:new URLSearchParams(location.search).get('integration'),canonical:document.querySelector('link[rel="canonical"]').href})`,
      ),
      {
        guide: "linux",
        path: `/${other}/`,
        hash: "#download-linux",
        query: "platform",
        canonical: `https://getbamboo.app/${other}/`,
      },
    );
  }
  return results;
}
