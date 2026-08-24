# Desktop legal workbench companion

Status: native companion gate passed; full installer gate partial

Date: 2026-08-24

## Result

The legal workbench now builds as a self-contained native Bun executable and is included in every Electron packaging channel. The desktop main process supervises its lifecycle on loopback, isolates its data under the desktop profile, recognizes only the versioned Legal Builder health contract, reuses an existing verified development process, and stops only processes it owns.

The compiled artifact embeds its interface and no longer depends on repository-only citation-demo files. It uses the installed/configured Codex app-server executable for ChatGPT subscription access and does not bundle an API key or a Codex credential store.

## Acceptance evidence

- 3 desktop companion tests cover paths/data isolation, owned-versus-reused lifecycle, restart, the real compiled executable, embedded UI, and capability reporting.
- 7 Electron Builder tests include the companion on all three channels and preserve existing platform identity/resource behavior.
- Desktop and legal-workbench type-checks pass.
- The build script produced and ad-hoc signed the local macOS native artifact.

## Boundary

This result packages the Bun workbench service only. OCR/Docling, the strict-visual browser renderer, signed installer artifacts for each supported OS, and the complete Electron UI restart transaction remain release gates. The health response says those absent capabilities are unavailable.
