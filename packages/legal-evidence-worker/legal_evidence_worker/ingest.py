from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import re
import stat
import subprocess
import threading
import time
import warnings
import zipfile
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from typing import Protocol
from xml.etree import ElementTree

from PIL import Image, ImageStat, UnidentifiedImageError

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
MAX_SOURCE_BYTES = 100 * 1024 * 1024
MAX_DOCUMENT_PAGES = 2_000
MAX_DOCUMENT_ITEMS = 100_000
MAX_NORMALIZED_TEXT_BYTES = 2 * 1024 * 1024
MAX_IMAGE_PIXELS = 100_000_000
MAX_ARCHIVE_ENTRIES = 10_000
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 500 * 1024 * 1024
MAX_ARCHIVE_COMPRESSION_RATIO = 1_000
MAX_ARCHIVE_XML_PART_BYTES = 16 * 1024 * 1024

BLOCKED_PDF_FEATURES = {
    b"/JavaScript": "JavaScript action",
    b"/JS": "JavaScript action",
    b"/Launch": "launch action",
    b"/OpenAction": "open action",
    b"/AA": "additional action",
    b"/EmbeddedFile": "embedded file",
    b"/RichMedia": "rich media",
    b"/XFA": "XFA form",
    b"/Encrypt": "encrypted content",
}

BLOCKED_DOCX_PATH_PARTS = {"activex", "embeddings"}
BLOCKED_DOCX_FILES = {"vbaproject.bin", "vbadata.xml"}


class IngestError(RuntimeError):
    """A bounded ingestion failure safe to report to the host."""


class CancelledError(IngestError):
    """The host cancelled an admitted ingestion job."""


class Converter(Protocol):
    def convert(self, source: Path, **kwargs: object) -> object: ...


Progress = Callable[[str, int], None]
ConverterFactory = Callable[[IngestRequest], Converter]

RAPIDOCR_LANGUAGE_ALIASES = {
    "eng": "latin",
    "english": "latin",
    "deu": "latin",
    "ger": "latin",
    "fra": "latin",
    "fre": "latin",
    "spa": "latin",
    "ita": "latin",
    "por": "latin",
    "nld": "latin",
    "dut": "latin",
    "ara": "arabic",
    "rus": "cyrillic",
    "ukr": "cyrillic",
    "ell": "el",
    "gre": "el",
    "kor": "korean",
    "jpn": "japan",
    "chi_sim": "ch",
    "chi_tra": "ch",
    "zho": "ch",
}


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
    preflight_source(source, request)
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
    if len(document.pages) > MAX_DOCUMENT_PAGES:
        raise IngestError(f"Document exceeds the {MAX_DOCUMENT_PAGES}-page limit")

    _check_cancel(cancel)
    progress("normalizing_provenance", 65)
    parser_version = importlib.metadata.version("docling")
    items, page_text = normalize_items(document, request, parser_version, cancel)

    _check_cancel(cancel)
    progress("rendering_pages", 80)
    if request.mode == "structural":
        pages, warnings = [], []
    else:
        pages, warnings = materialize_pages(document, output / "pages", page_text, cancel)
    if request.mode == "strict_visual" and len(pages) != len(document.pages):
        raise IngestError("Strict visual mode could not materialize every canonical page image")

    normalized_text = "\n\n".join(item.text for item in items)
    if len(normalized_text.encode()) > MAX_NORMALIZED_TEXT_BYTES:
        raise IngestError(f"Normalized text exceeds the {MAX_NORMALIZED_TEXT_BYTES}-byte limit")
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
        ocr_engine=ocr_engine_version() if request.mode != "structural" else "none",
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
        RapidOcrOptions,
        TesseractCliOcrOptions,
    )
    from docling.document_converter import (
        DocumentConverter,
        HTMLFormatOption,
        ImageFormatOption,
        PdfFormatOption,
        WordFormatOption,
    )

    if request.mime == "text/html":
        return DocumentConverter(
            allowed_formats=[InputFormat.HTML],
            format_options={InputFormat.HTML: HTMLFormatOption()},
        )
    if request.mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return DocumentConverter(
            allowed_formats=[InputFormat.DOCX],
            format_options={InputFormat.DOCX: WordFormatOption()},
        )

    mode = OcrMode.FULL_PAGE if request.mode == "strict_visual" else OcrMode.DEFAULT
    engine = configured_ocr_engine()
    if engine == "rapidocr":
        language = rapidocr_language(request.language_hints)
        allowed = packaged_ocr_languages()
        if allowed and language not in allowed:
            raise IngestError(
                f"Packaged RapidOCR does not include language {language!r}; "
                f"installed languages: {', '.join(sorted(allowed))}"
            )
        ocr_options = RapidOcrOptions(mode=mode, lang=[language], backend="torch")
    else:
        ocr_options = TesseractCliOcrOptions(mode=mode, lang=request.language_hints)
    artifacts = os.environ.get("DOCLING_ARTIFACTS_PATH")
    options = PdfPipelineOptions(
        do_ocr=True,
        do_table_structure=True,
        enable_remote_services=False,
        generate_page_images=True,
        images_scale=2.0,
        artifacts_path=Path(artifacts).resolve() if artifacts else None,
        ocr_options=ocr_options,
    )
    if request.mime in {"image/png", "image/jpeg"}:
        return DocumentConverter(
            allowed_formats=[InputFormat.IMAGE],
            format_options={InputFormat.IMAGE: ImageFormatOption(pipeline_options=options)},
        )
    return DocumentConverter(
        allowed_formats=[InputFormat.PDF],
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)},
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
        if len(items) >= MAX_DOCUMENT_ITEMS:
            raise IngestError(f"Document exceeds the {MAX_DOCUMENT_ITEMS}-item limit")
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
        if image.width * image.height > MAX_IMAGE_PIXELS:
            raise IngestError(f"Page {page_number} exceeds the {MAX_IMAGE_PIXELS}-pixel limit")
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


