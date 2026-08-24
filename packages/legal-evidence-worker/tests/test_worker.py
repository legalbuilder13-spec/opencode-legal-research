from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace

from pydantic import ValidationError

from legal_evidence_worker import CancelledError, IngestError, IngestRequest, ingest
from legal_evidence_worker.ingest import normalize_region
from legal_evidence_worker.limits import apply_process_limits

ROOT = Path(__file__).resolve().parents[1]
GENERATED = ROOT / "fixtures" / "generated"
RESULTS = ROOT / "fixtures" / "results"


class ContractTests(unittest.TestCase):
    def test_rejects_unknown_protocol_fields(self) -> None:
        with self.assertRaises(ValidationError):
            IngestRequest.model_validate({**request_values(), "unexpected": True})

    def test_rejects_reversed_page_range(self) -> None:
        with self.assertRaises(ValidationError):
            IngestRequest.model_validate({**request_values(), "page_range": {"start": 2, "end": 1}})

    def test_rejects_page_ranges_beyond_the_worker_limit(self) -> None:
        with self.assertRaises(ValidationError):
            IngestRequest.model_validate({**request_values(), "page_range": {"start": 1, "end": 2_001}})

    def test_requires_structural_mode_for_html_and_docx(self) -> None:
        html = {**request_values(), "mime": "text/html", "mode": "structural"}
        self.assertEqual(IngestRequest.model_validate(html).mode, "structural")
        with self.assertRaises(ValidationError):
            IngestRequest.model_validate({**html, "mode": "strict_visual"})

    def test_accepts_image_ocr_modes(self) -> None:
        image = {**request_values(), "mime": "image/png", "mode": "strict_visual"}
        self.assertEqual(IngestRequest.model_validate(image).mime, "image/png")
        with self.assertRaises(ValidationError):
            IngestRequest.model_validate({**image, "mode": "structural"})

    def test_normalizes_bottom_left_coordinates(self) -> None:
        provenance = SimpleNamespace(
            page_no=1,
            bbox=SimpleNamespace(l=72, t=627.282, r=432.173, b=617.686, coord_origin="BOTTOMLEFT"),
        )
        pages = {1: SimpleNamespace(size=SimpleNamespace(width=612, height=792))}
        region = normalize_region(provenance, pages)
        self.assertAlmostEqual(region.bbox.top, 164.718)
        self.assertAlmostEqual(region.bbox.bottom, 174.314)
        self.assertEqual(region.bbox.origin, "top-left")


