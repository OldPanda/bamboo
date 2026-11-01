/** Exercise the real documentation routes, including static HTML and phone layouts. */
import assert from "node:assert/strict";

export async function checkDocs({ send, evaluate, origin, screenshot }) {
  const navigate = async (path, scripted = true) => {
    const url = origin + path;
    await send("Page.navigate", { url });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await evaluate(
          `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && document.body?.dataset.page === 'docs' && ${scripted ? "document.documentElement?.dataset.downloadReady === 'true'" : "true"}`,
        )
      )
        return;
      await new Promise((done) => setTimeout(done, 30));
    }
    assert.fail(`Documentation did not load: ${path}`);
  };
  const snapshot = () =>
    evaluate(`(() => {
    const ids = [...document.querySelectorAll('[id]')].map(n => n.id);
    const meta = name => document.querySelector('meta[property="'+name+'"],meta[name="'+name+'"]')?.content;
    const schema = JSON.parse(document.getElementById('structured-data').textContent);
    return {
      lang: document.documentElement.lang,
      heading: document.querySelector('h1').textContent,
      title: document.title,
      canonical: document.querySelector('link[rel="canonical"]').href,
      ogURL: meta('og:url'), ogTitle: meta('og:title'), twitterTitle: meta('twitter:title'),
      schemaURL: schema['@graph'].find(n => n['@type'] === 'WebPage').url,
      copy: [...document.querySelectorAll('[data-i18n]')].map(n => n.textContent),
      missingAnchors: [...document.querySelectorAll('a[href^="#"]')].filter(n => !ids.includes(n.hash.slice(1))).map(n => n.hash),
      packages: [...document.querySelectorAll('[data-package]')].map(n => n.dataset.package),
      sectionCount: document.querySelectorAll('.docs-content > section').length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      home: document.querySelector('.brand').getAttribute('href'),
      docsLink: document.querySelector('a[data-route="docs"]').getAttribute('href'),
      alternates: [...document.querySelectorAll('head link[rel="alternate"][hreflang]')].map(node => new URL(node.href).pathname),
      language: document.getElementById('language-select').value,
      languageOptions: [...document.querySelectorAll('#language-select option')].map(node => node.value).sort(),
      footerLanguageLinks: [...document.querySelectorAll('footer a')].filter(node => node.hasAttribute('hreflang') || ['English', '中文'].includes(node.textContent.trim())).length,
    };
  })()`);
  const assertAnchorVisible = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await evaluate(`(() => {
          const top = document.getElementById('int96').getBoundingClientRect().top;
          return top >= 60 && top < 220;
        })()`)
      )
        return;
      await new Promise((done) => setTimeout(done, 50));
    }
    assert.fail(
      "INT96 deep link must bring its heading below the sticky header",
    );
  };
  const assertLocale = (state, language) => {
    const canonical = `https://getbamboo.app/${language}/docs/`;
    assert.equal(state.lang, language === "en" ? "en" : "zh-CN");
    assert(
      state.heading.includes(
        language === "en" ? "first SQL query" : "第一条 SQL",
      ),
    );
    for (const key of ["canonical", "ogURL", "schemaURL"])
      assert.equal(state[key], canonical, key);
    assert.equal(state.ogTitle, state.title);
    assert.equal(state.twitterTitle, state.title);
    assert.equal(state.overflow, false, "No document-wide scrolling");
    assert.equal(state.sectionCount, 3);
    assert.equal(state.home, `/${language}/`);
    assert.equal(state.docsLink, `/${language}/docs/`);
    assert.deepEqual(state.alternates, ["/en/docs/", "/zh/docs/", "/docs/"]);
    assert.equal(state.language, language);
    assert.deepEqual(state.languageOptions, ["en", "zh"]);
    assert.equal(state.footerLanguageLinks, 0);
    assert.deepEqual(state.missingAnchors, []);
    assert.equal(state.packages.length, 5);
    assert(state.copy.every((t) => t.trim() && t !== "undefined"));
    if (language === "en")
      assert(!state.copy.some((t) => /[\u4e00-\u9fff]/.test(t)));
  };
  const results = [];
  for (const width of [320, 1280]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const language of ["en", "zh"]) {
      for (const disabled of [true, false]) {
        await send("Emulation.setScriptExecutionDisabled", { value: disabled });
        try {
          await navigate(`/${language}/docs/`, !disabled);
          assertLocale(await snapshot(), language);
          if (!disabled) {
            for (const theme of ["light", "dark"]) {
              await evaluate(
                `document.documentElement.dataset.theme = '${theme}'`,
              );
              assertLocale(await snapshot(), language);
              await screenshot(`docs-${language}-${width}-${theme}`);
            }
            if (width === 320) {
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
            await evaluate(
              "document.querySelector('.docs-toc a[href=\"#int96\"]').click()",
            );
            assert.equal(await evaluate("document.activeElement.id"), "int96");
            await assertAnchorVisible();
            const other = language === "en" ? "zh" : "en";
            await evaluate(
              `(() => {const select=document.getElementById('language-select'); select.value='${other}'; select.dispatchEvent(new Event('change'));})()`,
            );
            assertLocale(await snapshot(), other);
            assert.equal(await evaluate("location.hash"), "#int96");
            await assertAnchorVisible();
            await navigate(`/${other}/docs/?check=deep-link#int96`);
            assertLocale(await snapshot(), other);
            await assertAnchorVisible();
            await screenshot(`docs-int96-${other}-${width}`);
            await evaluate("document.getElementById('theme-toggle').click()");
            const chosen = await evaluate(
              "document.documentElement.dataset.theme",
            );
            await navigate(`/${other}/docs/?reload=theme`);
            assert.equal(
              await evaluate("document.documentElement.dataset.theme"),
              chosen,
            );
            await evaluate(
              "document.querySelector('footer').scrollIntoView({behavior: 'instant', block: 'end'})",
            );
            await screenshot(`docs-footer-${other}-${width}`);
          }
          results.push({ width, language, javascript: !disabled });
        } finally {
          await send("Emulation.setScriptExecutionDisabled", { value: false });
        }
      }
    }
  }
  return results;
}
