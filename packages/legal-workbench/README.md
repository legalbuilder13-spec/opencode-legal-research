# Legal Builder Research workbench

This package is the first usable legal-research surface assembled from the fork's proven components. It runs locally, uses the signed-in ChatGPT subscription adapter for entitlement status, stores matters and sources in a matter-scoped SQLite database, persists source bytes by SHA-256, plans issues, searches primary and adverse lanes, shows exact multi-passage citation evidence, and exports a provenance receipt.

## Run locally

From the repository root:

```sh
bun install
bun run --cwd packages/legal-workbench dev
```

Open `http://localhost:3212`.

The workbench reads the current Codex/ChatGPT login through `codex app-server`; it does not require `OPENAI_API_KEY`. For deterministic local UI testing only, set `LEGAL_WORKBENCH_FIXTURE_ACCOUNT=1`.

Data defaults to `packages/legal-workbench/.data`. Set `LEGAL_RESEARCH_DATA_DIR` to use another local directory. Original source bytes live in a content-addressed blob directory and are not duplicated into messages or retrieval logs.

## Current boundary

This is an alpha integration workbench, not a production legal opinion generator. Its live research screen performs issue planning and deterministic local retrieval. The citation screen demonstrates the application-minted finalization contract against OCR/native fixtures. The remaining product task is to join live subscription synthesis, retrieved matter passages, and final citation persistence in one answer transaction, then package this route into the primary OpenCode shell.

CourtListener materialization requires a user-supplied CourtListener token. Search snippets remain leads only; only materialized full opinions may support verified claims.
