# Bamboo website

The official website lives in the Bamboo repository but builds and deploys independently of the App:

```text
website/
  index.html             # Semantic markup and initial Chinese content
  styles.css             # App-matching light/dark theme
  site.js                # English/Chinese copy and interactions
  assets/                # Original screenshots and artwork, named by content hash
  scripts/               # Website build, browser checks and capture helpers
  _headers               # Cloudflare Pages security and cache headers
  *-provenance.json      # Capture and benchmark evidence; not deployed
  package.json           # Deployment CLI only; separate from App dependencies
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

Use a **Direct Upload** Pages project with production branch `main`. GitHub Actions owns deployment; do not also enable Pages Git builds, which would duplicate deployments. The production domain is configured separately in Pages after the project is created. No site has been published by preparing these files.

One-time setup:

1. Install the locked CLI with `npm ci --prefix website` (App dependencies are separate).
2. Create a Pages project in the intended Cloudflare account, or reuse an existing Direct Upload project whose production branch is `main`. If using the CLI, authenticate locally with `website/node_modules/.bin/wrangler login`, then run `website/node_modules/.bin/wrangler pages project create <project-name> --production-branch main`. Replace `<project-name>` with the actual chosen name.
3. Create a Cloudflare API token with **Account → Cloudflare Pages → Edit**, scoped to that account. R2 access keys do not grant Pages deployment access.
4. In GitHub repository Settings → Environments, create `cloudflare-pages`. Add secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and variable `CLOUDFLARE_PAGES_PROJECT` containing the project name. Limit deployment branches to `main`; reviewers are optional. Do not put token values in source files, workflow inputs or chat.
5. Merge the site changes into `main`. The `Website` workflow builds and checks the site before production deployment. The workflow can also be run manually from `main`.
6. Configure the chosen custom domain in that Pages project and verify both language choices, download links and Terms/Privacy on its HTTPS URL.

`.github/workflows/website.yml` runs only for website/build-check/workflow changes (or a manual run). PRs, including forks, only build and verify; they never receive Cloudflare credentials or deploy. The production job runs only on `main`, uses a locked Wrangler version and its own concurrency group, and fails clearly if account/project/token configuration is missing. Deployment uploads `build/website/`, not the repository or App. Successful checks and a standalone review copy are available as CI artifacts. The regular App CI also verifies the site; App release/tag workflows are unchanged.

All public assets have content-hashed filenames and long-lived immutable caching. HTML revalidates. The Pages CSP permits same-origin scripts and images, blocks network calls from page scripts, and prevents framing; local HTTP checks exercise these headers. The standalone review copy is for direct opening and does not inherit HTTP headers.

Official references: [Direct Upload with CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/), [Wrangler Pages commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/), [Pages headers](https://developers.cloudflare.com/pages/configuration/headers/).

The download buttons currently point at the verified `v0.1.0` Apple Silicon DMG. When a later release changes the supported architecture, minimum OS, signing status or asset name, update the page and guide together. The version-history link always opens GitHub Releases.

## Verify changes

Run `npm run test:website` from the repository root (requires Node 22+ and Chrome; set `BAMBOO_CHROME` to override the executable). It exercises the actual page at five viewport/theme combinations, verifies its screenshot appearance, navigation and mobile download behavior, rejects external runtime requests and private paths, and writes evidence to ignored `artifacts/website/`. CI runs the same check with the existing visual regressions.

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
