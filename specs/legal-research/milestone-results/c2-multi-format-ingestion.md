# Milestone C2: multi-format ingestion and immutable reprocessing

Status: synthetic integration gate passed

Date: 2026-08-24

## Result

The workbench accepts PDF, PNG/JPEG, HTML, DOCX, and pasted text. Visual documents cross Docling/Tesseract in adaptive or strict-visual mode and preserve page images and exact regions. HTML and DOCX cross inert structural parsing and preserve source references and character offsets. No format becomes retrieval-eligible before the supervised result passes host validation.

An existing PDF was reprocessed in the browser from adaptive to strict-visual mode. Both representations remained attached to the same content-addressed source version. A separate real browser run ingested an HTML fixture containing a script sentinel and a scanned PNG; the HTML script did not enter normalized passages, while the image produced OCR passages and a hashed canonical page.

- Existing-source reprocessing: [`workbench-assets/pdf-reprocess.png`](./workbench-assets/pdf-reprocess.png)
- Multi-format source collection: [`workbench-assets/multi-format-sources.png`](./workbench-assets/multi-format-sources.png)

## Acceptance evidence

- Real Docling tests cover inert HTML, structural DOCX, and strict-visual image OCR.
- Host integration tests cover all upload MIME types and structural/visual mode enforcement.
- Reprocessing creates another representation and a distinct worker job without replacing prior evidence.
- A reprocessing failure preserves the completed source and earlier representation.
- Escaped or symlink-resolved page paths outside the worker job directory fail closed.
- The worker receives an environment allowlist without model/connector/cloud secrets and is bounded to five minutes plus 4 MB per output stream.
- The browser run had no page or console errors and zero WCAG A/AA violations.

## Boundary

The fixtures prove the data and safety contracts, not accuracy across arbitrary court documents. Strict visual URL capture, malformed/oversized document coverage, process sandboxing, and the attorney-reviewed corpus remain release work.
