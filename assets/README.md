# Bamboo application icon

`bamboo.png` is the user-approved generated artwork, preserved at its original 1254 × 1254 resolution with transparency. The UI uses a 256 × 256 copy at `frontend/src/assets/bamboo.png`.

On macOS, `npm run build` generates all standard 16–1024 px icon representations with `sips`, packs `Bamboo.icns` with `iconutil`, sets `CFBundleIconFile`, and signs the resulting bundle. The sidebar and welcome screen use the same artwork.
