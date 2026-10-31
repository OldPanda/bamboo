# Bamboo website

The official website lives in the Bamboo repository but builds and deploys independently of the App:

```text
website/
  index.html             # Shared semantic HTML template
  styles.css             # App-matching light/dark theme
  content.js             # Shared English/Chinese copy and metadata
  site.js                # Browser interactions and language switching
  downloads.json         # Verified stable-release installer catalog

  assets/                # Original screenshots and artwork, named by content hash
  scripts/               # Website build, browser checks and capture helpers
  tests/                 # Isolated build regression tests
  _headers               # Cloudflare Pages security and cache headers
  *-provenance.json      # Capture and benchmark evidence; not deployed
  package.json           # Dependency-free website commands
```

The site uses system fonts with no external runtime dependencies, analytics or build framework. Source images stay as separate files for review and caching. The build emits only public HTML/CSS/JS/images, `robots.txt`, `sitemap.xml` and `_headers`; maintenance docs, deployment dependencies and provenance are excluded. Use the build output when previewing: `index.html` is a template, and the builder bundles the shared copy into the browser entry.

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

The Pages Git project is `bamboo`, with assigned address `bamboo-dhy.pages.dev`. Production Git builds and branch previews are enabled. Cloudflare posts preview links on pull requests; website changes pushed to a PR branch update its preview. The production custom domain is [getbamboo.app](https://getbamboo.app/). SEO URLs always use this domain, including in branch previews.

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

The build and its Node tests need no installed dependencies. Skipping automatic installation avoids installing or building the desktop App in Pages. Browser checks run in GitHub Actions, where Chrome is available. Preview builds use the same website path filters and build command as production; they do not publish to the production address. This build does not change Cloudflare project or domain settings.

The `Website` GitHub workflow validates website and workflow changes on pull requests and `main`, with a manual run option. It never receives Cloudflare credentials or publishes the site. The regular App CI also runs the complete website suite. The separate release catalog workflow below connects successful App releases to this existing deployment path.

All public assets have content-hashed filenames and long-lived immutable caching. HTML revalidates. The Pages CSP permits same-origin scripts and images, blocks network calls from page scripts, and prevents framing; local HTTP checks exercise these headers. The standalone review copy is for direct opening and does not inherit HTTP headers.

Official references: [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/), [Build environment](https://developers.cloudflare.com/pages/configuration/build-image/), [Build watch paths](https://developers.cloudflare.com/pages/configuration/build-watch-paths/), [Pages headers](https://developers.cloudflare.com/pages/configuration/headers/).

## Platform downloads

The hero download button follows the browser’s desktop OS. A published installer links to the real release asset; an unavailable platform links to its bottom download card. Phone, iPad desktop-mode, ChromeOS and unknown browsers link to all downloads. Small links under the button jump to the other platform cards and move keyboard focus there. Detection does not prove CPU compatibility, so architecture and minimum OS remain visible. The bottom section lists macOS Apple Silicon DMG, Windows x64 EXE/portable ZIP and Linux x64 DEB/portable tar.gz separately, including unpublished packages. The installation guide retains its own selector; changing it never changes the hero’s detected platform. Guide choices survive language and theme changes on the current page.

`downloads.json` is a verified snapshot of the **newest successfully verified stable release**, embedded in the hashed script at build time. Release v0.1.2 provides all five packages: Apple Silicon DMG, Windows x64 setup EXE and ZIP, and Linux x64 DEB and tar.gz. The catalog records their verified public URLs and sizes; signing limitations and installation requirements remain visible. CI preview artifacts are not treated as public stable installers. Drafts, prereleases, missing assets, unsupported names and unexpected URLs never produce download buttons.

### Automatic release synchronization

[Release website sync](../.github/workflows/release-website.yml) consumes successful
`Release` completions using trusted `main` code. Before proposing a catalog it
requires the exact `refs/tags/<version>` (including annotated tags) to resolve to
the successful run's commit, and that commit to be in `main` history. All native
build, publication and hosted acceptance gates must pass. Partial reruns retain
earlier successful jobs; a newer failed or skipped execution cannot be hidden by
an old success. Run/job collections are paginated and bounded (1000 entries,
20 attempts), with excess reported as an error.

All five hosted packages must match their real byte sizes and SHA-256 sidecars.
Only `website/downloads.json` can change. A deterministic branch and normal PR
preserve existing branch rules; there is no direct main push, synthetic check,
self-approval or protection bypass. The sync waits for the newest `pull_request`
runs of `ci.yml` and `website.yml` with the exact repository, PR, head and base,
then verifies the real job results. A changed main creates a fresh checked
proposal (at most three bases within the 180-minute job limit).

A shared concurrency group serializes updates. Automatic runs reconcile retained
successful Release runs and select the highest stable numeric version, so a
replaced pending event cannot lose a newer release. The 1000-run bound fails
visibly; manual dispatch always verifies precisely the supplied run ID. Neither
path uses `releases/latest`. Older versions cannot downgrade the catalog, and an
already advertised version with changed metadata is rejected.

#### One-time GitHub App configuration

Unattended PR checks need a GitHub App identity. The built-in `GITHUB_TOKEN`
requires human approval for generated PR workflows; it cannot provide this
unattended flow. Use a dedicated GitHub App installed **only on `OldPanda/bamboo`**
with repository permissions Contents and Pull requests **read/write**, Actions
and Checks **read-only**. Grant no branch-rule bypass. Store:

- Actions variable `SYNC_APP_ID`: numeric GitHub App ID.
- Actions variable `SYNC_APP_INSTALLATION_ID`: its installation ID.
- Actions secret `SYNC_APP_PRIVATE_KEY`: the App's RSA private key (PEM).

The script mints an installation token at runtime restricted to Bamboo's
repository ID and those permissions. It refreshes the token five minutes before
expiry, including during long CI waits. Generated credentials are masked; API
authentication is never sent to public asset downloads. The built-in workflow
token stays read-only. No PAT, stored installation token, Cloudflare deployment
token or owner's GPG key is used. Missing configuration fails before any write;
there is no successful manual-merge fallback.

These settings are prerequisites, not created by merging the workflow. Configure
them through GitHub's secure settings before enabling unattended synchronization;
never put credentials in PR comments or source files.

#### Deployment confirmation and recovery

Cloudflare's existing Pages Git integration deploys the merge on `main`. The sync
requires its successful check on that commit and all five links/byte-size labels
on both `/en/` and `/zh/`. The website continues to serve static bilingual HTML,
without runtime GitHub API requests.

If merge succeeds but deployment fails or the sync is interrupted, rerunning the
same release recovers the most recent catalog-changing commit from `main` history
and checks its deployment plus both public pages again. This also covers manually
merged catalog PRs. An unchanged catalog never creates another commit/PR, but is
not considered synchronized until production is confirmed. If Pages itself failed,
fix and retry that deployment in Pages; a sync retry only verifies it.

Rerun the failed sync, or dispatch `Release website sync` on `main` with the
successful **Release run ID**. `dry_run` defaults to true: it verifies release
identity and packages without writes or production confirmation. Set it to false
to synchronize or resume deployment verification. Fix/rerun failed catalog PR CI
before retrying. Network, missing-asset and checksum failures leave the catalog
untouched. The sync never edits tags, release assets or branch protections.

Read-only local validation needs no App key:

```sh
DRY_RUN=true RELEASE_RUN_ID=41144883695 node website/scripts/sync-release.mjs
```

Public API rate limits may apply. Offline tests cover token renewal, partial
reruns, exact tag refs, PR run provenance, pagination, failures, retries and
production recovery. A dry run of an unchanged release cannot demonstrate an
automatic catalog merge/deployment or a future tag-triggered run; verify those
with the configured App before claiming full production acceptance.

References: [GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
[GitHub App installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation),
[workflow_run security and behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run),
[Cloudflare Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/).

### Manual availability diagnostics

For investigating published availability independently of the release gate:

```sh
npm --prefix website run check:downloads
# If published assets changed, update the reviewed snapshot:
npm --prefix website run check:downloads -- --update
npm --prefix website test
npm --prefix website run build:preview
```

The network check reads the public GitHub API and follows each selected installer URL with HEAD, checking HTTP success and its length against release metadata. It fails on API/network errors and does not overwrite the catalog on those errors. No token is needed. This is an availability check, not a signature or checksum verification. `--update` changes only `website/downloads.json`; review its diff and the architecture, minimum OS, signing and installation guidance together before committing. Supported primary installers are `Bamboo-<version>-macOS-arm64.dmg`, `Bamboo-<version>-windows-x64-setup.exe` and `Bamboo-<version>-linux-x64.deb`. Portable archives `Bamboo-<version>-windows-x64.zip` and `Bamboo-<version>-linux-x64.tar.gz` are checked independently and shown beside installers. The build renders package links and unavailable states directly into both static locale pages.

Normal builds/tests are offline and deterministic. The website makes no release API request at runtime and keeps `connect-src 'none'`; release changes require refreshing the snapshot and rebuilding. If an asset is removed after deployment, the site cannot detect that until refreshed. The version-history link always opens GitHub Releases. With JavaScript disabled, links open Releases and a bilingual fallback explains where to find downloads.

## Verify changes

`npm --prefix website run test:build` runs dependency-free Node tests in disposable directories: public-file allowlisting, stale-output cleanup, asset hashes and references, reproducible builds, self-contained preview assets, and rejection of modified or unexpected images. These tests never modify the source assets or use cloud credentials.

Run `npm run test:website` from the repository root (requires Node 22+ and Chrome; set `BAMBOO_CHROME` to override the executable). It first runs the isolated build tests, then exercises the actual page at five viewport/theme combinations, verifies its screenshot appearance, navigation and mobile download behavior, rejects external runtime requests and private paths, and writes evidence to ignored `artifacts/website/`. It also checks 10 browser platform-detection cases, all three platform cards at 320/1280 px in both themes and languages, keyboard anchor/focus navigation, independent installation guidance, all five published/missing package targets, guide choices and download anchors preserved across locale-route switches, shared language/legal URLs, theme persistence, invalid preference fallback, unavailable browser storage, and the header icon order/style. Both website and App CI run the complete suite.

- Format `website/index.html`, this document, and the installation guide with the repository's Prettier version.
- Open the page at desktop and mobile widths, including 320 px, in light and dark appearances.
- Check the mobile navigation, keyboard focus, FAQ, installation disclosure, theme preference and native screenshot theme switching.
- Confirm the download, Apple support, Microsoft WebView2, Issues, Discussions and `https://x.com/OldPanda` destinations.
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

The header's translation icon opens a native language dropdown for Chinese and English, with keyboard focus and an accessible language label. Navigation, product copy, installation steps, FAQ, benchmark labels, accessibility text, document metadata and both legal documents use the shared dictionary in `content.js`. The build renders this copy into complete static English (`/en/`) and Chinese (`/zh/`) pages; the browser uses the same copy for language switching. Actual screenshots remain unmodified; native App screenshots switch to matching English or Chinese captures and follow the selected light/dark appearance. At `/`, the first visit follows the browser language (Chinese for `zh`, English otherwise), with explicit choices remembered in `bamboo-site-language` localStorage. A locale route overrides saved and browser preferences. Legacy `?lang=zh` or `?lang=en` takes priority over either route; legal hashes can be combined with both forms. The dropdown updates the locale path without reloading and preserves unrelated query parameters, page controls and open documents. Footer language links work without JavaScript. The standalone preview keeps query-based switching within its single file. Keep both dictionary entries updated when editing copy. Browser verification exercises both languages at every tested viewport/theme and checks restoration after reload.

The SQL feature card shows a text-based SQL example with theme-aware keyword and literal highlighting. It is an illustrative code sample, not an App screenshot or an interactive editor. The main product image remains an actual native App capture.

The English native captures are recorded under `localizedCaptures.en` in the screenshot provenance. They use the same generated fixture and real SQL result as the Chinese captures, in a separate temporary English configuration. Website verification compares all displayed native screenshot bytes against the correct language/theme hashes after each language switch.

## Search and sharing

`content.js` owns bilingual titles, descriptions and sharing images. `scripts/website-render.mjs` generates the head and translates text/accessible attributes before deployment. Translated elements must contain only text; missing keys or nested markup fail the build instead of silently discarding controls. Images remain the original native captures.

- `/en/` and `/zh/` have self-canonical URLs and reciprocal `en`, `zh-CN` and `x-default` alternates. `/` is the self-canonical language-adaptive fallback and initially serves Chinese HTML. Locale pages render their own language without JavaScript, cookies or an Accept-Language header.
- Share `/en/` or `/zh/` for language-specific link cards. Legacy query links still work in the browser, but static hosting cannot vary raw HTML by query string. Tracking parameters and dialog hashes are excluded from canonicals and the sitemap.
- Open Graph and Twitter cards use localized copy, absolute production URLs, and unchanged 2560 × 1576 product screenshots with descriptive alternative text. Client-side language changes keep the metadata in sync.
- JSON-LD describes the WebSite, WebPage and free, MIT-licensed SoftwareApplication. It includes no ratings, reviews, user counts, release version or unverified download information. This does not claim eligibility for a search rich result.
- `robots.txt` allows crawling and references the three-URL sitemap. The sitemap has no fabricated modification dates or ranking priorities. HTML and crawler files revalidate; hashed assets retain immutable caching.

The Node build tests inspect raw HTML, language copy, asset/image dimensions, canonical/alternate URLs, sharing fields, JSON-LD and crawler files. The browser suite checks both locale routes with scripts disabled, explicit-route preference precedence, legacy legal links, switching/reload, and matching runtime metadata under the production CSP. Existing responsive, theme and screenshot checks remain in place. These checks establish the output's behavior, not indexing or search rankings. Production changes take effect only after an authorized merge and successful Pages deployment; no Search Console submission or production configuration change is part of this build.
