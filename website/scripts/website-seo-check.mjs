/** Check raw locale routes and browser metadata with and without JavaScript. */
import assert from "node:assert/strict";

export async function checkSEO({ send, evaluate, origin }) {
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
    assert.fail(`Locale route did not load: ${path}`);
  };
  const snapshot = () =>
    evaluate(`(() => {
    const meta = (name) => document.querySelector('meta[property="' + name + '"],meta[name="' + name + '"]')?.content;
    const schema = JSON.parse(document.getElementById('structured-data').textContent);
    return {
      lang: document.documentElement.lang,
      title: document.title,
      heading: document.getElementById('hero-heading').textContent,
      canonical: document.querySelector('link[rel="canonical"]').href,
      ogURL: meta('og:url'), ogTitle: meta('og:title'), twitterTitle: meta('twitter:title'),
      image: meta('og:image'), twitterImage: meta('twitter:image'),
      schemaURL: schema['@graph'].find(item => item['@type'] === 'WebPage').url,
      translatedText: [...document.querySelectorAll('[data-i18n]')].map(node => node.textContent),
      links: [...document.querySelectorAll('a[hreflang]')].map(node => new URL(node.href).pathname),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  const assertLocale = (state, language) => {
    const url = `https://getbamboo.app/${language}/`;
    assert.equal(state.lang, language === "en" ? "en" : "zh-CN");
    for (const key of ["canonical", "ogURL", "schemaURL"])
      assert.equal(state[key], url, key);
    assert.equal(state.ogTitle, state.title);
    assert.equal(state.twitterTitle, state.title);
    assert.equal(state.image, state.twitterImage);
    assert(state.image.startsWith("https://getbamboo.app/assets/"));
    assert(
      state.heading.includes(
        language === "en" ? "Parquet data" : "让 Parquet 数据",
      ),
    );
    assert(state.links.includes("/en/") && state.links.includes("/zh/"));
    assert(
      !state.translatedText.some(
        (text) => !text.trim() || text === "undefined",
      ),
    );
    if (language === "en")
      assert(
        !state.translatedText.some((text) => /[\u4e00-\u9fff]/.test(text)),
      );
    assert.equal(state.overflow, false);
  };

  for (const disabled of [true, false]) {
    await send("Emulation.setScriptExecutionDisabled", { value: disabled });
    try {
      for (const language of ["en", "zh"]) {
        await navigate(`/${language}/`);
        assertLocale(await snapshot(), language);
        if (!disabled) {
          const other = language === "en" ? "zh" : "en";
          // Explicit routes win over a conflicting saved preference on reload.
          await evaluate(
            `localStorage.setItem('bamboo-site-language', '${other}')`,
          );
          await navigate(`/${language}/?check=route-priority`);
          assertLocale(await snapshot(), language);
          await evaluate(
            `(() => { const select = document.getElementById('language-select'); select.value = '${other}'; select.dispatchEvent(new Event('change')); })()`,
          );
          assertLocale(await snapshot(), other);
          assert.equal(await evaluate("location.pathname"), `/${other}/`);
          await navigate(`/${other}/?check=reload`);
          assertLocale(await snapshot(), other);
        }
      }
    } finally {
      await send("Emulation.setScriptExecutionDisabled", { value: false });
    }
  }
  await navigate("/en/?check=history");
  await evaluate("location.hash = 'features'");
  await evaluate(
    `(() => { const select = document.getElementById('language-select'); select.value = 'zh'; select.dispatchEvent(new Event('change')); })()`,
  );
  assertLocale(await snapshot(), "zh");
  await evaluate(
    "new Promise(resolve => { window.addEventListener('popstate', () => resolve(true), {once:true}); history.back(); })",
  );
  assertLocale(await snapshot(), "en");
  await navigate("/en/?lang=zh#privacy");
  assertLocale(await snapshot(), "zh");
  assert.equal(await evaluate("document.getElementById('privacy').open"), true);
  await evaluate("localStorage.removeItem('bamboo-site-language')");
  return [
    "locale-html-without-javascript",
    "route-precedence",
    "locale-switch-and-reload",
    "legacy-query-links",
    "back-navigation-restores-locale",
    "metadata-consistency",
  ];
}
