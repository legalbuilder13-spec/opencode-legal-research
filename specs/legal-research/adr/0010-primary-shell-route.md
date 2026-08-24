# ADR 0010: Add a primary-shell route around the separable legal workbench

Date: 2026-08-24

Status: accepted for alpha packaging

## Decision

The primary OpenCode app exposes `/legal-research` and an i18n-backed command-palette action. The route embeds the fork-owned legal workbench at `VITE_LEGAL_WORKBENCH_URL`, defaulting to `http://127.0.0.1:3212`, and offers a separate-window action through the platform's safe external-link API.

Only HTTP and HTTPS workbench URLs are accepted. Active or malformed schemes fall back to the local endpoint. The iframe receives only the capabilities needed for scripts, forms, downloads, and its own origin; it receives no popup or top-navigation capability.

## Why

The legal workbench owns Bun/SQLite, supervised Python parsing, and ChatGPT app-server processes that cannot run inside the browser bundle. A route establishes discoverable primary-shell navigation without duplicating the evidence transaction in browser state or adding a browser-rendering production dependency.

## Consequences

- Users can open the legal workspace from the main command palette or a stable route.
- Existing legal-workbench persistence and citations remain the source of truth.
- English UI copy is typed through the main i18n system and other locales receive the existing English fallback until reviewed translations are supplied.
- Electron startup now supervises and bundles the compiled workbench companion under ADR 0015. Relocatable OCR/renderer runtimes, reviewed translations, signed installer smoke tests, and the complete Electron window-to-answer restart test remain packaging gates.
