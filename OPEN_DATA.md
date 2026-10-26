# Unified data-source entry

The sidebar and welcome screen each use one **Open data** action. The source chooser separates **This Mac** (Open file / Open folder) from **Cloud storage** (Cloudflare R2). Future implemented providers belong in the cloud panel, never as additional sidebar buttons. No unsupported provider is advertised.

The local file shortcut remains **⌘ + O**, and Parquet drag/drop still opens directly. Tabs support arrows, Home/End and Tab; Escape dismisses the native dialog and restores focus. Local actions dismiss the chooser before invoking the native picker. R2 has a Back action to return to cloud choices, clears secret fields when leaving, and keeps copy/paste shortcuts available. Choosing a source does not replace existing workspaces or documents. The query layout and read-only engine are preserved.

Validation: 29 frontend scenarios, including local cancellation, keyboard navigation, focus restoration, R2 Back, credential clearing, paste and drag/drop boundaries. Actual WKWebView/IPC checks exercise the chooser, cloud navigation and back flow, alongside the existing R2 lifecycle and local regressions. Screenshots cover the actual app in light/dark modes at a narrow desktop width. Native OS picker clicks and actual Finder gestures remain manual acceptance; mocked bridge tests do not establish those interactions.

Hallmark static review: the added controls use existing palette/spacing tokens. One pre-existing gate 39a remains: busy controls deliberately retain their appearance to honor the user's no-flicker requirement; the actual disabled attribute and not-allowed cursor remain active. Two white-palette Reflex findings retain the explicit Stock Analysis color direction. Browser render could not run because its puppeteer-core driver is absent; native captures are the visual evidence, not a claimed browser-render pass. Raw review output is retained with the screenshots.

Rebuild fix: previous app license copies inherited read-only module-cache modes. The build script now makes only generated app-license copies writable before replacing them, then signs the final bundle.

Final verification passed: Go combined 95.26% (1487/1561), ordinary Go tests 87.00% (1358/1561), frontend statements 99.14%, branches 95.94%, functions/lines 100%. The 19 R2 native checks use a synthetic S3 service; signature, TypeScript, go vet and dependency scans passed. Evidence and mobile-readable captures: `artifacts/open-data/Bamboo-open-data.html`.
