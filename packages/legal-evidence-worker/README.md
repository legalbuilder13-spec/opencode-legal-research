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

The packaged resource is built from `packages/desktop` with `bun ./scripts/build-evidence-worker.ts`. Its manifest contains only relative, root-contained runtime paths plus the Python, lock, model, platform, and OCR identities. The frozen environment is handed to the installer as `pylock.toml`, preserving exact artifact URLs and hashes. PyTorch and TorchVision resolve from the explicit CPU-only index on every platform; CUDA/NVIDIA/Triton packages are excluded. Packaged inference sets `LEGAL_EVIDENCE_OCR_ENGINE=rapidocr`, uses the bundled Latin-script PyTorch model, and forces model libraries offline. The repository `.venv` remains the Tesseract development fallback. Missing or unsupported packaged models are blocking errors, not download requests.

Before importing Docling, both the one-shot CLI and the supervised JSONL server apply OS limits for CPU time, output-file size, core dumps, and open descriptors. Linux also requests an 8 GiB virtual-address-space ceiling and a 256-process ceiling. macOS deliberately omits those two optional limits: its address-space layout is incompatible with the fixed ceiling, and `RLIMIT_NPROC` counts the whole logged-in user session rather than the OCR worker tree, which can prevent Tesseract from starting on a busy desktop. Admission also bounds source size, requested and actual page count, image/page pixels, item count, normalized text, and DOCX archive entries, expanded size, compression ratio, and XML-part size. Before converter construction it rejects malformed or oversized images; malformed, encrypted, escaping, duplicate, symlinked, macro-enabled, embedded, ActiveX, entity-bearing, or fetch-capable DOCX packages; and PDFs with a missing bounded header or recognizable active-content declarations. HTML extraction remains structural and cannot fetch subresources. The packaged OCR smoke invokes the same limits before loading its model. A packaged release still needs enforceable macOS/Windows memory and process-tree containment, network/filesystem isolation, an equivalent Windows job-object/AppContainer policy, and coverage-guided parser fuzzing.

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

This is conditional evidence, not a corpus-wide accuracy claim. Thirty-three worker tests cover scanned-image OCR, inert HTML, structural DOCX, deterministic malicious PDF/DOCX/image/HTML admission cases, compressed-DOCX rejection, and excessive-page blocking. A relocated macOS arm64 packaged worker also passed real offline RapidOCR ingestion; CI repeats the packaged build and smoke on Linux x64. The remaining real-opinion, rotation/crop, multilingual, coverage-guided fuzzing, Windows/other-architecture, counsel approval, and alternative-OCR matrix remains a release gate.
