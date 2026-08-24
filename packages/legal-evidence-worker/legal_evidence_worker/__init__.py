"""Legal evidence worker spike."""

from .contract import CONTRACT_VERSION, CompletedResult, IngestRequest
from .ingest import CancelledError, IngestError, ingest

__all__ = [
    "CONTRACT_VERSION",
    "CancelledError",
    "CompletedResult",
    "IngestError",
    "IngestRequest",
    "ingest",
]
