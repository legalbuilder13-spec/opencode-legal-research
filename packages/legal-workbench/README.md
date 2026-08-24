# Legal Builder Research workbench

This package is the first usable legal-research surface assembled from the fork's proven components. It runs locally, uses the signed-in ChatGPT subscription for structured synthesis, stores matters and sources in a matter-scoped SQLite database, persists source bytes by SHA-256, plans issues, searches primary and adverse lanes, finalizes exact citations, and exports a combined answer/provenance receipt.

## Run locally

From the repository root:

```sh
bun install
bun run --cwd packages/legal-workbench dev
```

Open `http://127.0.0.1:3212`. The service binds to the loopback interface by default; packaged or supervised environments may set `LEGAL_WORKBENCH_HOST` explicitly.

The primary OpenCode app also exposes `/legal-research` and a command-palette entry. Start this workbench service before opening that route. Packaged deployments can set `VITE_LEGAL_WORKBENCH_URL` to an approved HTTP(S) workbench endpoint.

The workbench reads the current Codex/ChatGPT login through `codex app-server`; it does not require `OPENAI_API_KEY`. For deterministic local UI testing only, set `LEGAL_WORKBENCH_FIXTURE_ACCOUNT=1`.

Each matter can be marked local-only. Local ingestion, OCR, storage, retrieval, inspection, and export continue to work, while the UI and API block ChatGPT drafting before any model context is constructed. CourtListener query egress remains a separate explicit action. The alpha does not claim a local generative fallback unless a future packaged local model is configured.

Data defaults to `packages/legal-workbench/.data`. Set `LEGAL_RESEARCH_DATA_DIR` to use another local directory. Original source bytes live in a content-addressed blob directory and are not duplicated into messages or retrieval logs.

The Sources screen accepts pasted text plus PDF, PNG/JPEG, HTML, and DOCX uploads. Visual ingestion runs the pinned local Docling/Tesseract worker in adaptive or strict-visual mode and preserves canonical page images and exact regions. HTML and DOCX use an inert structural Docling path with stable section paths and character offsets. A completed source can be reprocessed into another immutable representation without replacing prior evidence. Failed or partial work stays out of model context. The repository's evidence-worker `.venv` must be installed as described in `packages/legal-evidence-worker/README.md`.

The Sources screen also accepts public HTTP(S) URLs. Structural mode uses bounded redirects and response size, rejects local/private/reserved targets, archives requested/final/canonical URL metadata, and parses the stored HTML inertly. Strict visual mode is fail-closed unless the installation supplies the supervised renderer; when present, the HTML and separately hashed screenshot are parsed into structural and visual OCR representations under one source version. The alpha repository deliberately does not treat the root Playwright test dependency as a packaged renderer.

## Evidence boundary

The model receives only support-eligible, matter-scoped passage envelopes. It must return strict JSON with exact answer claim text and allowed passage IDs. The host recomputes offsets, checks context admission, matter ownership, capture status, and text hashes, then mints citations and ledger entries in the matter database. Model-written footnotes never create anchors.

This remains an alpha integration workbench, not a production legal opinion generator. Synthetic transaction tests do not establish legal accuracy, research completeness, or treatment validity. The remaining product work is the attorney-reviewed corpus, strict visual URL capture, production worker sandboxing, live CourtListener token evaluation, and primary OpenCode shell packaging/localization.

CourtListener materialization requires a user-supplied CourtListener token. The token is held in the page only, is cleared on reload, and is not stored in matter data, local storage, or exports. Search snippets remain leads only; only materialized full opinions may support verified claims.
