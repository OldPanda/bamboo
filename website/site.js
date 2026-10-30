import { translations, pageMetadata, siteOrigin } from "./content.js";

(() => {
  "use strict";
  const macOSScreenshots = {
    zh: {
      src: "assets/macos-security-zh-f1d34417f67cbfa7.png",
      width: 1430,
      height: 1196,
    },
    en: {
      src: "assets/macos-security-en-3048b460a1e0d943.png",
      width: 1430,
      height: 1226,
    },
  };
  const nativeScreenshots = {
    zh: {
      light: "assets/bamboo-zh-light-2a213558990ae26a.png",
      dark: "assets/bamboo-zh-dark-721eb8c4e8b4230f.png",
    },
    en: {
      light: "assets/bamboo-en-light-f277933fc4b586f1.png",
      dark: "assets/bamboo-en-dark-2560126fc2435be5.png",
    },
  };
  const languageSelect = document.getElementById("language-select");
  let language = "zh";
  const ui = (zh, en) => (language === "en" ? en : zh);
  const phoneHint = () =>
    ui(
      "Bamboo 是 Mac 应用。请在 Apple Silicon Mac 上打开本页下载安装；手机上也可以先阅读下方的安装指引。",
      "Bamboo is a Mac app. Open this page on an Apple Silicon Mac to download and install it. You can read the installation guide on your phone.",
    );
  const setLanguage = (next, path = `/${next === "en" ? "en" : "zh"}/`) => {
    language = next === "en" ? "en" : "zh";
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    languageSelect.value = language;
    const permissionImage = document.querySelector(
      ".permission-screenshot img",
    );
    const permissionSource = macOSScreenshots[language];
    permissionImage.src = permissionSource.src;
    permissionImage.width = permissionSource.width;
    permissionImage.height = permissionSource.height;
    document.querySelectorAll("[data-apple-support]").forEach((link) => {
      link.href =
        language === "en"
          ? "https://support.apple.com/en-us/102445"
          : "https://support.apple.com/zh-cn/102445";
    });
    document.querySelectorAll(".native-shot").forEach((image) => {
      const mode = image.classList.contains("native-shot-dark")
        ? "dark"
        : "light";
      image.src = nativeScreenshots[language][mode];
    });
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = translations[node.dataset.i18n][language];
    });
    for (const name of ["aria-label", "alt", "title"]) {
      document.querySelectorAll(`[data-i18n-${name}]`).forEach((node) => {
        node.setAttribute(
          name,
          translations[node.getAttribute(`data-i18n-${name}`)][language],
        );
      });
    }
    const { title, description, locale, image, imageAlt } =
      pageMetadata[language];
    const url = `${siteOrigin}${path}`;
    document.title = title;
    for (const [selector, content] of [
      ['meta[name="description"]', description],
      ['meta[property="og:title"]', title],
      ['meta[property="og:description"]', description],
      ['meta[property="og:url"]', url],
      ['meta[property="og:locale"]', locale],
      [
        'meta[property="og:locale:alternate"]',
        pageMetadata[language === "en" ? "zh" : "en"].locale,
      ],
      ['meta[property="og:image"]', image],
      ['meta[property="og:image:alt"]', imageAlt],
      ['meta[name="twitter:title"]', title],
      ['meta[name="twitter:description"]', description],
      ['meta[name="twitter:image"]', image],
      ['meta[name="twitter:image:alt"]', imageAlt],
    ])
      document.querySelector(selector).content = content;
    document.querySelector('link[rel="canonical"]').href = url;
    const schemaNode = document.getElementById("structured-data");
    const schema = JSON.parse(schemaNode.textContent);
    const page = schema["@graph"].find((item) => item["@type"] === "WebPage");
    Object.assign(page, {
      "@id": `${url}#webpage`,
      url,
      name: title,
      description,
      inLanguage: document.documentElement.lang,
    });
    schemaNode.textContent = JSON.stringify(schema);
    updateThemeLabel();
    menuButton.setAttribute(
      "aria-label",
      menu.hidden
        ? ui("展开导航", "Open navigation")
        : ui("收起导航", "Close navigation"),
    );
    if (!hint.hidden) hint.textContent = phoneHint();
  };
  const legalDialogs = [...document.querySelectorAll(".legal-dialog")];
  const syncLegalRoute = () => {
    for (const dialog of legalDialogs) {
      if (location.hash === `#${dialog.id}`) {
        if (!dialog.open) dialog.showModal();
      } else if (dialog.open) dialog.close();
    }
  };
  for (const dialog of legalDialogs) {
    dialog
      .querySelector("[data-close-legal]")
      .addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      if (location.hash === `#${dialog.id}`) {
        history.replaceState(null, "", location.pathname + location.search);
      }
    });
  }
  window.addEventListener("hashchange", syncLegalRoute);
  syncLegalRoute();
  const root = document.documentElement;
  const themeButton = document.getElementById("theme-toggle");
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const currentDark = () =>
    root.dataset.theme ? root.dataset.theme === "dark" : media.matches;
  const updateThemeLabel = () => {
    themeButton
      .querySelector("use")
      .setAttribute("href", currentDark() ? "#i-sun" : "#i-moon");
    themeButton.setAttribute(
      "aria-label",
      currentDark()
        ? ui("切换至浅色主题", "Switch to light theme")
        : ui("切换至深色主题", "Switch to dark theme"),
    );
    themeButton.setAttribute("aria-pressed", String(currentDark()));
  };
  try {
    const saved = localStorage.getItem("bamboo-site-theme");
    if (["light", "dark"].includes(saved)) root.dataset.theme = saved;
  } catch {
    /* Browsing preferences are optional. */
  }
  updateThemeLabel();
  media.addEventListener("change", updateThemeLabel);
  themeButton.addEventListener("click", () => {
    root.dataset.theme = currentDark() ? "light" : "dark";
    try {
      localStorage.setItem("bamboo-site-theme", root.dataset.theme);
    } catch {
      /* The page also works without storage. */
    }
    updateThemeLabel();
  });
  const menuButton = document.getElementById("menu-toggle");
  const menu = document.getElementById("mobile-nav");
  const closeMenu = () => {
    menu.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", ui("展开导航", "Open navigation"));
  };
  menuButton.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    menuButton.setAttribute("aria-expanded", String(!menu.hidden));
    menuButton.setAttribute(
      "aria-label",
      menu.hidden
        ? ui("展开导航", "Open navigation")
        : ui("收起导航", "Close navigation"),
    );
  });
  menu
    .querySelectorAll("a")
    .forEach((link) => link.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      closeMenu();
      menuButton.focus();
    }
  });
  const menuMedia = window.matchMedia("(min-width: 700px)");
  menuMedia.addEventListener("change", (event) => {
    if (event.matches) closeMenu();
  });

  const hint = document.getElementById("download-hint");
  const applyPreferredLanguage = () => {
    let preferredLanguage = navigator.language.toLowerCase().startsWith("zh")
      ? "zh"
      : "en";
    try {
      const savedLanguage = localStorage.getItem("bamboo-site-language");
      if (["zh", "en"].includes(savedLanguage))
        preferredLanguage = savedLanguage;
    } catch {
      /* Language preferences remain optional. */
    }
    const routeLanguage = location.pathname.match(/^\/(en|zh)\/?$/)?.[1];
    if (routeLanguage) preferredLanguage = routeLanguage;
    const requestedLanguage = new URLSearchParams(location.search).get("lang");
    if (["zh", "en"].includes(requestedLanguage))
      preferredLanguage = requestedLanguage;
    setLanguage(
      preferredLanguage,
      !routeLanguage && !["zh", "en"].includes(requestedLanguage)
        ? "/"
        : undefined,
    );
  };
  applyPreferredLanguage();
  window.addEventListener("popstate", applyPreferredLanguage);
  languageSelect.addEventListener("change", () => {
    setLanguage(languageSelect.value);
    try {
      localStorage.setItem("bamboo-site-language", language);
    } catch {
      /* The page works without persistent storage. */
    }
    // Keep shared URLs, legal hashes and unrelated query parameters intact.
    const url = new URL(location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", language);
    }
    if (location.protocol !== "file:") url.pathname = `/${language}/`;
    history.replaceState(null, "", url);
  });
  document.querySelectorAll(".download-link").forEach((link) =>
    link.addEventListener("click", (event) => {
      if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        event.preventDefault();
        hint.textContent = phoneHint();
        hint.hidden = false;
        hint.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
          block: "center",
        });
      }
    }),
  );
})();