def preflight_source(source: Path, request: IngestRequest) -> None:
    size = source.stat().st_size
    if size <= 0:
        raise IngestError("Source is empty")
    if size > MAX_SOURCE_BYTES:
        raise IngestError(f"Source exceeds the {MAX_SOURCE_BYTES}-byte limit")
    if request.mime in {"image/png", "image/jpeg"}:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(source) as image:
                    if image.width * image.height > MAX_IMAGE_PIXELS:
                        raise IngestError(f"Image exceeds the {MAX_IMAGE_PIXELS}-pixel limit")
                    image.verify()
        except (Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
            raise IngestError(f"Image exceeds the {MAX_IMAGE_PIXELS}-pixel limit") from error
        except (UnidentifiedImageError, OSError) as error:
            raise IngestError("Image failed bounded format validation") from error
    if request.mime == "application/pdf":
        preflight_pdf(source)
    if request.mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        preflight_docx(source)


def preflight_pdf(source: Path) -> None:
    with source.open("rb") as stream:
        if b"%PDF-" not in stream.read(1_024):
            raise IngestError("PDF failed bounded header validation")
        stream.seek(0)
        overlap = b""
        while chunk := stream.read(1024 * 1024):
            window = overlap + chunk
            for token, label in BLOCKED_PDF_FEATURES.items():
                if re.search(re.escape(token) + rb"(?![A-Za-z])", window):
                    raise IngestError(f"PDF contains blocked active content: {label}")
            overlap = window[-32:]


def preflight_docx(source: Path) -> None:
    try:
        with zipfile.ZipFile(source) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ARCHIVE_ENTRIES:
                raise IngestError(f"DOCX exceeds the {MAX_ARCHIVE_ENTRIES}-entry limit")
            total = sum(entry.file_size for entry in entries)
            compressed = sum(max(entry.compress_size, 1) for entry in entries)
            if total > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
                raise IngestError(
                    f"DOCX exceeds the {MAX_ARCHIVE_UNCOMPRESSED_BYTES}-byte expanded limit"
                )
            if total / max(compressed, 1) > MAX_ARCHIVE_COMPRESSION_RATIO:
                raise IngestError("DOCX exceeds the bounded compression-ratio limit")

            names: set[str] = set()
            for entry in entries:
                name = entry.filename.replace("\\", "/")
                path = PurePosixPath(name)
                normalized = path.as_posix().casefold()
                if (
                    not name
                    or name.startswith("/")
                    or re.match(r"^[A-Za-z]:", name)
                    or ".." in path.parts
                ):
                    raise IngestError("DOCX contains an escaping archive path")
                if normalized in names:
                    raise IngestError("DOCX contains duplicate normalized archive paths")
                names.add(normalized)
                mode = (entry.external_attr >> 16) & 0o170000
                if stat.S_ISLNK(mode):
                    raise IngestError("DOCX contains a symbolic-link archive entry")
                if entry.flag_bits & 0x1:
                    raise IngestError("DOCX contains an encrypted archive entry")
                lowered_parts = {part.casefold() for part in path.parts}
                if (
                    lowered_parts & BLOCKED_DOCX_PATH_PARTS
                    or path.name.casefold() in BLOCKED_DOCX_FILES
                ):
                    raise IngestError("DOCX contains blocked active or embedded content")
                if path.suffix.casefold() not in {".xml", ".rels"}:
                    continue
                if entry.file_size > MAX_ARCHIVE_XML_PART_BYTES:
                    raise IngestError(
                        f"DOCX XML part exceeds the {MAX_ARCHIVE_XML_PART_BYTES}-byte limit"
                    )
                xml = archive.read(entry)
                upper = xml.upper()
                if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
                    raise IngestError("DOCX XML contains a blocked DTD or entity declaration")
                if path.suffix.casefold() == ".rels":
                    validate_docx_relationships(xml)
    except (zipfile.BadZipFile, zipfile.LargeZipFile, ElementTree.ParseError) as error:
        raise IngestError("DOCX failed bounded archive validation") from error


def validate_docx_relationships(xml: bytes) -> None:
    root = ElementTree.fromstring(xml)
    for relationship in root:
        target = relationship.attrib.get("Target", "").replace("\\", "/")
        target_mode = relationship.attrib.get("TargetMode", "").casefold()
        relationship_type = relationship.attrib.get("Type", "").casefold()
        if target_mode == "external" and not relationship_type.endswith("/hyperlink"):
            raise IngestError("DOCX contains a blocked external relationship")
        if target_mode != "external":
            path = PurePosixPath(target)
            if target.startswith("/") or re.match(r"^[A-Za-z]:", target) or ".." in path.parts:
                raise IngestError("DOCX contains an escaping internal relationship")


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


def configured_ocr_engine() -> str:
    engine = os.environ.get("LEGAL_EVIDENCE_OCR_ENGINE", "tesseract").strip().lower()
    if engine not in {"rapidocr", "tesseract"}:
        raise IngestError(f"Unsupported local OCR engine: {engine or 'empty'}")
    return engine


def ocr_engine_version() -> str:
    engine = configured_ocr_engine()
    if engine == "tesseract":
        return tesseract_version()
    try:
        return f"rapidocr-{importlib.metadata.version('rapidocr')}"
    except importlib.metadata.PackageNotFoundError as error:
        raise IngestError("RapidOCR runtime is unavailable") from error


def rapidocr_language(language_hints: list[str]) -> str:
    normalized = [hint.strip().lower() for hint in language_hints if hint.strip()]
    if not normalized:
        return "latin"
    languages = [RAPIDOCR_LANGUAGE_ALIASES.get(hint, hint) for hint in normalized]
    if len(set(languages)) > 1:
        raise IngestError("RapidOCR accepts one recognition language per immutable representation")
    return languages[0]


def packaged_ocr_languages() -> set[str]:
    value = os.environ.get("LEGAL_EVIDENCE_OCR_LANGUAGES", "")
    return {entry.strip().lower() for entry in value.split(",") if entry.strip()}


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _check_cancel(cancel: threading.Event) -> None:
    if cancel.is_set():
        raise CancelledError("Ingestion cancelled")
