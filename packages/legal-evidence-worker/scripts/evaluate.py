from __future__ import annotations

import difflib
import json
import statistics
from pathlib import Path

from PIL import Image, ImageDraw

from legal_evidence_worker import IngestRequest, ingest
from legal_evidence_worker.contract import BoundingBox, EvidenceItem

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures" / "generated"
RESULTS = ROOT / "fixtures" / "results"


def main() -> None:
    manifest = json.loads((FIXTURES / "manifest.json").read_text())
    matches: list[dict[str, object]] = []
    runs: list[dict[str, object]] = []
    for document in manifest["documents"]:
        for mode in ("adaptive", "strict_visual"):
            name = Path(document["file"]).stem
            output = RESULTS / name / mode
            request = IngestRequest(
                job_id=f"evaluation-{name}-{mode}",
                source_version_id=f"fixture-{name}",
                blob_path=str(FIXTURES / document["file"]),
                output_dir=str(output),
                expected_sha256=document["sha256"],
                mime="application/pdf",
                mode=mode,
                language_hints=["eng"],
            )
            result = ingest(
                request,
                progress=lambda stage, percent, current_name=name, current_mode=mode: print(
                    current_name, current_mode, percent, stage
                ),
            )
            repeated = ingest(request)
            if repeated.normalized_text_sha256 != result.normalized_text_sha256:
                raise RuntimeError("Idempotent replay changed the normalized text hash")
            runs.append(
                {
                    "document": document["file"],
                    "kind": document["kind"],
                    "mode": mode,
                    "page_count": result.page_count,
                    "item_count": len(result.items),
                    "normalized_text_sha256": result.normalized_text_sha256,
                    "elapsed_seconds": result.elapsed_seconds,
                    "warnings": [warning.model_dump(mode="json") for warning in result.warnings],
                }
            )
            for gold in document["gold_passages"]:
                match = evaluate_passage(result.items, gold)
                match.update({"document": document["file"], "kind": document["kind"], "mode": mode})
                matches.append(match)
                overlay(output, result, gold, match)

    exact = [bool(match["exact_text"]) for match in matches]
    correct_page = [bool(match["correct_page"]) for match in matches]
    region_hits = [bool(match["region_hit"]) for match in matches]
    character_accuracy = [float(match["character_accuracy"]) for match in matches]
    report = {
        "version": 1,
        "fixture_manifest": "../generated/manifest.json",
        "run_count": len(runs),
        "passage_evaluation_count": len(matches),
        "metrics": {
            "exact_text_rate": sum(exact) / len(exact),
            "correct_page_rate": sum(correct_page) / len(correct_page),
            "region_hit_rate": sum(region_hits) / len(region_hits),
            "median_character_accuracy": statistics.median(character_accuracy),
        },
        "runs": runs,
        "passages": matches,
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "evaluation.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    make_gallery()
    print(json.dumps(report["metrics"], indent=2))


def evaluate_passage(items: list[EvidenceItem], gold: dict[str, object]) -> dict[str, object]:
    expected = str(gold["text"])
    item = max(items, key=lambda candidate: similarity(expected, candidate.text))
    region = next(
        (candidate for candidate in item.regions if candidate.page_number == gold["page"]), None
    )
    expected_box = BoundingBox.model_validate(gold["bbox"])
    return {
        "gold_id": gold["id"],
        "worker_item_id": item.worker_item_id,
        "expected_text": expected,
        "actual_text": item.text,
        "exact_text": item.text == expected,
        "character_accuracy": similarity(expected, item.text),
        "expected_page": gold["page"],
        "actual_pages": [candidate.page_number for candidate in item.regions],
        "correct_page": region is not None,
        "region_hit": region is not None and intersection_area(region.bbox, expected_box) > 0,
        "intersection_over_union": iou(region.bbox, expected_box) if region else 0,
        "actual_bbox": region.bbox.model_dump(mode="json") if region else None,
    }


def overlay(
    output: Path, result: object, gold: dict[str, object], match: dict[str, object]
) -> None:
    page = next(page for page in result.pages if page.page_number == gold["page"])
    source = output / page.image_path
    image = Image.open(source).convert("RGB")
    draw = ImageDraw.Draw(image)
    scale_x = image.width / page.width
    scale_y = image.height / page.height
    expected = BoundingBox.model_validate(gold["bbox"])
    draw_box(draw, expected, scale_x, scale_y, "#2563eb", "gold")
    if match["actual_bbox"]:
        actual = BoundingBox.model_validate(match["actual_bbox"])
        draw_box(draw, actual, scale_x, scale_y, "#dc2626", "docling")
    destination = (
        RESULTS
        / "overlays"
        / f"{Path(str(match.get('document', 'doc'))).stem}-{match['gold_id']}-{result.ocr_mode}.png"
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination)


def draw_box(
    draw: ImageDraw.ImageDraw,
    box: BoundingBox,
    scale_x: float,
    scale_y: float,
    color: str,
    label: str,
) -> None:
    coordinates = (box.left * scale_x, box.top * scale_y, box.right * scale_x, box.bottom * scale_y)
    draw.rectangle(coordinates, outline=color, width=4)
    draw.text((coordinates[0] + 4, max(0, coordinates[1] - 16)), label, fill=color)


def make_gallery() -> None:
    paths = sorted((RESULTS / "overlays").glob("*.png"))
    columns = 3
    thumbnail_size = (306, 396)
    cell_size = (326, 436)
    rows = (len(paths) + columns - 1) // columns
    gallery = Image.new("RGB", (cell_size[0] * columns, cell_size[1] * rows), "white")
    draw = ImageDraw.Draw(gallery)
    for index, path in enumerate(paths):
        image = Image.open(path).convert("RGB")
        image.thumbnail(thumbnail_size)
        column = index % columns
        row = index // columns
        left = column * cell_size[0] + 10
        top = row * cell_size[1] + 30
        gallery.paste(image, (left, top))
        draw.text((left, row * cell_size[1] + 8), path.stem[:48], fill="black")
    gallery.save(RESULTS / "overlay-gallery.png")


def similarity(expected: str, actual: str) -> float:
    return difflib.SequenceMatcher(None, expected, actual).ratio()


def intersection_area(first: BoundingBox, second: BoundingBox) -> float:
    width = max(0.0, min(first.right, second.right) - max(first.left, second.left))
    height = max(0.0, min(first.bottom, second.bottom) - max(first.top, second.top))
    return width * height


def iou(first: BoundingBox, second: BoundingBox) -> float:
    intersection = intersection_area(first, second)
    first_area = (first.right - first.left) * (first.bottom - first.top)
    second_area = (second.right - second.left) * (second.bottom - second.top)
    union = first_area + second_area - intersection
    return intersection / union if union else 0


if __name__ == "__main__":
    main()
