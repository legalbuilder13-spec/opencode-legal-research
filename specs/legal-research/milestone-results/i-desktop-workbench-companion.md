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
- Browser verification covers ready and unavailable worker states, visible capability labels, disabled unsupported controls, and continued structural capture without console errors.

## Follow-on packaging

ADR 0016 now packages the OCR/Docling resource and proves a relocated offline macOS arm64 runtime, with a complete Linux x64 build/smoke in CI. The strict-visual browser renderer, OS-level worker sandboxing, signed installer artifacts for every supported OS, license review, and the complete Electron UI restart transaction remain release gates. Health, bootstrap, and the Sources screen continue to fail closed for any absent or invalid installed capability.
