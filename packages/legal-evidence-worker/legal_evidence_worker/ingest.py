from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import subprocess
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from PIL import ImageStat

from .contract import (
    BoundingBox,
    CompletedResult,
    EvidenceItem,
    IngestRequest,
    PageRecord,
    PassageRegion,
    QualityMetrics,
    QualityWarning,
)

WORKER_VERSION = "0.0.1"
LOW_INK_CONTRAST = 75.0


class IngestError(RuntimeError):
    """A bounded ingestion failure safe to report to the host."""


class CancelledError(IngestError):
    """The host cancelled an admitted ingestion job."""


class Converter(Protocol):
    def convert(self, source: Path, **kwargs: object) -> object: ...


Progress = Callable[[str, int], None]
ConverterFactory = Callable[[IngestRequest], Converter]


def ingest(
    request: IngestRequest,
    *,
    cancel: threading.Event | None = None,
    progress: Progress | None = None,
    converter_factory: ConverterFactory | None = None,
) -> CompletedResult:
    started = time.monotonic()
    cancel = cancel or threading.Event()
    progress = progress or (lambda _stage, _percent: None)
    source = Path(request.blob_path).resolve()
    output = Path(request.output_dir).resolve()
    result_path = output / "representation.json"

    _check_cancel(cancel)
    progress("verifying_source", 5)
    if not source.is_file():
        raise IngestError(f"Source is not a regular file: {source}")
    source_hash = sha256_file(source, cancel)
    if source_hash != request.expected_sha256:
        raise IngestError(
            f"Source hash mismatch: expected {request.expected_sha256}, received {source_hash}"
        )
    if result_path.exists():
        return _load_existing(result_path, request, source_hash)

    _check_cancel(cancel)
    progress("converting", 15)
    factory = converter_factory or build_converter
    converter = factory(request)
    kwargs: dict[str, object] = {}
    if request.page_range:
        kwargs["page_range"] = (request.page_range.start, request.page_range.end)
    conversion = converter.convert(source, **kwargs)
    document = getattr(conversion, "document", None)
    status = str(getattr(conversion, "status", ""))
    if document is None or not status.endswith("SUCCESS"):
        raise IngestError(f"Docling conversion did not succeed: {status or 'unknown status'}")

    _check_cancel(cancel)
    progress("normalizing_provenance", 65)
    parser_version = importlib.metadata.version("docling")
    items, page_text = normalize_items(document, request, parser_version, cancel)

    _check_cancel(cancel)
    progress("rendering_pages", 80)
    pages, warnings = materialize_pages(document, output / "pages", page_text, cancel)
    if request.mode == "strict_visual" and len(pages) != len(document.pages):
        raise IngestError("Strict visual mode could not materialize every canonical page image")

    normalized_text = "\n\n".join(item.text for item in items)
    replacement_count = normalized_text.count("\ufffd")
    pages_with_text = sum(1 for page in pages if page.character_count)
    for page in pages:
        if page.character_count == 0:
            warnings.append(
                QualityWarning(
                    code="empty_page",
                    severity="warning",
                    page_number=page.page_number,
                    message="No model-visible text was extracted from this page.",
                )
            )
        if page.ink_contrast < LOW_INK_CONTRAST:
            warnings.append(
                QualityWarning(
                    code="low_contrast",
                    severity="warning",
                    page_number=page.page_number,
                    message=("Canonical page image has low ink contrast; OCR review is required."),
                )
            )
    if replacement_count:
        warnings.append(
            QualityWarning(
                code="replacement_characters",
                severity="warning",
                message=f"Extracted text contains {replacement_count} replacement characters.",
            )
        )

    result = CompletedResult(
        worker_version=WORKER_VERSION,
        parser_version=parser_version,
        ocr_engine=tesseract_version(),
        ocr_mode=request.mode,
        job_id=request.job_id,
        source_version_id=request.source_version_id,
        source_hash=source_hash,
        page_count=len(pages),
        normalized_text=normalized_text,
        normalized_text_sha256=sha256_text(normalized_text),
        items=items,
        pages=pages,
        quality_metrics=QualityMetrics(
            pages_with_text=pages_with_text,
            empty_page_count=len(pages) - pages_with_text,
            item_count=len(items),
            replacement_character_count=replacement_count,
            minimum_ink_contrast=min((page.ink_contrast for page in pages), default=0),
        ),
        warnings=sorted(warnings, key=lambda warning: (warning.page_number or 0, warning.code)),
        elapsed_seconds=time.monotonic() - started,
    )
    _check_cancel(cancel)
    progress("persisting", 95)
    atomic_json(result_path, result.model_dump(mode="json"))
    progress("completed", 100)
    return result


def build_converter(request: IngestRequest) -> Converter:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        OcrMode,
        PdfPipelineOptions,
        TesseractCliOcrOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption

    mode = OcrMode.FULL_PAGE if request.mode == "strict_visual" else OcrMode.DEFAULT
    options = PdfPipelineOptions(
        do_ocr=True,
        do_table_structure=True,
        enable_remote_services=False,
        generate_page_images=True,
        images_scale=2.0,
        ocr_options=TesseractCliOcrOptions(mode=mode, lang=request.language_hints),
    )
    return DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
    )


