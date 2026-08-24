# Legal Builder Research workbench

This package is the first usable legal-research surface assembled from the fork's proven components. It runs locally, uses the signed-in ChatGPT subscription for structured synthesis, stores matters and sources in a matter-scoped SQLite database, persists source bytes by SHA-256, plans issues, searches primary and adverse lanes, finalizes exact citations, and exports a combined answer/provenance receipt.

## Run locally

From the repository root:

```sh
bun install
bun run --cwd packages/legal-workbench dev
```

Open `http://localhost:3212`.

The workbench reads the current Codex/ChatGPT login through `codex app-server`; it does not require `OPENAI_API_KEY`. For deterministic local UI testing only, set `LEGAL_WORKBENCH_FIXTURE_ACCOUNT=1`.

Data defaults to `packages/legal-workbench/.data`. Set `LEGAL_RESEARCH_DATA_DIR` to use another local directory. Original source bytes live in a content-addressed blob directory and are not duplicated into messages or retrieval logs.

The Sources screen accepts pasted text and PDF uploads. PDF ingestion runs the pinned local Docling/Tesseract worker in adaptive or strict-visual mode, preserves canonical page images and exact regions, and keeps failed/partial work out of model context. The repository's evidence-worker `.venv` must be installed as described in `packages/legal-evidence-worker/README.md`.

## Evidence boundary

The model receives only support-eligible, matter-scoped passage envelopes. It must return strict JSON with exact answer claim text and allowed passage IDs. The host recomputes offsets, checks context admission, matter ownership, capture status, and text hashes, then mints citations and ledger entries in the matter database. Model-written footnotes never create anchors.

This remains an alpha integration workbench, not a production legal opinion generator. Synthetic transaction tests do not establish legal accuracy, research completeness, or treatment validity. The remaining product work is the attorney-reviewed corpus, strict visual web and multi-format ingestion UI, production worker sandboxing, live CourtListener token evaluation, and primary OpenCode shell packaging/localization.

CourtListener materialization requires a user-supplied CourtListener token. Search snippets remain leads only; only materialized full opinions may support verified claims.
