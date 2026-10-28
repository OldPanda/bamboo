# Bamboo app artwork

The approved mark has three upright hollow bamboo stalks and two leaves. The Dock rendering adds a subtle top-to-bottom gradient: slate-to-charcoal strokes over a white-to-pale-gray tile. The in-app mark stays monochrome and theme-aware.

- `../frontend/src/assets/bamboo.png`: original transparent artwork for the app. Its CSS turns the strokes bright in dark mode.
- `dock-template.png`: 1024-pixel white tile and neutral shadow calibrated from this Mac’s native Calendar app icon. The opaque tile occupies [100, 100, 924, 924), or 824 × 824 pixels. The template contains no Calendar illustrations, colors or text.
- `bamboo.png`: reference rendering of the packaged Dock artwork.

`scripts/package-icon.swift` places the original transparent artwork inside the fixed tile. `scripts/build.sh` runs that packaging step into `build/Bamboo-icon.png`, creates the full ICNS family, and signs the app without opening a window. The original app artwork is not regenerated or changed during packaging.

Validation: at 1024 pixels, all 1,048,576 alpha values of the packaged icon match the native Calendar reference exactly, including its outer margins, corner contour and shadow. The Dock surface and strokes have a restrained vertical gradient; the native neutral outer shadow is retained. This compares installed source assets, not a live Dock screenshot or other macOS versions.