def normalize_items(
    document: object,
    request: IngestRequest,
    parser_version: str,
    cancel: threading.Event,
) -> tuple[list[EvidenceItem], dict[int, list[str]]]:
    from docling_core.types.doc import DocItem, ListItem, TableItem

    page_text: dict[int, list[str]] = {int(number): [] for number in document.pages}
    items: list[EvidenceItem] = []
    for item, _level in document.iterate_items(with_groups=False):
        _check_cancel(cancel)
        if not isinstance(item, DocItem):
            continue
        if isinstance(item, TableItem):
            text = item.export_to_markdown(document).strip()
        else:
            text = str(getattr(item, "text", "")).strip()
        if isinstance(item, ListItem) and item.marker and not text.startswith(item.marker):
            text = f"{item.marker} {text}".strip()
        if not text:
            continue
        regions = [normalize_region(entry, document.pages) for entry in item.prov]
        for page_number in {region.page_number for region in regions}:
            page_text.setdefault(page_number, []).append(text)
        order = len(items)
        identity = "\0".join(
            [request.source_version_id, parser_version, str(order), str(item.self_ref), text]
        )
        items.append(
            EvidenceItem(
                worker_item_id=f"wrk_{sha256_text(identity)[:24]}",
                source_ref=str(item.self_ref),
                order=order,
                kind=str(item.label),
                text=text,
                text_sha256=sha256_text(text),
                regions=regions,
            )
        )
    return items, page_text


def normalize_region(provenance: object, pages: dict[int, object]) -> PassageRegion:
    page_number = int(provenance.page_no)
    page = pages[page_number]
    width = float(page.size.width)
    height = float(page.size.height)
    box = provenance.bbox
    source = (float(box.l), float(box.t), float(box.r), float(box.b))
    origin = str(box.coord_origin)
    if origin.endswith("BOTTOMLEFT"):
        top = height - source[1]
        bottom = height - source[3]
    else:
        top = source[1]
        bottom = source[3]
    left, right = sorted((source[0], source[2]))
    top, bottom = sorted((top, bottom))
    normalized = BoundingBox(
        left=clamp(left, 0, width),
        top=clamp(top, 0, height),
        right=clamp(right, 0, width),
        bottom=clamp(bottom, 0, height),
    )
    return PassageRegion(
        page_number=page_number,
        page_width=width,
        page_height=height,
        bbox=normalized,
        source_coord_origin=origin,
        source_bbox=source,
    )


def materialize_pages(
    document: object,
    directory: Path,
    page_text: dict[int, list[str]],
    cancel: threading.Event,
) -> tuple[list[PageRecord], list[QualityWarning]]:
    directory.mkdir(parents=True, exist_ok=True)
    records: list[PageRecord] = []
    warnings: list[QualityWarning] = []
    for page_number, page in sorted(document.pages.items()):
        _check_cancel(cancel)
        image = getattr(getattr(page, "image", None), "pil_image", None)
        if image is None:
            warnings.append(
                QualityWarning(
                    code="canonical_page_missing",
                    severity="blocking",
                    page_number=int(page_number),
                    message="Docling did not return the requested canonical page image.",
                )
            )
            continue
        path = directory / f"page-{int(page_number):04d}.png"
        temporary = path.with_suffix(".png.tmp")
        image.save(temporary, format="PNG")
        os.replace(temporary, path)
        grayscale = image.convert("L")
        stddev = float(ImageStat.Stat(grayscale).stddev[0])
        histogram = grayscale.histogram()
        ink_pixels = sum(histogram[:245])
        mean_ink = (
            sum(value * count for value, count in enumerate(histogram[:245])) / ink_pixels
            if ink_pixels
            else 255
        )
        text = "\n".join(page_text.get(int(page_number), []))
        records.append(
            PageRecord(
                page_number=int(page_number),
                width=float(page.size.width),
                height=float(page.size.height),
                image_path=str(path.relative_to(directory.parent)),
                image_sha256=sha256_file(path, cancel),
                text_sha256=sha256_text(text),
                character_count=len(text),
                grayscale_stddev=stddev,
                ink_contrast=255 - mean_ink,
            )
        )
    return records, warnings


def _load_existing(path: Path, request: IngestRequest, source_hash: str) -> CompletedResult:
    result = CompletedResult.model_validate_json(path.read_text())
    identity = (result.source_version_id, result.source_hash, result.ocr_mode)
    expected = (request.source_version_id, source_hash, request.mode)
    if identity != expected:
        raise IngestError("Output directory already contains a different immutable representation")
    return result


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    os.replace(temporary, path)


def sha256_file(path: Path, cancel: threading.Event) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            _check_cancel(cancel)
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def tesseract_version() -> str:
    try:
        result = subprocess.run(
            ["tesseract", "--version"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise IngestError("Tesseract CLI is unavailable") from error
    return result.stdout.splitlines()[0].strip()


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _check_cancel(cancel: threading.Event) -> None:
    if cancel.is_set():
        raise CancelledError("Ingestion cancelled")
