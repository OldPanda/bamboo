# Bamboo website

The official website lives in the Bamboo repository but builds and deploys independently of the App:

```text
website/
  index.html             # Semantic markup and initial Chinese content
  styles.css             # App-matching light/dark theme
  site.js                # English/Chinese copy and interactions
  assets/                # Original screenshots and artwork, named by content hash
  scripts/               # Website build, browser checks and capture helpers
  tests/                 # Isolated build regression tests
  _headers               # Cloudflare Pages security and cache headers
  *-provenance.json      # Capture and benchmark evidence; not deployed
  package.json           # Dependency-free website commands
```

The site uses system fonts with no external runtime dependencies, analytics or build framework. Source images stay as separate files for review and caching. The build emits only public HTML/CSS/JS/images and `_headers`; maintenance docs, deployment dependencies and provenance are excluded.

## Build and preview

All website implementation, assets, build/check helpers and maintenance docs belong under `website/`. GitHub requires workflow definitions in `.github/workflows/`; repository-level command and lint references are infrastructure exceptions. Future website changes should preserve this boundary.

From the repository root with Node 22+:

```sh
npm --prefix website run build
npm --prefix website test
# Optional self-contained review copy, including inline CSS/JS/images:
node website/scripts/website-build.mjs --standalone
```

The deployable directory is `build/website/`; the optional single-file preview is `build/bamboo-website-preview.html`. `build/` stays ignored. To browse the deployable version locally, run `python3 -m http.server 8080 --directory build/website` and open `http://localhost:8080`. The browser smoke test runs its own private HTTP server with the actual Pages headers.

The site includes bilingual capabilities, real native App screenshots, the [first-install guide](../docs/first-install.md), FAQ, Issues/Discussions links, Terms/Privacy and creator attribution.

## Cloudflare Pages deployment

Use Cloudflare Pages **Git integration**, connected to `OldPanda/bamboo`. The website stays in this repository under `website/`; no separate repository or CI deployment token is required. GitHub Actions runs website tests and produces review artifacts. Cloudflare builds and deploys the website independently when matching changes reach `main`; it does not wait for GitHub Actions, so require the website check before merging to `main`.

The Pages Git project is `bamboo`, with assigned address `bamboo-dhy.pages.dev`. Production Git builds and branch previews are enabled. Cloudflare posts preview links on pull requests; website changes pushed to a PR branch update its preview. The first production deployment will occur after the website changes reach `main`. No custom domain is configured yet.

The project uses:

| Setting                                        | Value                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| Repository                                     | `OldPanda/bamboo`                                                       |
| Production branch                              | `main`                                                                  |
| Framework preset                               | None                                                                    |
| Root directory                                 | Repository root (blank)                                                 |
| Build command                                  | `npm --prefix website run test:build && npm --prefix website run build` |
| Build output directory                         | `build/website`                                                         |
| Environment variables (production and preview) | `NODE_VERSION=22.23.4`, `SKIP_DEPENDENCY_INSTALL=1`                     |
| Build watch paths                              | `website/*`, `.github/workflows/website.yml`                            |

The build and its Node tests need no installed dependencies. Skipping automatic installation avoids installing or building the desktop App in Pages. Browser checks run in GitHub Actions, where Chrome is available. Preview builds use the same website path filters and build command as production; they do not publish to the production address. Configure the production custom domain separately after the site is ready.

The `Website` GitHub workflow validates website and workflow changes on pull requests and `main`, with a manual run option. It never receives Cloudflare credentials or publishes the site. The regular App CI also runs the complete website suite; App release/tag workflows are unchanged.

All public assets have content-hashed filenames and long-lived immutable caching. HTML revalidates. The Pages CSP permits same-origin scripts and images, blocks network calls from page scripts, and prevents framing; local HTTP checks exercise these headers. The standalone review copy is for direct opening and does not inherit HTTP headers.

