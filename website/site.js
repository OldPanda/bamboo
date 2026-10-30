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
    updateDownloads();
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

  const catalog = /* DOWNLOAD_CATALOG */ null;
  const releasesURL = "https://github.com/OldPanda/bamboo/releases";
  const platformNames = { macos: "macOS", windows: "Windows", linux: "Linux" };
  const platformIcons = { macos: "apple", windows: "windows", linux: "linux" };
  // iPadOS can advertise itself as a Mac; mobile systems must not auto-select a desktop build.
  const detectPlatform = () => {
    const ua = navigator.userAgent;
    const platform =
      navigator.userAgentData?.platform || navigator.platform || "";
    if (
      navigator.userAgentData?.mobile ||
      /Android|iPhone|iPad|iPod|CrOS/i.test(ua) ||
      (/Mac/i.test(platform) && navigator.maxTouchPoints > 1)
    )
      return "";
    if (/Windows|Win32|Win64/i.test(platform + " " + ua)) return "windows";
    if (/Mac/i.test(platform + " " + ua)) return "macos";
    if (/Linux/i.test(platform + " " + ua)) return "linux";
    return "";
  };
  let selectedPlatform = detectPlatform();
  const selectors = [...document.querySelectorAll("[data-platform-select]")];
  const updateDownloads = () => {
    const name = platformNames[selectedPlatform];
    const asset = catalog?.platforms[selectedPlatform];
    const label = !name
      ? ui("选择下载平台", "Choose a platform")
      : asset
        ? ui(`免费下载 ${name} 版`, `Download for ${name}`)
        : ui(`查看 ${name} 发布状态`, `${name} release status`);
    document.querySelectorAll(".download-link").forEach((link) => {
      link.href = !name ? "#platform-select" : asset?.url || releasesURL;
      link.querySelector("[data-download-label]").textContent = label;
      link
        .querySelector("[data-download-action-icon]")
        .setAttribute("href", asset ? "#i-down" : "#i-arrow");
      link
        .querySelector("[data-platform-icon]")
        .setAttribute(
          "href",
          `#i-${platformIcons[selectedPlatform] || "down"}`,
        );
    });
    selectors.forEach((select) => {
      select.value = selectedPlatform;
    });
    const requirements = {
      macos: ui(
        "Apple Silicon · macOS 12+ · 不支持 Intel Mac",
        "Apple Silicon · macOS 12+ · Intel Macs not supported",
      ),
      windows: "Windows 10/11 · x64 · WebView2",
      linux: "Ubuntu 22.04 / Debian · x64 · GTK 3 / WebKitGTK 4.1",
    };
    const unavailable = name
      ? ui(
          `${name} 安装包尚未正式发布。可前往 GitHub Releases 查看发布状态；以下为安装前提。`,
          `No published ${name} installer yet. Check GitHub Releases for availability; installation requirements are below.`,
        )
      : "";
    document.getElementById("download-status").textContent = asset
      ? `${catalog.tag} · ${requirements[selectedPlatform]}`
      : unavailable;
    document.getElementById("install-availability").textContent = !name
      ? ui(
          "请先选择目标电脑的系统。",
          "Choose the target computer’s platform first.",
        )
      : asset
        ? `${catalog.tag} · ${requirements[selectedPlatform]}`
        : unavailable;
    document.getElementById("download-hint").hidden = Boolean(name);
    document.querySelectorAll("[data-install-platform]").forEach((panel) => {
      panel.hidden = panel.dataset.installPlatform !== selectedPlatform;
    });
    document.querySelectorAll("[data-macos-download]").forEach((link) => {
      link.href = catalog?.platforms.macos?.url || releasesURL;
      link.querySelector("span").textContent = catalog?.platforms.macos
        ? translations.t10[language]
        : ui("查看 macOS 发布状态", "macOS release status");
    });
    document.querySelector("#platform-availability").textContent =
      Object.entries(platformNames)
        .map(
          ([key, title]) =>
            `${title}: ${catalog?.platforms[key] ? ui("可下载", "available") : ui("尚未发布", "not published")}`,
        )
        .join(" · ");
  };
  selectors.forEach((select) =>
    select.addEventListener("change", () => {
      selectedPlatform = Object.hasOwn(platformNames, select.value)
        ? select.value
        : "";
      updateDownloads();
    }),
  );
  document.querySelectorAll(".download-link").forEach((link) =>
    link.addEventListener("click", (event) => {
      if (!selectedPlatform) {
        event.preventDefault();
        selectors[0].focus();
        selectors[0].scrollIntoView({ block: "center", behavior: "instant" });
      }
    }),
  );
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
})();
