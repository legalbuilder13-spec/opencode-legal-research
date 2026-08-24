# ADR 0019: Bound evidence-worker address space and process count

Status: accepted for alpha integration; cross-platform sandbox incomplete

Date: 2026-08-24

## Decision

Request an 8 GiB virtual-address-space ceiling (`RLIMIT_AS`) and a 256-process ceiling (`RLIMIT_NPROC`) before the evidence worker imports Docling, PyTorch, image codecs, or document parsers. Preserve the existing CPU, output-file, core-dump, and descriptor limits. If a Unix-like platform does not expose or rejects either optional resource limit, retain the portable limits rather than preventing worker startup.

Never raise a pre-existing tighter host limit. The worker clamps each requested ceiling to the current hard limit and keeps any lower current soft limit. Linux accepts both ceilings. On Apple ARM64, the operating system reserves a shared virtual-address range larger than 8 GiB before worker startup and rejects that address-space limit, although it accepts the process limit. Windows requires a separate job-object/AppContainer implementation because Python's `resource` module is unavailable there.

## Evidence

- Unit tests prove both new limits are requested before parser construction, that the supervised server invokes them before accepting work, and that platforms without or rejecting optional identifiers retain the other controls.
- The development environment completes all 25 worker tests, including real image OCR and the supervised JSONL process boundary.
- A rebuilt 2.0 GB relocatable Python 3.14.3/Docling 2.121.0/RapidOCR 3.9.2 resource completes all 25 tests and an offline strict-visual OCR smoke on macOS arm64 while requesting the limits. The smoke returns three evidence items and one hashed canonical page.
- The repository's packaged-worker CI repeats the resource build, all 25 tests, offline OCR smoke, workbench discovery, and unpacked Electron installation gate on Linux x64, where `RLIMIT_AS` is enforceable. The complete remote workflow passed.

## Consequences and remaining gates

- A malformed source cannot make the Linux worker consume unbounded virtual memory or create an unbounded number of child processes under a normal unprivileged account. The macOS worker receives the process ceiling but still needs an enforceable memory boundary.
- `RLIMIT_AS` bounds virtual address space, not only resident memory. The 8 GiB value is intentionally above observed alpha OCR needs and must be re-evaluated against the supported-hardware corpus.
- `RLIMIT_NPROC` is an account-level Unix control and may not constrain privileged processes. The packaged desktop worker must run without elevated privileges.
- This is partial resource containment, not a complete parser sandbox. Enforceable macOS/Windows memory containment, network denial, a job-scoped read/write filesystem namespace, Windows process containment, disk quotas, crash recovery, and malicious-format fuzzing remain release gates.
