# ADR 0002: Evidence worker and OCR pipeline

Status: provisional acceptance
Date: 2026-08-23

## Decision

Use a separately supervised Python evidence worker with Docling as the primary document structure and provenance engine. Use the Tesseract CLI as the initial portable OCR backend. Preserve two processing modes:

- `adaptive`: retain native PDF text and apply OCR where Docling determines it is needed;
- `strict_visual`: run full-page OCR and require a canonical image for every page.

ADR 0016 refines the distribution decision: repository development retains Tesseract, while packaged desktop builds use the bundled RapidOCR/PyTorch Latin-script model because it is relocatable and removes a system-Tesseract dependency. Both backends emit the same versioned worker contract and persist their engine identity.

Normalize all regions to a top-left coordinate system for the viewer, but retain Docling's source coordinate origin and box. Do not let the worker mint final database identities or write directly to OpenCode's session tables.

## Evidence

The isolated worker pins Docling 2.121.0 and its dependency graph, disables remote services, verifies source hashes before conversion, and persists atomic immutable representations.

Across three two-page synthetic legal documents—native, scanned, and mixed—and both modes:

- all twelve evaluated passage/mode pairs recovered the gold text exactly;
- every passage resolved to the correct page;
- every normalized region intersected its reviewed gold region;
- every strict-mode page produced a hashed canonical PNG;
- the native footnote marker and text survived normalization;
- the deliberately faint and slightly skewed page produced the only low-ink-contrast warning; and
- replaying the same request returned the same persisted text hash without rewriting the representation.

The visual overlay gallery shows Docling's tight red text regions inside the broader blue reviewed regions.

## Why provisional

The synthetic fixtures prove the contract and geometry transformation, not production legal-document accuracy. The full real-document corpus, rotation/crop cases, DOCX/HTML provenance, multilingual OCR, malformed inputs, second portable OCR comparison, and macOS OCR comparison remain incomplete. Docling conversion is also a blocking library call: cancellation is immediate before/after conversion, but hard mid-page cancellation currently requires terminating the supervised worker process.

## Consequences

- Heavy Python and model dependencies stay outside the Bun/OpenCode process.
- Every model-visible passage can carry immutable page and region provenance.
- Strict visual processing is more defensible for evidentiary records, while adaptive mode avoids discarding superior native text.
- Tesseract is the portable baseline rather than the sole permanent OCR choice.
- Quality warnings are separate from text recovery; successful OCR does not suppress a low-quality-page warning.
- Production release remains blocked until the broader evaluation matrix meets the PRD thresholds.

## Re-evaluation triggers

Revisit this decision after the full corpus run, whenever Docling's pinned version changes, or if an alternative local OCR engine materially improves reviewed character accuracy or confidence reporting.
