# Milestone E: readable provenance export

Status: synthetic product gate passed

Date: 2026-08-24

## Result

Finalized answers can be downloaded as readable Markdown alongside the versioned JSON provenance receipt. Application-generated footnotes retain every evidence relationship and resolve to the same immutable source versions, passages, and passage hashes as the sidecar. The export includes the matter, jurisdiction, research-as-of date, question, answer verification status, exact evidence text, verification state, and available location.

The formatter escapes untrusted answer and source content before inserting citations. Model-written footnote syntax therefore remains ordinary prose and cannot counterfeit an exported footnote definition.

## Acceptance evidence

- `WB-11` verifies a single claim with support and qualification passages.
- Every readable footnote repeats the JSON receipt's citation ID, claim ID, source-version IDs, passage IDs, and text SHA-256 values.
- Exact passage text is readable in each footnote.
- A synthetic `[^99]` marker is escaped and has no footnote definition.
- The UI offers readable Markdown and machine-readable JSON as distinct downloads.

## Boundary

This gate verifies identity consistency and readable rendering on deterministic fixtures. It does not satisfy the attorney-reviewed citation-support corpus, and it does not select DOCX or PDF as alpha formats.
