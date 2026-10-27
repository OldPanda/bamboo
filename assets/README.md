# Bamboo app artwork

The approved design has three upright hollow bamboo stalks and two leaves, with bold black outlines and no gradients. Two variants are maintained:

- `../frontend/src/assets/bamboo.png`: transparent background, including the interiors of stalks and leaves, for the sidebar and welcome screen.
- `bamboo.png`: the approved white-background artwork for the macOS Dock/Finder ICNS family.

The Dock artwork is unchanged; the in-app version removes its background. Both are generated PNG assets. Original generated sources are retained by the host. `scripts/build.sh` builds the native icon family and signs the app without launching its window.
