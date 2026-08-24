# Live-web strict-renderer corpus v0

This candidate corpus exercises the real pinned Electron renderer against one stable control, one public legal reference, and one primary government source. Each run saves the final serialized HTML, full-page PNG, hashes, dimensions, timing, final URL, and token checks. When `LEGAL_EVIDENCE_WORKER_DIR` points to a packaged worker, the same PNG is OCRed offline and the receipt records the exact recognized text hash and required-token checks.

Run from the repository root:

```sh
LEGAL_EVIDENCE_WORKER_DIR=/path/to/legal-evidence-worker \
LEGAL_WEB_CORPUS_OUTPUT=/path/to/results \
bun --cwd packages/desktop evaluate:legal-web
```

`ELECTRON_EXECUTABLE` may select a signed Electron binary when the installed development binary cannot launch. The command exits nonzero if a source changes host, required HTML/OCR text disappears, the renderer contract fails, the screenshot is invalid/too small, or a case exceeds its time budget.

The checked-in manifest remains `candidate` until legal/security reviewers record their identities and adjudicate expected text, fidelity, access/terms, cookie/banner behavior, and acceptable failure thresholds. Live sites can change independently; a failed run is evidence to review, not an invitation to weaken assertions automatically.
