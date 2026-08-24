# Milestone C integration: local PDF ingestion

Status: synthetic PDF workflow passed; broader document corpus pending

Date: 2026-08-24

## Result

The workbench now connects the supervised Docling/Tesseract worker to matter-owned storage and the unified answer transaction. Originals enter the blob store as partial. Only a hash-matched completed worker result can create model-visible passages and change the source to complete.

The browser run uploaded the generated two-page scanned opinion in strict-visual mode. It produced two canonical page images, searchable OCR passages, stored parser/OCR provenance, and a visible completion state. A research question ranked the expected OCR passage first. The finalized answer cited that passage, and the citation reopened page 1 at the exact persisted region.

- PDF upload UI: [`workbench-assets/pdf-upload.png`](./workbench-assets/pdf-upload.png)
- OCR-backed answer and exact region: [`workbench-assets/ocr-answer-evidence.png`](./workbench-assets/ocr-answer-evidence.png)
- Matter editing/archive UI: [`workbench-assets/matter-edit.png`](./workbench-assets/matter-edit.png)

## Acceptance evidence

- Adaptive and strict-visual modes are user-selectable.
- OCR language hints cross the worker protocol.
- Page images are rehashed into the content-addressed host store.
- Passages retain page geometry and page-image identity.
- Worker parser, OCR engine/version, mode, normalized-text hash, quality metrics, and warnings persist and export.
- Failed ingestion remains partial and cannot enter retrieval.
- Browser run had no page errors.

## Boundary

The generated PDF proves the integrated contract, not production accuracy across court scans. Existing-source reprocessing, real federal opinions, malformed documents, rotation/crop cases, multilingual OCR, and image/DOCX/HTML adapters remain corpus/release work.
