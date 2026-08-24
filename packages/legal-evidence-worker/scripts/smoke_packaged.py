from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from legal_evidence_worker import IngestRequest, ingest


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: smoke_packaged.py SOURCE_IMAGE OUTPUT_DIR")
    source = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    result = ingest(
        IngestRequest(
            job_id="packaged-runtime-smoke",
            source_version_id="packaged-runtime-smoke-source",
            blob_path=str(source),
            output_dir=str(output),
            expected_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
            mime="image/png",
            mode="strict_visual",
            language_hints=["eng"],
        )
    )
    if result.ocr_engine.split("-", 1)[0] != "rapidocr":
        raise RuntimeError(f"unexpected packaged OCR engine: {result.ocr_engine}")
    if result.page_count != 1 or not result.items or not result.pages:
        raise RuntimeError("packaged worker did not return OCR text and a canonical page")
    print(
        f"packaged OCR smoke passed: {result.ocr_engine}, "
        f"{len(result.items)} items, {result.page_count} canonical page"
    )


if __name__ == "__main__":
    main()
