from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "fixtures" / "generated"
PAGE_WIDTH, PAGE_HEIGHT = letter


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    native = OUTPUT / "native_legal_opinion.pdf"
    scanned = OUTPUT / "scanned_legal_opinion.pdf"
    mixed = OUTPUT / "mixed_legal_record.pdf"

    make_native(native)
    scan_pages = make_scan_images()
    make_image_pdf(scanned, scan_pages)
    make_mixed(mixed, scan_pages[0])

    manifest = {
        "version": 1,
        "license": "CC0-1.0 synthetic fixture; no real client or case data",
        "page_size": {"width": PAGE_WIDTH, "height": PAGE_HEIGHT},
        "documents": [
            document(
                native,
                "native",
                [
                    gold(
                        "native-rule",
                        1,
                        "A court may grant relief only when the movant establishes "
                        "each required element.",
                        72,
                        620,
                    ),
                    gold(
                        "native-footnote",
                        2,
                        "1. Pinpoint citations must identify the exact passage relied upon.",
                        72,
                        80,
                    ),
                ],
            ),
            document(
                scanned,
                "scanned",
                [
                    gold(
                        "scan-rule",
                        1,
                        "The record must be reviewed as a whole, including contrary authority.",
                        72,
                        620,
                    ),
                    gold(
                        "scan-faint",
                        2,
                        "Faint scan: material limitations must remain visible to the reviewer.",
                        72,
                        620,
                    ),
                ],
            ),
            document(
                mixed,
                "mixed",
                [
                    gold(
                        "mixed-native",
                        1,
                        "Page one contains searchable native text and section 1983 analysis.",
                        72,
                        620,
                    ),
                    gold(
                        "mixed-scan",
                        2,
                        "The record must be reviewed as a whole, including contrary authority.",
                        72,
                        620,
                    ),
                ],
            ),
        ],
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def make_native(path: Path) -> None:
    pdf = canvas.Canvas(str(path), pagesize=letter, pageCompression=1)
    heading(pdf, "SYNTHETIC COURT OF APPEALS", "No. 26-1000")
    line(
        pdf,
        "A court may grant relief only when the movant establishes each required element.",
        72,
        620,
    )
    line(pdf, "The inquiry is objective and must account for contrary authority.", 72, 596)
    line(
        pdf,
        "42 U.S.C. § 1983 supplies a cause of action; it does not create substantive rights.",
        72,
        572,
    )
    line(pdf, "Citation: 999 F.4th 101, 107 (Synthetic Cir. 2026).", 72, 548)
    table(pdf)
    footer(pdf, 1)
    pdf.showPage()

    heading(pdf, "SYNTHETIC COURT OF APPEALS", "Discussion - continued")
    line(pdf, "We therefore affirm the judgment while preserving the narrower exception.", 72, 620)
    line(
        pdf,
        "The exception applies only when the record contains verified primary authority.",
        72,
        596,
    )
    pdf.setFont("Helvetica", 9)
    pdf.drawString(72, 80, "1. Pinpoint citations must identify the exact passage relied upon.")
    footer(pdf, 2)
    pdf.save()


def make_scan_images() -> list[Path]:
    font = font_at(28)
    small = font_at(22)
    pages: list[Path] = []
    texts = [
        [
            ("SCANNED SYNTHETIC OPINION", 72, 700, font),
            (
                "The record must be reviewed as a whole, including contrary authority.",
                72,
                620,
                small,
            ),
            (
                "A scanned source remains evidence only when its page location is preserved.",
                72,
                580,
                small,
            ),
            ("Citation: 999 F.4th 201, 205 (Synthetic Cir. 2026).", 72, 540, small),
        ],
        [
            ("LOW-CONTRAST APPENDIX", 72, 700, font),
            (
                "Faint scan: material limitations must remain visible to the reviewer.",
                72,
                620,
                small,
            ),
            (
                "The system must warn rather than silently present uncertain OCR as verified.",
                72,
                580,
                small,
            ),
        ],
    ]
    scale = 2
    for index, entries in enumerate(texts, start=1):
        image = Image.new("RGB", (int(PAGE_WIDTH * scale), int(PAGE_HEIGHT * scale)), "white")
        draw = ImageDraw.Draw(image)
        for text, x, y, selected_font in entries:
            draw.text(
                (x * scale, (PAGE_HEIGHT - y) * scale), text, fill="black", font=selected_font
            )
        draw.rectangle(
            (60 * scale, 60 * scale, 552 * scale, 732 * scale), outline="#777777", width=2
        )
        if index == 2:
            image = ImageEnhance.Contrast(image).enhance(0.42)
            image = image.rotate(
                0.35, resample=Image.Resampling.BICUBIC, expand=False, fillcolor="white"
            )
        path = OUTPUT / f"scan_page_{index}.png"
        image.save(path, dpi=(144, 144))
        pages.append(path)
    return pages


def make_image_pdf(path: Path, pages: list[Path]) -> None:
    pdf = canvas.Canvas(str(path), pagesize=letter, pageCompression=1)
    for index, image_path in enumerate(pages, start=1):
        pdf.drawImage(ImageReader(str(image_path)), 0, 0, PAGE_WIDTH, PAGE_HEIGHT)
        footer(pdf, index)
        pdf.showPage()
    pdf.save()


def make_mixed(path: Path, scan_page: Path) -> None:
    pdf = canvas.Canvas(str(path), pagesize=letter, pageCompression=1)
    heading(pdf, "MIXED SYNTHETIC RECORD", "Native page")
    line(pdf, "Page one contains searchable native text and section 1983 analysis.", 72, 620)
    line(pdf, "Page two is an image-only exhibit requiring OCR.", 72, 596)
    footer(pdf, 1)
    pdf.showPage()
    pdf.drawImage(ImageReader(str(scan_page)), 0, 0, PAGE_WIDTH, PAGE_HEIGHT)
    footer(pdf, 2)
    pdf.save()


def heading(pdf: canvas.Canvas, title: str, subtitle: str) -> None:
    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawCentredString(PAGE_WIDTH / 2, 720, title)
    pdf.setFont("Helvetica", 11)
    pdf.drawCentredString(PAGE_WIDTH / 2, 694, subtitle)


def line(pdf: canvas.Canvas, text: str, x: float, y: float) -> None:
    pdf.setFont("Times-Roman", 11)
    pdf.drawString(x, y, text)


def table(pdf: canvas.Canvas) -> None:
    data = [
        ("Authority", "Treatment"),
        ("Synthetic v. Record", "Followed"),
        ("Example Act § 7", "Applied"),
    ]
    x_positions = (72, 300, 540)
    top = 470
    row_height = 24
    pdf.setFont("Helvetica", 9)
    for row, values in enumerate(data):
        y = top - row * row_height
        pdf.line(x_positions[0], y, x_positions[2], y)
        pdf.drawString(x_positions[0] + 6, y - 16, values[0])
        pdf.drawString(x_positions[1] + 6, y - 16, values[1])
    pdf.line(
        x_positions[0], top - len(data) * row_height, x_positions[2], top - len(data) * row_height
    )
    for x in x_positions:
        pdf.line(x, top, x, top - len(data) * row_height)


def footer(pdf: canvas.Canvas, page: int) -> None:
    pdf.setFont("Helvetica", 8)
    pdf.drawCentredString(PAGE_WIDTH / 2, 36, f"Synthetic fixture - page {page}")


def font_at(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size=size)


def gold(identifier: str, page: int, text: str, x: float, y: float) -> dict[str, object]:
    return {
        "id": identifier,
        "page": page,
        "text": text,
        "bbox": {
            "origin": "top-left",
            "left": x - 4,
            "top": PAGE_HEIGHT - y - 12,
            "right": 548,
            "bottom": PAGE_HEIGHT - y + 12,
        },
    }


def document(path: Path, kind: str, passages: list[dict[str, object]]) -> dict[str, object]:
    return {
        "file": path.name,
        "kind": kind,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "page_count": 2,
        "gold_passages": passages,
    }


if __name__ == "__main__":
    main()
