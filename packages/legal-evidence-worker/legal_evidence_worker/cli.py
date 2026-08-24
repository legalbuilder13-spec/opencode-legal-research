from __future__ import annotations

import json
import sys
from pathlib import Path

from .contract import IngestRequest
from .ingest import ingest


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m legal_evidence_worker.cli REQUEST.json")
    request = IngestRequest.model_validate_json(Path(sys.argv[1]).read_text())
    result = ingest(
        request,
        progress=lambda stage, percent: print(f"{percent:3d}% {stage}", file=sys.stderr),
    )
    print(json.dumps(result.model_dump(mode="json"), indent=2))


if __name__ == "__main__":
    main()
