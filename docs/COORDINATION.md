# Current work

Base: `ed8d39e`, original TypeScript utility. Main development branch: `standalone`.
Original code preserved in `main` and published `typescript-legacy`.

User requirements: native C# desktop app using Microsoft Fluent design; feature-equivalent web app hosted on GitHub Pages; `standalone` becomes repository default; MIT license for both apps.

Ownership:
- root: desktop App/MainWindow/project, solution, native checks, docs, licensing, release and repository settings.
- image_core: `src/TexturePacker.Core/**`, five operation modes via Magick.NET Q16.
- viewmodel: desktop `ViewModels/**` and `Infrastructure/**`, state and interaction.
- web_version: `web/**` and `.github/workflows/web-pages.yml`, web UI, parity tests and Pages workflow.

Contracts: Core TextureProcessor async ProcessAsync/CreatePreviewAsync; red channel extraction for scalar masks; packing uses minimum dimensions; alpha combination uses base dimensions; atlas uses first occupied slot size and opaque black background; conversion outputs 8-bit PNG. Preserve all five modes and per-mode state.

Completed: repository cloned; original files inspected; no pre-existing project instruction/mailbox/handoff files found; only this root agent was active at entry; TypeScript moved into `web/` with Git history; legacy branch pushed.
Verified environment: Windows 11, .NET SDK 10.0.400, Node/npm. Windows Desktop runtime is absent, so actual GUI checks use self-contained executables.

Verified locally: final solution Release build 0 warnings/0 errors; Core 23 pixel/error checks; desktop 31 interaction assertions; self-contained native smoke runs all five modes and renders PNGs without WPF binding errors. Native screenshots inspected, including atlas input grid; palette, themed controls, source-card sizing, app icon and source button glyph corrected. Final browser suite 32 checks passed, production smoke exercised all five modes through actual bundled workers/WASM and exported RGBA PNGs; build/lint passed and npm audit had 0 vulnerabilities. Preview replacement/removal/Clear/grid changes now abort queued and active workers; regression checks cover a blocked import queue and browsers without OffscreenCanvas. All agents completed and handed ownership to root; full results/messages read before integration.

Decisions from cross-implementation review: shrinking an atlas discards outside cells on both platforms, preserves coordinates inside, and expansion creates empty cells. Original UTIF silently corrupts WhiteIsZero16/Gray4 and other valid TIFF layouts. Reviewed raw `image-js/tiff` alternative rejects common layouts/compressions and incorrectly inverts grayscale alpha. Use the robust official Magick WebAssembly decoder, locally bundled and lazy-loaded for TIFF/PNG16. Its Q8 build quantizes with rounding, so native and web use ImageMagick's standard 8-bit quantization instead of the prototype's upper-byte truncation (differences at most one unit on unsigned 16-bit samples). No auto-levels. JPEG/WebP EXIF orientation now matches browser display. Shared fixtures verify unsigned/signed/float TIFF, grayscale-alpha, WhiteIsZero16, Gray4, PNG16, JPEG EXIF and hidden RGB at zero alpha.

Published settings: `typescript-legacy` branch pushed, GitHub Pages enabled with workflow build at https://so2k.github.io/TexturePacker/. No standalone code pushed and no release published yet.
Next: root commits/pushes the integrated version, sets the default branch, verifies Pages workflow, and publishes the tested Windows ZIP. Portable app and screenshots are final; generated binaries remain under ignored `artifacts/`. Root owns all integration and repository settings.
