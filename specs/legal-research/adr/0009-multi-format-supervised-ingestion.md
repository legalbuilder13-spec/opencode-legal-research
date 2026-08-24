# ADR 0009: Route document uploads through one supervised multi-format contract

Date: 2026-08-24

Status: accepted for alpha

## Decision

PDF, PNG, JPEG, HTML, and DOCX uploads use the same partial-source admission rule and versioned evidence-worker protocol. PDF and image sources require adaptive or strict-visual OCR modes. HTML and DOCX are forced onto an inert structural mode and cannot request visual OCR through this adapter.

Every worker result is treated as untrusted at the TypeScript boundary. The host verifies the job, source version, source hash, parsing mode, page count, normalized-text hash, item hashes, unique item order, page hashes, geometry bounds, and that canonical page paths remain inside the assigned job directory after resolving symlinks. Only then may the host mark an initial capture complete and create passages.

Reprocessing uses a new job directory and adds a new representation to the same immutable source version. Failure does not change the prior completed capture or representation.

## Consequences

- All P0 upload formats now cross materialization before model context.
- Visual sources retain hashed canonical page images and exact regions; structural sources retain source references and character offsets.
- Source-borne HTML scripts are never rendered or executed by ingestion or evidence display.
- Strict visual URL capture remains a separate rendered-web adapter because an uploaded HTML file is not evidence of the fetched page's rendered state.
- Process-level sandboxing, resource quotas, and the malicious-format corpus remain release gates.
