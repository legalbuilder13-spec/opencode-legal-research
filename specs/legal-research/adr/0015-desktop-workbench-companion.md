# ADR 0015: Compile and supervise the legal workbench as a desktop companion

Status: accepted for alpha packaging

Date: 2026-08-24

## Decision

Compile `packages/legal-workbench/src/server.ts` with Bun into one native executable during the Electron prebuild. Electron Builder places that executable in the application resources directory on dev, beta, and production channels. The desktop main process starts it on `127.0.0.1:3212`, stores legal data below the desktop profile's `legal-research` directory, waits for an identity-bearing `/api/health` response, and stops the owned process during quit, relaunch, and update flows.

If an already-running service on that port returns the exact Legal Builder health identity and contract version, desktop development reuses it and does not kill it. Packaged builds refuse to reuse a process with an unknown desktop-profile owner. An unrelated service is never treated as healthy. The compiled executable embeds the workbench HTML, JavaScript, and CSS and disables the synthetic citation demonstration used by tests.

The process inherits the user's environment. On macOS it may use the Codex executable inside an installed ChatGPT application when `CODEX_APP_SERVER_BIN` is not already configured. The fork does not redistribute the Codex executable or ChatGPT credentials.

## Fail-closed capability boundary

The native workbench executable is packaged, but the current 1.1 GB repository Python virtual environment is not relocatable and is not bundled. `/api/health` and `/api/bootstrap` therefore report the evidence worker unavailable unless `LEGAL_EVIDENCE_WORKER_DIR` points to a valid pinned runtime. The Sources screen shows the capability state and disables upload/reprocessing controls when the worker is absent. Strict visual browser rendering also remains unavailable; its mode is disabled while structural URL capture remains usable. Missing capabilities fail visibly instead of searching an invalid compiled path.

## Evidence

- Desktop type-check passes with the companion lifecycle integrated into main-process startup and shutdown.
- Electron Builder configuration tests prove the companion resource is included on dev, beta, and production channels.
- Lifecycle tests start, identify, reuse, stop, and restart a temporary companion without killing a reused process.
- The real compiled executable starts from an isolated profile, serves its embedded interface, reports unavailable OCR/renderer capabilities truthfully, and stops cleanly.
- Browser verification covers both capability states without console errors: repository development reports OCR ready, while the compiled standalone artifact visibly disables document ingestion and strict-visual URL mode but leaves text and structural URL capture available.

## Remaining packaging gates

Build and sandbox a relocatable evidence-worker distribution; select and sandbox a strict-visual renderer; smoke-test signed installer artifacts on supported operating systems; provide reviewed localization; and test the complete Electron window-to-answer restart flow.
