# Texture Packer

Read `docs/COORDINATION.md`, current Git status and agent messages before significant work or after context loss. Coordinate file ownership before overlapping edits. Record verified checks and remaining work in that file before handoff.

`standalone` is the main development branch. Maintain the C# Windows app in `src/` and the web app in `web/` together. Changes to any texture operation must preserve equivalent semantics on both platforms and include meaningful pixel regression checks. The original web prototype remains in `typescript-legacy`.

Preserve the ORIGINAL layout from `typescript-legacy` element-for-element: 56px global header; 380px left panel with five horizontal mode tabs, channel cards and process action; 48px preview toolbar and large viewport to the right. Do not add a navigation sidebar, third column, new headings or reposition controls. The user's explicit correction rejected the first redesigned layout. Apply Microsoft's Fluent/PowerToys materials to the original elements: Segoe UI, translucent neutral layers, subtle strokes, restrained accent, native Mica on Windows. Compare actual reference screenshots before delivery. All processing is local; no API keys or remote image uploads.

The project is MIT licensed. Keep third-party notices and dependency licenses in distributions. Magick.NET is Apache-2.0 licensed. Do not substitute commercially restricted image dependencies.

Do not commit generated binaries, node_modules, build folders or user textures. Portable Windows packages and the web site are produced by GitHub Actions. Follow the user instructions about maintaining agent communication and checking messages at stage changes and at least every five active minutes.
