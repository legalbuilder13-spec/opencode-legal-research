# Legal evidence worker spike

This isolated Python package evaluates Docling and portable Tesseract OCR for immutable legal-source ingestion. It does not yet run inside OpenCode or process client material.

## Proven boundary

- Verifies the original source SHA-256 before parsing.
- Runs Docling locally with remote services disabled.
- Supports `adaptive` OCR and full-page `strict_visual` OCR.
- Materializes a canonical PNG for every processed PDF page.
- Converts every Docling provenance box to top-left page coordinates while preserving the source origin and box.
- Persists exact item text, text hashes, page hashes, parser/OCR versions, quality warnings, and an immutable result.
- Exposes a versioned JSONL protocol with `accepted`, `progress`, `completed`, `failed`, and `cancelled` states.

The host remains responsible for minting final source, representation, passage, and region IDs. Worker IDs are deterministic processing references, not database authority.

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

This is conditional evidence, not a corpus-wide accuracy claim. The remaining real-opinion, DOCX, HTML, rotation/crop, multilingual, malformed-input, and alternative-OCR matrix remains a release gate.
