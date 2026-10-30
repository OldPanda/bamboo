/** Render the site's constrained leaf-text translation markup without a runtime dependency. */
import { pageMetadata, siteOrigin, translations } from "../content.js";

const escapeHTML = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

function translated(key, language) {
  const value = translations[key]?.[language];
  if (typeof value !== "string" || !value.trim())
    throw Error(`Missing ${language} translation: ${key}`);
  return escapeHTML(value);
}

/** Emit complete translated HTML; fail if a translation would replace nested markup. */
export function renderPage(template, language, path) {
  const meta = pageMetadata[language];
  const url = `${siteOrigin}${path}`;
  const lang = language === "en" ? "en" : "zh-CN";
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${siteOrigin}/#website`,
        url: `${siteOrigin}/`,
        name: "Bamboo",
        inLanguage: ["en", "zh-CN"],
      },
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: meta.title,
        description: meta.description,
        inLanguage: lang,
        isPartOf: { "@id": `${siteOrigin}/#website` },
        about: { "@id": `${siteOrigin}/#software` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${siteOrigin}/#software`,
        name: "Bamboo",
        url: `${siteOrigin}/`,
        applicationCategory: "DeveloperApplication",
        isAccessibleForFree: true,
        license: "https://github.com/OldPanda/bamboo/blob/main/LICENSE",
      },
    ],
  };
  const tags = [
    `<title>${escapeHTML(meta.title)}</title>`,
    `<meta name="description" content="${escapeHTML(meta.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    ...[
      ["en", "/en/"],
      ["zh-CN", "/zh/"],
      ["x-default", "/"],
    ].map(
      ([code, route]) =>
        `<link rel="alternate" hreflang="${code}" href="${siteOrigin}${route}" />`,
    ),
    ...Object.entries({
      "og:type": "website",
      "og:site_name": "Bamboo",
      "og:title": meta.title,
      "og:description": meta.description,
      "og:url": url,
      "og:locale": meta.locale,
      "og:locale:alternate":
        pageMetadata[language === "en" ? "zh" : "en"].locale,
      "og:image": meta.image,
      "og:image:alt": meta.imageAlt,
      "og:image:type": "image/png",
      "og:image:width": "2560",
      "og:image:height": "1576",
    }).map(
      ([property, value]) =>
        `<meta property="${property}" content="${escapeHTML(value)}" />`,
    ),
    ...Object.entries({
      "twitter:card": "summary_large_image",
      "twitter:title": meta.title,
      "twitter:description": meta.description,
      "twitter:image": meta.image,
      "twitter:image:alt": meta.imageAlt,
    }).map(
      ([name, value]) =>
        `<meta name="${name}" content="${escapeHTML(value)}" />`,
    ),
    `<script id="structured-data" type="application/ld+json">${JSON.stringify(graph).replaceAll("<", "\\u003c")}</script>`,
  ];
  let html = template
    .replace('<html lang="zh-CN">', `<html lang="${lang}">`)
    .replace("<!-- SEO_HEAD -->", tags.join("\n    "));
  let count = 0;
  html = html.replace(
    /(<([a-z][a-z0-9]*)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)([^<]*)(<\/\2\s*>)/g,
    (_, open, _tag, key, _text, close) => {
      count++;
      return open + translated(key, language) + close;
    },
  );
  if (count !== [...template.matchAll(/\bdata-i18n="/g)].length)
    throw Error(
      "Translations must be leaf text nodes; nested or unsupported markup found",
    );
  html = html.replace(
    /<[a-z][^>]*\bdata-i18n-(?:aria-label|alt|title)="[^>]*>/g,
    (tag) => {
      for (const name of ["aria-label", "alt", "title"]) {
        const key = tag.match(new RegExp(`data-i18n-${name}="([^"]+)"`))?.[1];
        if (!key) continue;
        const attr = new RegExp(`(\\s${name}=")[^"]*(")`);
        if (!attr.test(tag))
          throw Error(`Missing translated attribute: ${name}`);
        tag = tag.replace(
          attr,
          (_, start, end) => start + translated(key, language) + end,
        );
      }
      return tag;
    },
  );
  html = html.replace(
    `<option value="${language}">`,
    `<option value="${language}" selected>`,
  );
  if (language === "en") {
    html = html
      .replaceAll(
        "bamboo-zh-light-2a213558990ae26a.png",
        "bamboo-en-light-f277933fc4b586f1.png",
      )
      .replaceAll(
        "bamboo-zh-dark-721eb8c4e8b4230f.png",
        "bamboo-en-dark-2560126fc2435be5.png",
      )
      .replaceAll(
        "macos-security-zh-f1d34417f67cbfa7.png",
        "macos-security-en-3048b460a1e0d943.png",
      )
      .replaceAll('height="1196"', 'height="1226"')
      .replaceAll(
        "https://support.apple.com/zh-cn/102445",
        "https://support.apple.com/en-us/102445",
      );
  }
  return html;
}

/** Canonical locale pages only; no query variants, dialog fragments or invented dates. */
export function sitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["/", "/en/", "/zh/"].map((path) => `  <url><loc>${siteOrigin}${path}</loc></url>`).join("\n")}\n</urlset>\n`;
}
