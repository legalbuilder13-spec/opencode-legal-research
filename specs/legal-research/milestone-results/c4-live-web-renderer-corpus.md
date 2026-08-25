# Milestone C4: candidate live-web renderer/OCR corpus

Status: macOS arm64 candidate revalidated; reviewer adjudication and other supported-platform runs pending

Date: 2026-08-24

## Delivered gate

The versioned `legalbuilder-live-web-v0` manifest and desktop runner now exercise real public pages through the pinned Electron renderer. Every case checks the final host, status, render time, required serialized-HTML text, actual PNG signature/dimensions/size/pixel bound, and content hashes. With a packaged evidence worker configured, the same PNG is parsed offline by Docling/RapidOCR and the receipt checks required OCR text while recording engine/parser versions, item counts, time, and normalized-text hashes.

The runner writes HTML, PNG, worker page evidence, and a machine-readable receipt to a caller-selected output directory. It fails closed on contract, host, text, OCR, timing, or image-boundary changes. Live sites are intentionally excluded from ordinary deterministic CI; the checked-in manifest and validation code are CI typechecked, while reviewers run the live gate deliberately and preserve the resulting receipt.

## 2026-08-24 candidate result

Runtime: Electron 42.3.3 / Chromium 148.0.7778.218 on macOS arm64; packaged Docling 2.121.0 and RapidOCR 3.9.2 Latin/PyTorch.

| Case                            | Class                     |   Render | PNG                            |                  OCR | Required evidence                  |
| ------------------------------- | ------------------------- | -------: | ------------------------------ | -------------------: | ---------------------------------- |
| `control-example-domain`        | control                   | 1,091 ms | 2,880 × 1,736; 44,232 bytes    |   10,092 ms; 2 items | `Example Domain`                   |
| `cornell-us-constitution-index` | secondary legal reference | 1,736 ms | 2,880 × 6,698; 1,319,679 bytes | 15,688 ms; 101 items | `U.S. Constitution`; `Article III` |
| `scotus-opinions-index`         | primary government        | 1,536 ms | 2,880 × 3,558; 2,483,522 bytes |  14,503 ms; 26 items | `Opinions`; `Supreme Court`        |

All three final hosts and HTML assertions passed. The Cornell page attempted advertising/safeframe subresources that the active-channel policy blocked; the legal page HTML and visual/OCR evidence remained complete enough to satisfy the candidate assertions.

## Remaining gate

The same three sources passed again on macOS arm64 on 2026-08-25. ADR 0026 adds a manual macOS/Windows/Linux workflow that preserves per-platform receipts for review. This result remains evidence about three live pages, not attorney or security approval. Reviewers still need to adjudicate the source/access choices, expected passages, structural/visual agreement, cookie/banner and blocked-subresource behavior, long-page fidelity, acceptable OCR thresholds, and drift policy. The corpus must expand to redirects, adverse failures, multiple legal publishers/courts, and supported operating systems before ING-04 can pass fully.
