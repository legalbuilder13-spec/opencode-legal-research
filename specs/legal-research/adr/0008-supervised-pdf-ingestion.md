# ADR 0008: Integrate PDF ingestion through the supervised local worker

Date: 2026-08-24

Status: accepted for alpha

## Decision

The workbench ingests PDFs by first storing the original as a partial, content-addressed source version and then invoking the pinned `legal-evidence-worker` Python environment locally. The worker verifies the original digest, runs Docling/Tesseract with remote services disabled, and returns a versioned representation contract.

The TypeScript host validates the critical result fields, rehashes every canonical page image into the shared blob store, changes the source to complete only after the worker succeeds, and mints representation, passage, and region IDs in the matter database. A failure leaves the source partial and ineligible for retrieval or model context.

## User controls

The Sources screen exposes adaptive native-text-plus-OCR and strict-visual OCR modes plus language hints. Parser mode and persisted warnings are visible beside the source. ADR 0009 adds existing-source reprocessing into another immutable representation with a distinct worker job.

## Consequences

- The primary UI can now upload a scanned or native PDF and research it without a remote OCR service.
- An OCR-backed answer citation resolves through the same matter-owned transaction to a stored page image and exact region.
- The local `.venv` remains an alpha packaging dependency. Desktop distribution must bundle and sandbox the worker runtime and models.
- Image, DOCX, HTML, and strict visual web ingestion remain separate adapters and cannot be presented as completed by this PDF decision.
