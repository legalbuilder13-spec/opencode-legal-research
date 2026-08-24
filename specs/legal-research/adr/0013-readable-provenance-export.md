# ADR 0013: readable answer export from persisted provenance

Status: accepted

Date: 2026-08-24

## Decision

Generate the human-readable Markdown answer from the same persisted `AnswerFinalizer.receipt` graph as the JSON provenance sidecar. The host inserts footnote markers at finalized claim offsets and expands every attached evidence passage into a readable footnote containing relationship, source title, source-version ID, passage ID, passage text SHA-256, verification state, and available page/region location.

The formatter treats answer and source content as literal untrusted text. It escapes Markdown and HTML metacharacters before inserting host-owned footnote syntax, so a model- or source-written marker cannot become an exported provenance footnote. Export does not ask the model to reconstruct citations and does not copy citation identity from prose.

Markdown and JSON are the alpha formats. DOCX and PDF remain an explicit product decision rather than an implicit dependency or lossy conversion step.

## Evidence

- `WB-11` creates a qualified claim backed by multiple passages, compares the Markdown identities and hashes with the JSON sidecar, and proves a model-written `[^99]` marker remains escaped prose.
- The workbench exposes separate readable-answer and machine-readable-receipt downloads for every finalized answer.
