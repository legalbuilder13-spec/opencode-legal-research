# ADR 0015: Compile and supervise the legal workbench as a desktop companion

Status: accepted for alpha packaging

Date: 2026-08-24

## Decision

Compile `packages/legal-workbench/src/server.ts` with Bun into one native executable during the Electron prebuild. Electron Builder places that executable in the application resources directory on dev, beta, and production channels. The desktop main process starts it on `127.0.0.1:3212`, stores legal data below the desktop profile's `legal-research` directory, waits for an identity-bearing `/api/health` response, and stops the owned process during quit, relaunch, and update flows.

If an already-running service on that port returns the exact Legal Builder health identity and contract version, desktop development reuses it and does not kill it. Packaged builds refuse to reuse a process with an unknown desktop-profile owner. An unrelated service is never treated as healthy. The compiled executable embeds the workbench HTML, JavaScript, and CSS and disables the synthetic citation demonstration used by tests.

The process inherits the user's environment. On macOS it may use the Codex executable inside an installed ChatGPT application when `CODEX_APP_SERVER_BIN` is not already configured. The fork does not redistribute the Codex executable or ChatGPT credentials.

## Capability boundary

ADR 0016 adds a relocatable, manifest-validated Python/Docling/RapidOCR resource to Electron release builds instead of bundling the repository virtual environment. ADR 0017 supplies strict-visual capture through an authenticated renderer service using the desktop's isolated Electron Chromium. `/api/health` and `/api/bootstrap` report each capability ready only when its local runtime passes discovery/health. Missing capabilities fail visibly instead of searching an invalid compiled path, downloading models, or silently falling back.

## Evidence

- Desktop type-check passes with the companion lifecycle integrated into main-process startup and shutdown.
- Electron Builder configuration tests prove the companion resource is included on dev, beta, and production channels.
- Lifecycle tests start, identify, reuse, stop, and restart a temporary companion without killing a reused process.
- The real compiled executable starts from an isolated profile, serves its embedded interface, reports unavailable OCR/renderer capabilities truthfully, and stops cleanly.
- Browser verification covers both capability states without console errors: repository development reports OCR ready, while the compiled standalone artifact visibly disables document ingestion and strict-visual URL mode but leaves text and structural URL capture available.

## Remaining packaging gates

Apply OS-level sandboxing to the evidence worker; complete the renderer live-web corpus; smoke-test signed installer artifacts on every supported operating system; complete the dependency/model license audit; provide reviewed localization; and test the complete Electron window-to-answer restart flow.
