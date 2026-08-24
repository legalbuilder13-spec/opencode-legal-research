from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

from pydantic import ValidationError

from legal_evidence_worker import CancelledError, IngestError, IngestRequest, ingest
from legal_evidence_worker.ingest import normalize_region

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


if __name__ == "__main__":
    unittest.main()
