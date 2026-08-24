# Legal evidence worker spike

This isolated Python package provides the supervised Docling boundary used by the legal workbench for immutable legal-source ingestion. Development uses portable Tesseract. Desktop packaging builds a self-contained managed Python resource with offline Docling models and RapidOCR/PyTorch Latin-script OCR. It remains an alpha local worker and is not a production parser sandbox.

## Proven boundary

- Verifies the original source SHA-256 before parsing.
- Runs Docling locally with remote services disabled.
- Supports PDF and PNG/JPEG `adaptive` OCR and full-page `strict_visual` OCR.
- Parses HTML and DOCX through an inert `structural` mode.
- Materializes a canonical PNG for every processed visual page.
- Converts every Docling provenance box to top-left page coordinates while preserving the source origin and box.
- Persists exact item text, text hashes, page hashes, parser/OCR versions, quality warnings, and an immutable result.
- Exposes a versioned JSONL protocol with `accepted`, `progress`, `completed`, `failed`, and `cancelled` states.

The host remains responsible for minting final source, representation, passage, and region IDs. Worker IDs are deterministic processing references, not database authority. The host allowlists the worker environment, enforces time/output limits, and independently validates hashes, counts, geometry, and output paths.

The packaged resource is built from `packages/desktop` with `bun ./scripts/build-evidence-worker.ts`. Its manifest contains only relative, root-contained runtime paths plus the Python, lock, model, platform, and OCR identities. Packaged inference sets `LEGAL_EVIDENCE_OCR_ENGINE=rapidocr`, uses the bundled Latin-script PyTorch model, and forces model libraries offline. The repository `.venv` remains the Tesseract development fallback. Missing or unsupported packaged models are blocking errors, not download requests.

Before importing Docling, the CLI applies OS limits for CPU time, output-file size, core dumps, and open descriptors. Admission also bounds source size, requested and actual page count, image/page pixels, item count, normalized text, and DOCX archive entries, expanded size, and compression ratio. Malformed images and DOCX archives fail before converter construction. A packaged release still needs a memory/network/filesystem namespace sandbox appropriate to each operating system.

## Setup and checks

Docling is pinned in `pyproject.toml` and the transitive environment is pinned by `uv.lock`.

```sh
uv sync --frozen
ruff format --check .
ruff check .
PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v
PYTHONPATH=. .venv/bin/python scripts/evaluate.py
```

The evaluation command processes all three synthetic PDFs in both modes, persists six representations, compares twelve passage/mode pairs to gold text and boxes, and regenerates the overlay gallery.

## One-shot ingestion

```sh
PYTHONPATH=. .venv/bin/python -m legal_evidence_worker.cli request.json
```

The request contract is:

```json
{
  "contract_version": 1,
  "job_id": "job_01",
  "source_version_id": "srcv_01",
  "blob_path": "/absolute/path/source.pdf",
  "output_dir": "/absolute/path/representation",
  "expected_sha256": "64 lowercase hexadecimal characters",
  "mime": "application/pdf",
  "mode": "adaptive",
  "language_hints": ["eng"]
}
```

For the supervised stream protocol, run:

```sh
PYTHONPATH=. .venv/bin/python -m legal_evidence_worker.server
```

Write one JSON object per line using `{"command":"ingest","request":{...}}` or `{"command":"cancel","job_id":"job_01"}`.

## Spike result

On the synthetic corpus, both modes achieved 100% exact text recovery, correct-page association, and region hits. The deliberately faint/skewed page was the only page that produced a low-ink-contrast warning. See `fixtures/results/evaluation.json` and `fixtures/results/overlay-gallery.png`.

This is conditional evidence, not a corpus-wide accuracy claim. Real Docling tests also cover scanned-image OCR, inert HTML, structural DOCX, malformed images, compressed-DOCX rejection, and excessive-page blocking. A relocated macOS arm64 packaged worker also passed real offline RapidOCR ingestion; CI repeats the packaged build and smoke on Linux x64. The remaining real-opinion, rotation/crop, multilingual, broader malformed-input, Windows/other-architecture, licensing, and alternative-OCR matrix remains a release gate.
