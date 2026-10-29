# Website scope

Keep website implementation, translations, styles, assets, build/check scripts
and maintenance documentation under `website/`. Place helpers in
`website/scripts/`; do not add website-specific code to the root `scripts/`.
GitHub Actions definitions must stay in `.github/workflows/`, and existing
repository command/lint references may point into this directory.

Build and verify from the repository root:

```sh
npm --prefix website run build
npm --prefix website test
npm --prefix website run build:preview
```

The build writes only public files to ignored `build/website/`; the optional
single-file preview is `build/bamboo-website-preview.html`. Do not deploy source
docs, provenance, dependencies or test artifacts. Preserve bilingual behavior,
original screenshot hashes, benchmark methodology and explicit update consent.
See [README.md](README.md) for Cloudflare Pages and verification details.
