# Milestone C5 result: evidence-worker resource containment

Date: 2026-08-24

Status: Linux x64 memory/process gate passed; macOS portable limits passed; full parser sandbox partial

## Implemented boundary

The real supervised JSONL server applies CPU, output-file, core-dump, and descriptor limits before accepting work. Linux also requests an 8 GiB virtual-address-space ceiling and a 256-process ceiling before Docling or PyTorch model construction. macOS intentionally omits those two per-user/process-layout-incompatible limits so a busy desktop session cannot block the worker from launching Tesseract. The one-shot CLI and packaged OCR smoke use the same limit function.

Optional resource identifiers are capability-checked. A platform that does not expose or rejects an optional ceiling retains all other controls, while failures to apply the portable four limits remain blocking. Existing lower host ceilings are never raised.

## Verification

- Ruff format and lint pass.
- All 34 development worker tests pass, including real image OCR, malformed-input gates, the supervised subprocess protocol, Linux optional-limit handling, the macOS omission gate, and server-startup invocation.
- The prior relocatable macOS arm64 worker resource passed its then-current 25-test offline gate; rebuilding the packaged matrix against this correction remains part of the candidate workflow.
- The contained packaged smoke passes with RapidOCR 3.9.2, three OCR items, and one canonical page.
- Linux x64 CI builds the same relocatable resource, passes all 25 tests and offline OCR, starts the compiled workbench, then repeats installed-resource discovery and OCR from an unpacked Electron application. Workflow run 32754039748 passed.
- A real macOS desktop run showed why neither optional ceiling is safe there: the fixed address-space ceiling conflicts with Apple ARM64's pre-reserved map, while the process ceiling counts the whole logged-in user session and blocked Tesseract from starting. macOS therefore retains the four portable limits and keeps memory/process-tree containment open.

## Remaining release gate

This milestone does not provide network denial, a job-scoped filesystem namespace, enforceable macOS/Windows memory/process-tree containment, disk quotas, crash recovery, or a reviewed malicious-format corpus. SEC-02 therefore remains partial.
