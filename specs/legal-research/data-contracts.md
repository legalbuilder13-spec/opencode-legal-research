# Legal research data contracts

Status: implementation baseline

Date: 2026-08-23

## Contract rules

1. IDs and hashes are created by the application, never accepted from model prose as verified identity.
2. Original bytes are immutable and content-addressed by SHA-256.
3. A source version belongs to exactly one matter, while a deduplicated blob may be referenced by multiple versions.
4. Model-visible text must be a persisted passage with a text hash and representation provenance.
5. A citation points to evidence selections; it never embeds an editable copy of source text.
6. Retrieval, claim support, quote fidelity, citation resolution, and legal treatment are different records and states.
7. Deletion is logical until an explicit compaction proves that no retained record references the blob.

## Core entities

| Entity                  | Required identity and fields                                                                                                        | Invariants                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `matter`                | `id`, name, jurisdiction, research-as-of date, confidentiality, status                                                              | Every read/search checks matter ownership; deleted matters are unreadable.                   |
| `source`                | `id`, `matter_id`, title, kind, created/deleted timestamps                                                                          | Container for immutable versions; no source payload lives here.                              |
| `source_version`        | `id`, source/matter IDs, content/blob SHA-256, MIME, size, capture status, retrieval time, origin/final/canonical URLs, access note | Bytes and digest never change; incomplete/blocked versions are ineligible for model context. |
| `source_representation` | source-version ID, parser/version, mode, normalized-text hash, quality metrics                                                      | Reprocessing creates a new representation; it never overwrites prior evidence.               |
| `passage`               | representation/source-version IDs, stable order/ref, exact normalized text, text SHA-256, offsets/section                           | Every model-visible span resolves here and rehashes before verified rendering.               |
| `source_region`         | passage ID, page, top-left bounding box, page dimensions, page-image digest                                                         | Coordinates refer to a canonical stored page image and remain source-version specific.       |
| `legal_metadata`        | source-version ID, authority type, court, jurisdiction, date, citation, precedential status, full-source flag                       | Metadata provenance is stored; case existence is not treatment status.                       |
| `retrieval_run`         | ID, matter ID, query, serialized filters/lane, timestamp                                                                            | Append-only record of one ranking operation.                                                 |
| `retrieval_candidate`   | run/passage IDs, lexical/semantic ranks, fused/rerank scores, selected/sent flags                                                   | Includes selected and neighboring context; always matter-scoped.                             |
| `claim`                 | message ID, answer start/end offsets, exact claim text, materiality/status                                                          | Offsets cannot overlap or exceed the finalized answer.                                       |
| `evidence_selection`    | claim/passage IDs, supports/qualifies/contradicts relationship                                                                      | Multiple passages and relationships may attach to one claim.                                 |
| `citation_anchor`       | claim/message ID, app-assigned footnote number, finalized state                                                                     | Only finalized persisted anchors are clickable.                                              |
| `verification_result`   | claim/passage IDs, check kind, pass/fail/status, detail                                                                             | Identity, quote, support, resolution, coverage, and treatment checks remain separate.        |
| `citation_ledger_entry` | message/passage/retrieval-event IDs, read/cited disposition                                                                         | Records every admitted passage, including material that was read but not cited.              |

## Source envelope

Every upload, web response, connector block, or CourtListener response crosses the same boundary before inference:

```json
{
  "matterId": "mat_...",
  "origin": "tool:courtlistener or requested URL",
  "title": "human-readable source title",
  "kind": "upload|web|tool|courtlistener",
  "mime": "application/pdf",
  "bytes": "out-of-band Uint8Array",
  "captureStatus": "complete|partial|blocked|failed",
  "accessNotes": "optional license or acquisition note"
}
```

Successful materialization returns source-version and blob identities. Plain text may be returned to model context only as `{ passageId, sourceVersionId, text, textSha256, untrustedSourceData: true }`.

## Final answer transaction

The synthesis boundary accepts only matter-scoped passage IDs. The model may propose claim ranges and passage relationships. Finalization then:

1. reloads passage text from storage;
2. verifies passage and source-version hashes;
3. validates claim offsets and evidence ownership;
4. runs quote/support/coverage checks;
5. assigns citation numbers and anchors;
6. writes the cited/read ledger; and
7. publishes the finalized message atomically.

If any invariant fails, the answer remains provisional or receives a visible non-green state. Model-written `[1]` text is never promoted to an anchor.

## Export receipt

The JSON receipt is versioned and contains matter defaults, answer/claims/citations when present, source identities and hashes, passage IDs and hashes, retrieval runs and candidate ranks, verification results, source-read dispositions, parser/OCR provenance, and the export timestamp. It references content-addressed originals instead of duplicating them.

The readable Markdown answer is derived from that receipt rather than regenerated by a model. Host-minted footnotes include citation and claim identity plus every evidence relationship, source-version ID, passage ID, passage hash, verification state, exact available text, and available location. Untrusted answer and source text is escaped before host footnote markers are inserted.

## Versioning

Additive optional fields may ship within contract version 1. Renames, identity changes, changed status semantics, or removal of required fields require a new contract version and migration test. Evaluation outputs record the contract, code commit, corpus version, parser versions, and model/backend settings.
