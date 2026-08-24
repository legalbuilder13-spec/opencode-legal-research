from __future__ import annotations

import json
import sys
from pathlib import Path

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import OcrMode, PdfPipelineOptions, TesseractCliOcrOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling_core.types.doc import DocItem


def main() -> None:
    source = Path(sys.argv[1])
    mode = OcrMode.FULL_PAGE if len(sys.argv) > 2 and sys.argv[2] == "strict" else OcrMode.DEFAULT
    options = PdfPipelineOptions(
        do_ocr=True,
        do_table_structure=True,
        generate_page_images=True,
        images_scale=2.0,
        ocr_options=TesseractCliOcrOptions(mode=mode, lang=["eng"]),
    )
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
    )
    result = converter.convert(source)
    items = []
    for item, level in result.document.iterate_items(with_groups=False):
        if not isinstance(item, DocItem):
            continue
        items.append(
            {
                "type": type(item).__name__,
                "label": str(item.label),
                "text": getattr(item, "text", None),
                "level": level,
                "prov": [entry.model_dump(mode="json") for entry in item.prov],
            }
        )
    print(
        json.dumps(
            {
                "status": str(result.status),
                "pages": {
                    str(number): page.model_dump(mode="json", exclude={"image"})
                    for number, page in result.document.pages.items()
                },
                "items": items,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