Official references: [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/), [Build environment](https://developers.cloudflare.com/pages/configuration/build-image/), [Build watch paths](https://developers.cloudflare.com/pages/configuration/build-watch-paths/), [Pages headers](https://developers.cloudflare.com/pages/configuration/headers/).

The download buttons currently point at the verified `v0.1.0` Apple Silicon DMG. When a later release changes the supported architecture, minimum OS, signing status or asset name, update the page and guide together. The version-history link always opens GitHub Releases.

## Verify changes

`npm --prefix website run test:build` runs dependency-free Node tests in disposable directories: public-file allowlisting, stale-output cleanup, asset hashes and references, reproducible builds, self-contained preview assets, and rejection of modified or unexpected images. These tests never modify the source assets or use cloud credentials.

Run `npm run test:website` from the repository root (requires Node 22+ and Chrome; set `BAMBOO_CHROME` to override the executable). It first runs the isolated build tests, then exercises the actual page at five viewport/theme combinations, verifies its screenshot appearance, navigation and mobile download behavior, rejects external runtime requests and private paths, and writes evidence to ignored `artifacts/website/`. It also checks shared language/legal URLs, theme persistence, invalid preference fallback, unavailable browser storage, and the header icon order/style. Both website and App CI run the complete suite.

- Format `website/index.html`, this document, and the installation guide with the repository's Prettier version.
- Open the page at desktop and mobile widths, including 320 px, in light and dark appearances.
- Check the mobile navigation, keyboard focus, FAQ, installation disclosure, theme preference and native screenshot theme switching.
- Confirm the download, Apple support, Issues, Discussions and `https://x.com/OldPanda` destinations.
- Keep synthetic examples visibly identified. Preview timings are not a guarantee for full-file queries or real cloud latency.
- Do not publish private paths, credentials, real user datasets, fabricated testimonials or unsupported platform claims.

## Visual identity

Keep the website aligned with `frontend/src/tokens.css`: the App blue accent, neutral light/dark surfaces, system typography and 4 px action-button corners. Product branding takes priority over the original reference website palette.

## Real product screenshots

The hero embeds language-specific actual `Window.CapturePage` output from the native Bamboo App, with its production frontend and real DuckDB/IPC. It is not a browser mockup or a retouched screenshot. The App opened a generated 240-row `orders.parquet` in an isolated temporary directory, ran the displayed read-only SQL, and returned 12 rows. No personal files or saved cloud connections were used.

`website/screenshot-provenance.json` records the source revision, fixture hash, query, result and original PNG hashes. The opt-in developer script `website/scripts/website-capture-smoke.js` prepares the real window through existing controls; the normal native harness captures both themes. Capture logs and source PNGs remain under ignored `artifacts/website/native-app/`. Retake real screenshots after UI changes instead of recreating the App in HTML.

## Performance table

`performance-provenance.json` records the displayed historical local benchmark values: engine metadata loading plus the first 100 rows, median of three processes per file size, without flushing filesystem caches. These measurements exclude native IPC and UI paint. They are observations rather than current-release speed guarantees. Cloud cells contain live observations from this Apple Silicon Mac Studio using the production engine and saved connections (S3 us-west-2, R2 auto). S3 and R2 each display the median of five randomized sequential rounds per file (20 successful observations per provider), using the same shuffle seed and timing boundary. These are separate sessions, not simultaneous provider comparisons. All samples, ranges, randomized orders and the seed are recorded in performance-provenance.json. Earlier single-run values remain in historical liveMeasurements evidence; displayed s3Milliseconds and r2Milliseconds values come from the five-round medians. Each fresh process opens metadata and reads the first 100 rows, including connection setup; network and caches were not controlled. Both providers have results for all four uploaded files. Raw sanitized observations are retained in ignored artifacts/website/live-cloud-results, with published values and measurement boundaries in performance-provenance.json. Cloud values are seconds; local historical values are milliseconds. Local synthetic S3 protocol fixtures are not cloud measurements.

## macOS installation screenshot

The installation disclosure embeds the unmodified Chinese or English macOS Privacy & Security screenshot from Apple's corresponding support article, following the website language. The caption credits Apple and explains that its “示例 App” represents Bamboo in these instructions. `macos-screenshot-provenance.json` records the original image URL, dimensions and SHA-256. Keep this distinct from Bamboo's native product captures; do not redraw system settings or change the application name inside the screenshot.

## Terms and privacy

Footer links open the Chinese Terms and Privacy documents in accessible native dialogs. `#terms` and `#privacy` also open the corresponding document on direct entry; Escape or the Close button dismisses it. Both documents are included in the site markup and follow its light/dark theme. Their effective date is visible. Update the privacy text alongside any changes to telemetry, storage, hosting, cloud access or update traffic, and preserve the software rights granted by the MIT license.

## Languages

The header's translation icon opens a native language dropdown for Chinese and English, with keyboard focus and an accessible language label. Navigation, product copy, installation steps, FAQ, benchmark labels, accessibility text, document metadata and both legal documents are translated through the dictionary in `site.js`. Actual screenshots remain unmodified; native App screenshots switch to matching English or Chinese captures and follow the selected light/dark appearance. The first visit follows the browser language (Chinese for `zh`, English otherwise), with explicit choices remembered in `bamboo-site-language` localStorage. `?lang=zh` or `?lang=en` takes priority for shared links; legal hashes can be combined with these links. Language switching preserves the existing page controls and open documents. Keep both dictionary entries updated when editing copy. Browser verification exercises both languages at every tested viewport/theme and checks restoration after reload.

The SQL feature card shows a text-based SQL example with theme-aware keyword and literal highlighting. It is an illustrative code sample, not an App screenshot or an interactive editor. The main product image remains an actual native App capture.

The English native captures are recorded under `localizedCaptures.en` in the screenshot provenance. They use the same generated fixture and real SQL result as the Chinese captures, in a separate temporary English configuration. Website verification compares all displayed native screenshot bytes against the correct language/theme hashes after each language switch.
