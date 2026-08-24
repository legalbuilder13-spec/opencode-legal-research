from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

CONTRACT_VERSION = 1


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PageRange(StrictModel):
    start: int = Field(ge=1)
    end: int = Field(ge=1)

    @model_validator(mode="after")
    def ordered(self) -> PageRange:
        if self.end < self.start:
            raise ValueError("page_range.end must be greater than or equal to start")
        return self


class IngestRequest(StrictModel):
    contract_version: Literal[1] = CONTRACT_VERSION
    job_id: str = Field(min_length=1, max_length=200)
    source_version_id: str = Field(min_length=1, max_length=200)
    blob_path: str = Field(min_length=1)
    output_dir: str = Field(min_length=1)
    expected_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    mime: Literal["application/pdf"]
    mode: Literal["adaptive", "strict_visual"]
    language_hints: list[str] = Field(default_factory=lambda: ["eng"])
    page_range: PageRange | None = None


class BoundingBox(StrictModel):
    origin: Literal["top-left"] = "top-left"
    left: float
    top: float
    right: float
    bottom: float


class PassageRegion(StrictModel):
    page_number: int = Field(ge=1)
    page_width: float = Field(gt=0)
    page_height: float = Field(gt=0)
    bbox: BoundingBox
    source_coord_origin: str
    source_bbox: tuple[float, float, float, float]


class EvidenceItem(StrictModel):
    worker_item_id: str
    source_ref: str
    order: int = Field(ge=0)
    kind: str
    text: str
    text_sha256: str
    regions: list[PassageRegion]


class PageRecord(StrictModel):
    page_number: int = Field(ge=1)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    image_path: str
    image_sha256: str
    text_sha256: str
    character_count: int = Field(ge=0)
    grayscale_stddev: float = Field(ge=0)
    ink_contrast: float = Field(ge=0, le=255)


class QualityWarning(StrictModel):
    code: str
    severity: Literal["warning", "blocking"]
    message: str
    page_number: int | None = None


class QualityMetrics(StrictModel):
    pages_with_text: int = Field(ge=0)
    empty_page_count: int = Field(ge=0)
    item_count: int = Field(ge=0)
    replacement_character_count: int = Field(ge=0)
    minimum_ink_contrast: float = Field(ge=0, le=255)


class CompletedResult(StrictModel):
    contract_version: Literal[1] = CONTRACT_VERSION
    worker_version: str
    parser_name: Literal["docling"] = "docling"
    parser_version: str
    ocr_engine: str
    ocr_mode: Literal["adaptive", "strict_visual"]
    job_id: str
    source_version_id: str
    source_hash: str
    page_count: int = Field(ge=0)
    normalized_text: str
    normalized_text_sha256: str
    items: list[EvidenceItem]
    pages: list[PageRecord]
    quality_metrics: QualityMetrics
    warnings: list[QualityWarning]
    elapsed_seconds: float = Field(ge=0)
