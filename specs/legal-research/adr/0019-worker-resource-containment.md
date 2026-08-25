# ADR 0019: Bound Linux worker resources and preserve portable Unix limits

Status: accepted for alpha integration; cross-platform sandbox incomplete

Date: 2026-08-24

## Decision

On Linux, request an 8 GiB virtual-address-space ceiling (`RLIMIT_AS`) and a 256-process ceiling (`RLIMIT_NPROC`) before the evidence worker imports Docling, PyTorch, image codecs, or document parsers. Preserve the CPU, output-file, core-dump, and descriptor limits on every Unix-like platform. macOS omits the two optional ceilings because its process address map is incompatible with the fixed address-space value and its per-user `RLIMIT_NPROC` can prevent Tesseract from starting when the logged-in desktop session already has many processes.

Never raise a pre-existing tighter host limit. The worker clamps each requested Linux ceiling to the current hard limit and keeps any lower current soft limit. Windows requires a separate job-object/AppContainer implementation because Python's `resource` module is unavailable there.

## Evidence

- Unit tests prove both optional limits are requested on Linux before parser construction, that macOS omits them, that the supervised server invokes the policy before accepting work, and that missing or rejected optional identifiers retain the other controls.
- The development environment completes all 34 worker tests, including real image OCR and the supervised JSONL process boundary.
- A macOS desktop strict-visual OCR transaction now completes with Tesseract 5.5.2, three persisted evidence items, one hashed canonical page, and an exact citation-region round trip under the portable limits.
- The repository's packaged-worker CI previously proved the relocatable RapidOCR resource, offline OCR smoke, workbench discovery, and unpacked Electron installation gate on Linux x64, where the optional ceilings are enforceable. Rebuilding the packaged cross-platform matrix remains part of the release-candidate gate.

## Consequences and remaining gates

- A malformed source cannot make the Linux worker consume unbounded virtual memory or create an unbounded number of child processes under a normal unprivileged account. macOS still needs enforceable memory and process-tree boundaries.
- `RLIMIT_AS` bounds virtual address space, not only resident memory. The 8 GiB value is intentionally above observed alpha OCR needs and must be re-evaluated against the supported-hardware corpus.
- `RLIMIT_NPROC` is an account-level Unix control and may not constrain privileged processes. The packaged desktop worker must run without elevated privileges.
- This is partial resource containment, not a complete parser sandbox. Enforceable macOS/Windows memory and process-tree containment, network denial, a job-scoped read/write filesystem namespace, disk quotas, crash recovery, and malicious-format fuzzing remain release gates.