class IngestionSafetyTests(unittest.TestCase):
    def test_process_resource_limits_are_applied_before_parser_import(self) -> None:
        class FakeResource:
            RLIMIT_CORE = 1
            RLIMIT_CPU = 2
            RLIMIT_FSIZE = 3
            RLIMIT_NOFILE = 4

            def __init__(self) -> None:
                self.applied: list[tuple[int, tuple[int, int]]] = []

            def getrlimit(self, _resource: int) -> tuple[int, int]:
                return (-1, -1)

            def setrlimit(self, resource: int, limits: tuple[int, int]) -> None:
                self.applied.append((resource, limits))

        resource = FakeResource()
        apply_process_limits(resource)
        self.assertEqual(len(resource.applied), 4)
        self.assertIn((resource.RLIMIT_CORE, (0, 0)), resource.applied)
        self.assertIn((resource.RLIMIT_CPU, (300, 330)), resource.applied)

    def test_hash_mismatch_fails_before_converter(self) -> None:
        called = False

        def converter_factory(_request: IngestRequest) -> object:
            nonlocal called
            called = True
            raise AssertionError("converter must not be constructed")

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            source.write_bytes(b"not a real PDF")
            request = IngestRequest.model_validate(
                {
                    **request_values(),
                    "blob_path": str(source),
                    "output_dir": str(Path(directory) / "output"),
                }
            )
            with self.assertRaisesRegex(IngestError, "Source hash mismatch"):
                ingest(request, converter_factory=converter_factory)
        self.assertFalse(called)

    def test_pre_admission_cancellation_is_terminal(self) -> None:
        cancelled = threading.Event()
        cancelled.set()
        with self.assertRaises(CancelledError):
            ingest(IngestRequest.model_validate(request_values()), cancel=cancelled)

    def test_malformed_image_fails_before_converter(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "malformed.png"
            source.write_bytes(b"not an image")
            request = IngestRequest(
                job_id="malformed-image",
                source_version_id="fixture-malformed-image",
                blob_path=str(source),
                output_dir=str(Path(directory) / "output"),
                expected_sha256=sha256(source),
                mime="image/png",
                mode="strict_visual",
                language_hints=["eng"],
            )
            with self.assertRaisesRegex(IngestError, "bounded format validation"):
                ingest(request, converter_factory=lambda _request: self.fail("converter must not run"))

    def test_docx_compression_bomb_fails_before_converter(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "compressed.docx"
            with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("word/document.xml", b"0" * (3 * 1024 * 1024))
            request = IngestRequest(
                job_id="compressed-docx",
                source_version_id="fixture-compressed-docx",
                blob_path=str(source),
                output_dir=str(Path(directory) / "output"),
                expected_sha256=sha256(source),
                mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                mode="structural",
                language_hints=[],
            )
            with self.assertRaisesRegex(IngestError, "compression-ratio"):
                ingest(request, converter_factory=lambda _request: self.fail("converter must not run"))

    def test_excessive_page_count_fails_before_normalization(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "oversized.pdf"
            source.write_bytes(b"%PDF bounded fixture")
            request = IngestRequest(
                job_id="oversized-pages",
                source_version_id="fixture-oversized-pages",
                blob_path=str(source),
                output_dir=str(Path(directory) / "output"),
                expected_sha256=sha256(source),
                mime="application/pdf",
                mode="adaptive",
                language_hints=["eng"],
            )
            conversion = SimpleNamespace(
                status="SUCCESS",
                document=SimpleNamespace(pages={page: object() for page in range(1, 2_002)}),
            )
            with self.assertRaisesRegex(IngestError, "2000-page limit"):
                ingest(request, converter_factory=lambda _request: SimpleNamespace(convert=lambda *_a, **_k: conversion))

    def test_existing_representation_is_immutable_and_idempotent(self) -> None:
        manifest = fixture_manifest()
        document = manifest["documents"][0]
        output = RESULTS / "native_legal_opinion" / "adaptive"
        request = fixture_request(document, output, "adaptive")
        first = ingest(request)
        second = ingest(request)
        self.assertEqual(first.normalized_text_sha256, second.normalized_text_sha256)

        changed = request.model_copy(update={"source_version_id": "a-different-source-version"})
        with self.assertRaisesRegex(IngestError, "different immutable representation"):
            ingest(changed)

    def test_html_is_structurally_parsed_without_executing_source_script(self) -> None:
        source = GENERATED / "structural_legal_opinion.html"
        with tempfile.TemporaryDirectory() as directory:
            request = IngestRequest(
                job_id="structural-html-test",
                source_version_id="fixture-structural-html",
                blob_path=str(source),
                output_dir=directory,
                expected_sha256=sha256(source),
                mime="text/html",
                mode="structural",
                language_hints=[],
            )
            result = ingest(request)
        self.assertIn("complete captured authority", result.normalized_text)
        self.assertNotIn("BYPASS_SUCCESS", result.normalized_text)
        self.assertEqual(result.ocr_engine, "none")
        self.assertEqual(result.pages, [])
        self.assertTrue(all(not item.regions for item in result.items))

    def test_image_is_ocr_parsed_with_a_hashed_canonical_page(self) -> None:
        source = GENERATED / "scan_page_1.png"
        with tempfile.TemporaryDirectory() as directory:
            request = IngestRequest(
                job_id="image-ocr-test",
                source_version_id="fixture-image-ocr",
                blob_path=str(source),
                output_dir=directory,
                expected_sha256=sha256(source),
                mime="image/png",
                mode="strict_visual",
                language_hints=["eng"],
            )
            result = ingest(request)
            page_path = Path(directory) / result.pages[0].image_path
            self.assertEqual(sha256(page_path), result.pages[0].image_sha256)
        self.assertEqual(result.page_count, 1)
        self.assertTrue(result.items)
        self.assertTrue(any(item.regions for item in result.items))

    def test_docx_is_structurally_parsed_with_stable_passages(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "synthetic-memorandum.docx"
            make_docx(source, "The memorandum preserves a stable structural legal passage.")
            request = IngestRequest(
                job_id="structural-docx-test",
                source_version_id="fixture-structural-docx",
                blob_path=str(source),
                output_dir=str(Path(directory) / "output"),
                expected_sha256=sha256(source),
                mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                mode="structural",
                language_hints=[],
            )
            result = ingest(request)
        self.assertIn("stable structural legal passage", result.normalized_text)
        self.assertEqual(result.ocr_engine, "none")
        self.assertTrue(result.items)
        self.assertTrue(all(not item.regions for item in result.items))


class EvaluationArtifactTests(unittest.TestCase):
    def test_gold_metrics_and_quality_warning(self) -> None:
        evaluation = json.loads((RESULTS / "evaluation.json").read_text())
        self.assertEqual(
            evaluation["metrics"],
            {
                "correct_page_rate": 1.0,
                "exact_text_rate": 1.0,
                "median_character_accuracy": 1.0,
                "region_hit_rate": 1.0,
            },
        )
        warnings = [
            warning
            for run in evaluation["runs"]
            for warning in run["warnings"]
            if warning["code"] == "low_contrast"
        ]
        self.assertEqual(len(warnings), 2)
        self.assertEqual({warning["page_number"] for warning in warnings}, {2})

    def test_every_strict_page_image_is_present_and_hashed(self) -> None:
        for representation in RESULTS.glob("*/strict_visual/representation.json"):
            result = json.loads(representation.read_text())
            self.assertEqual(len(result["pages"]), result["page_count"])
            for page in result["pages"]:
                path = representation.parent / page["image_path"]
                self.assertTrue(path.is_file())
                self.assertEqual(sha256(path), page["image_sha256"])

    def test_jsonl_server_bounds_hash_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            values = request_values()
            values["output_dir"] = directory
            message = json.dumps({"command": "ingest", "request": values}) + "\n"
            environment = {**os.environ, "PYTHONPATH": str(ROOT)}
            process = subprocess.run(
                [sys.executable, "-m", "legal_evidence_worker.server"],
                cwd=ROOT,
                env=environment,
                input=message,
                text=True,
                capture_output=True,
                check=True,
                timeout=10,
            )
        events = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual([event["event"] for event in events], ["accepted", "progress", "failed"])
        self.assertNotIn("Traceback", process.stdout + process.stderr)


def request_values() -> dict[str, object]:
    source = GENERATED / "native_legal_opinion.pdf"
    return {
        "contract_version": 1,
        "job_id": "unit-test-job",
        "source_version_id": "unit-test-source",
        "blob_path": str(source),
        "output_dir": str(ROOT / "tmp" / "unit-test-output"),
        "expected_sha256": "0" * 64,
        "mime": "application/pdf",
        "mode": "adaptive",
        "language_hints": ["eng"],
    }


def fixture_manifest() -> dict[str, object]:
    return json.loads((GENERATED / "manifest.json").read_text())


def fixture_request(document: dict[str, object], output: Path, mode: str) -> IngestRequest:
    return IngestRequest(
        job_id=f"evaluation-native_legal_opinion-{mode}",
        source_version_id="fixture-native_legal_opinion",
        blob_path=str(GENERATED / str(document["file"])),
        output_dir=str(output),
        expected_sha256=str(document["sha256"]),
        mime="application/pdf",
        mode=mode,
        language_hints=["eng"],
    )


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def make_docx(path: Path, text: str) -> None:
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""
    relationships = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
    document = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p><w:sectPr/></w:body>
</w:document>"""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", relationships)
        archive.writestr("word/document.xml", document)


if __name__ == "__main__":
    unittest.main()
