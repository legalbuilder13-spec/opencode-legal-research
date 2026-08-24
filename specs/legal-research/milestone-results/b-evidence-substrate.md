# Milestone B result: Evidence substrate

Status: core exit criteria passed; main-shell UI pending
Date: 2026-08-23
Package: [`../../../packages/legal-research-core`](../../../packages/legal-research-core)
ADR: [`../adr/0004-evidence-substrate.md`](../adr/0004-evidence-substrate.md)

## Result

The production-oriented local evidence core now persists matter defaults, immutable sources and versions, content-addressed originals, parser representations, addressable passages, regions, acquisition records, excluded connector content, and lifecycle state.

The Milestone B exit condition passes: re-fetching changed source bytes creates a new source version and content hash, while the prior version and blob remain independently integrity-verifiable.

## Requirement evidence

| Requirement | Result               | Evidence                                                                                |
| ----------- | -------------------- | --------------------------------------------------------------------------------------- |
| MAT-01      | Core pass            | Create, rename, archive, and restart retain the same matter.                            |
| MAT-02      | Core pass            | Jurisdiction, research date, confidentiality, and client label persist.                 |
| MAT-03      | Pass                 | Passage and source-version access reject a second matter.                               |
| MAT-04      | Core pass            | Export and tombstone deletion implemented with explicit blob policy.                    |
| SRC-01      | Materialization pass | All six MVP upload MIME classes accepted; format-specific parsing remains worker work.  |
| SRC-02      | Pass                 | Body, requested/final/canonical URLs, time, MIME, status, and hash persist.             |
| SRC-04      | Pass                 | Tool text and linked resources cannot return context before passage persistence.        |
| SRC-05      | Pass                 | Same bytes reuse a version; changed bytes create a new immutable version.               |
| SRC-06      | Pass                 | Blobs use SHA-256 paths and rehash verification.                                        |
| SRC-07      | Pass                 | Partial/paywalled states and access notes persist; representation is blocked.           |
| SRC-08      | Core pass            | Text, resource, and excluded blocks share the interception envelope.                    |
| PER-01      | Substrate pass       | Matter, source, representation, passage, and region metadata survive restart.           |
| PER-02      | Pass                 | Metadata references one content-addressed payload rather than copying it into messages. |
| SEC-01      | Boundary pass        | Tool prompt-injection fixture remains explicit untrusted source data.                   |
| SEC-02      | Boundary pass        | Host stores active formats as bytes and does not execute embedded content.              |
| SEC-04      | Core pass            | Default core operations emit no source text.                                            |
| SEC-05      | Core pass            | Deletion returns target scope and the retained-until-compaction policy.                 |

## Verification

- 9 deterministic tests, 27 assertions.
- TypeScript strict type check passes.
- Oxlint and Prettier pass.
- No network or model dependency in the suite.

## Remaining product integration

The core package is not yet exposed in the main OpenCode navigation. Upload progress, matter screens, source warnings, and user-facing export/delete controls will be delivered in the legal workflow integration milestone. Physical blob compaction is intentionally deferred until it can be reference-aware and explicit.
