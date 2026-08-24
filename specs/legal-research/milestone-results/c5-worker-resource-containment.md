# Milestone C5 result: evidence-worker resource containment

Date: 2026-08-24

Status: macOS arm64 packaged process gate and Linux x64 memory/process gate passed; full parser sandbox partial

## Implemented boundary

The real supervised JSONL server now applies the existing CPU, output-file, core-dump, and descriptor limits before accepting work. It also requests an 8 GiB virtual-address-space ceiling and a 256-process ceiling before Docling or PyTorch model construction. The one-shot CLI and packaged OCR smoke use the same limit function.

Optional resource identifiers are capability-checked. A platform that does not expose or rejects an optional ceiling retains all other controls, while failures to apply the portable four limits remain blocking. Existing lower host ceilings are never raised.

## Verification

- Ruff format and lint pass.
- All 25 development worker tests pass, including real image OCR, malformed-input gates, the supervised subprocess protocol, optional-limit rejection, and server-startup invocation.
- A fresh 2.0 GB relocatable macOS arm64 worker resource passes all 25 tests offline.
- The contained packaged smoke passes with RapidOCR 3.9.2, three OCR items, and one canonical page.
- Linux x64 CI builds the same relocatable resource, passes all 25 tests and offline OCR, starts the compiled workbench, then repeats installed-resource discovery and OCR from an unpacked Electron application. Workflow run 32754039748 passed.
- macOS accepts the 256-process ceiling. Apple ARM64's pre-reserved shared virtual-address map causes the kernel to reject an 8 GiB `RLIMIT_AS`; the worker continues under the remaining limits and the documentation records that gap.

## Remaining release gate

This milestone does not provide network denial, a job-scoped filesystem namespace, enforceable macOS/Windows memory containment, Windows process containment, disk quotas, crash recovery, or a reviewed malicious-format corpus. SEC-02 therefore remains partial.
