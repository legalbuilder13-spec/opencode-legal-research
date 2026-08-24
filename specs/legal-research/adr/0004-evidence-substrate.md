# ADR 0004: Matter-scoped evidence substrate

Status: accepted
Date: 2026-08-23

## Decision

Use a local SQLite metadata store plus a content-addressed filesystem blob store as the production evidence substrate. Every source belongs to one matter, while identical bytes may share the same immutable blob by SHA-256. A changed acquisition creates a new source version; it never rewrites an existing citation target.

Require all uploads, web responses, legal-data responses, and generic connector content to pass through one materialization boundary before any returned text can enter model context. Context packets carry persisted passage and source-version IDs, hashes, and an explicit `untrustedSourceData` marker.

Keep deletion as a lifecycle tombstone in the first release. Deleted material immediately leaves searchable/model-visible queries, while content-addressed blobs are retained until an explicit, reference-aware compaction operation is implemented. The deletion response and exports state this policy.

## Evidence

The `@legalbuilder/legal-research-core` package passes deterministic tests for:

- matter creation, editing, archive, and restart;
- cross-matter passage and source rejection;
- PDF, DOCX, HTML, text, PNG, and JPEG materialization;
- URL, timestamp, MIME, capture status, access note, and body-hash capture;
- identical-version reuse and changed-version immutability;
- content-addressed blob integrity;
- blocking partial or paywalled captures from model-visible representations;
- generic tool text, linked resource, and excluded-content interception;
- prompt-injection text remaining labeled source data; and
- export and deletion behavior without raw-source default logging.

## Consequences

- Source payloads do not need to be duplicated in messages or ledgers.
- Matter authorization has one enforcement key on passages, representations, source versions, and acquisition events.
- Connector authors cannot return ordinary model context directly; they must return materialization input or an excluded-content record.
- Blob storage may temporarily retain orphaned bytes after failed database writes or deletion. Reference-aware compaction is required before storage reclamation.
- Active document content remains bytes for the isolated parser; the host does not execute it.

## Re-evaluation triggers

Revisit blob retention when physical secure deletion is required, when multi-user cloud storage is introduced, or when encryption-at-rest/key-destruction becomes part of the supported confidentiality model.
