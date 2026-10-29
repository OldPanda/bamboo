/** Test preference recovery and shared legal links in the existing real browser. */
import assert from "node:assert/strict";

export async function checkPreferences({ send, evaluate, origin }) {
  const navigate = async (path) => {
    const url = origin + path;
    await send("Page.navigate", { url });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await evaluate(
          `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`,
        )
      )
        return;
      await new Promise((done) => setTimeout(done, 30));
    }
    assert.fail(`Navigation did not finish: ${path}`);
  };
  const selectLanguage = async (language) =>
    evaluate(`(() => {
    const select = document.getElementById('language-select');
    select.value = ${JSON.stringify(language)};
    select.dispatchEvent(new Event('change'));
  })()`);

  await evaluate(
    "localStorage.setItem('bamboo-site-language', 'zh'); localStorage.setItem('bamboo-site-theme', 'light')",
  );
  await navigate("/?lang=en&ref=shared#privacy");
  assert.deepEqual(
    await evaluate(
      `({lang: document.documentElement.lang, open: document.getElementById('privacy').open, title: document.getElementById('privacy-title').textContent})`,
    ),
    { lang: "en", open: true, title: "Privacy Policy" },
    "Shared language takes priority over saved language and opens the legal dialog",
  );
  await selectLanguage("zh");
  assert.deepEqual(
    await evaluate(
      `({lang: document.documentElement.lang, open: document.getElementById('privacy').open, search: location.search, hash: location.hash, title: document.getElementById('privacy-title').textContent})`,
    ),
    {
      lang: "zh-CN",
      open: true,
      search: "?lang=zh&ref=shared",
      hash: "#privacy",
      title: "隐私政策",
    },
    "Switching language preserves the open document and unrelated URL parameters",
  );
  await evaluate(
    "document.querySelector('#privacy [data-close-legal]').click()",
  );
  for (
    let attempt = 0;
    attempt < 50 && (await evaluate("location.hash !== ''"));
    attempt++
  )
    await new Promise((done) => setTimeout(done, 20));
  assert.equal(
    await evaluate("location.search + location.hash"),
    "?lang=zh&ref=shared",
  );

  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  await navigate("/?check=saved-theme");
  assert.deepEqual(
    await evaluate(
      `({theme: document.documentElement.dataset.theme, icon: document.querySelector('#theme-toggle use').getAttribute('href'), pressed: document.getElementById('theme-toggle').getAttribute('aria-pressed')})`,
    ),
    { theme: "light", icon: "#i-moon", pressed: "false" },
    "Saved light preference overrides dark system appearance after navigation",
  );
  await evaluate("document.getElementById('theme-toggle').click()");
  await navigate("/?check=changed-theme");
  assert.equal(
    await evaluate("document.documentElement.dataset.theme"),
    "dark",
    "Theme changes survive navigation",
  );

  await send("Emulation.setUserAgentOverride", {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    acceptLanguage: "en-US,en",
  });
  await evaluate(
    "localStorage.setItem('bamboo-site-language', 'invalid'); localStorage.setItem('bamboo-site-theme', 'invalid')",
  );
  await navigate("/?lang=invalid&check=fallback");
  assert.deepEqual(
    await evaluate(
      `({lang: document.documentElement.lang, theme: document.documentElement.dataset.theme || null, icon: document.querySelector('#theme-toggle use').getAttribute('href')})`,
    ),
    { lang: "en", theme: null, icon: "#i-sun" },
    "Invalid preferences fall back to browser language and system appearance",
  );

  // Real pages can lose storage access in private or restricted browsing contexts.
  const { identifier } = await send("Page.addScriptToEvaluateOnNewDocument", {
    source:
      "Object.defineProperty(window, 'localStorage', {get() {throw new DOMException('Storage disabled for regression test', 'SecurityError');}})",
  });
  try {
    await navigate("/?lang=en&check=no-storage");
    assert.equal(await evaluate("document.documentElement.lang"), "en");
    await selectLanguage("zh");
    await evaluate("document.getElementById('theme-toggle').click()");
    assert.deepEqual(
      await evaluate(
        `({lang: document.documentElement.lang, theme: document.documentElement.dataset.theme, icon: document.querySelector('#theme-toggle use').getAttribute('href')})`,
      ),
      { lang: "zh-CN", theme: "light", icon: "#i-moon" },
      "Language and theme remain usable when storage reads and writes throw",
    );
  } finally {
    await send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  }
  await navigate("/?lang=en&check=restored");
  await evaluate(
    "localStorage.removeItem('bamboo-site-language'); localStorage.removeItem('bamboo-site-theme')",
  );
  return [
    "shared-language-and-legal-link",
    "language-switch-keeps-dialog-and-url",
    "theme-persistence",
    "invalid-preference-fallback",
    "storage-unavailable",
  ];
}
