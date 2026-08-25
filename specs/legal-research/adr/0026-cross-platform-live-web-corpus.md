# ADR 0026: Run the live public-web renderer/OCR corpus as a manual review batch

Status: Cross-platform workflow accepted; macOS candidate revalidated; hosted matrix pending activation

Date: 2026-08-25

## Decision

Keep live public pages out of ordinary deterministic CI. Provide a separate manually dispatched `legal live-web corpus` workflow that builds the exact packaged offline evidence worker and runs the same renderer-to-OCR corpus on macOS arm64, Windows x64, and Linux x64. Linux runs Electron inside a virtual display; Windows resolves Electron through the installed package instead of assuming a Unix `.bin` launcher.

Restrict the workflow to the LegalBuilder fork and a short non-sensitive batch identifier. Every matrix job verifies the worker dependency/model receipt, uses the authenticated pinned Electron renderer, hashes the serialized HTML and screenshots, runs offline RapidOCR/Docling against each screenshot, and uploads the receipt plus public-source evidence for 30 days. The workflow never changes the corpus review state.

Live-site drift, timing, cookie banners, blocked subresources, and source availability are evidence to adjudicate, not reasons to silently relax an assertion. A failed batch requires reviewer analysis and an explicit corpus change if the source or expected evidence legitimately changed.

## Evidence

- The runner now resolves the platform's actual Electron executable and avoids Unix permission operations on Windows.
- The manual workflow and its expressions pass actionlint 1.7.12 and YAML parsing; desktop and workspace typechecks pass.
- A 2026-08-25 macOS arm64 run passed all three candidate cases with the packaged CPU-only worker: Example Domain (2 OCR items), Cornell's Constitution index (101 OCR items), and the Supreme Court opinions index (25 OCR items).
- All screenshots passed required text, PNG, dimension, byte-size, timing, final-host, and OCR assertions. Cornell advertising/safeframe channels remained blocked by the renderer policy while required legal content passed.

## Remaining release gate

The workflow file must reach the fork's default branch before GitHub exposes manual dispatch. Run and preserve the Windows and Linux receipts after activation. Security and legal reviewers must adjudicate every platform receipt and expand the corpus to redirects, long pages, reserved-address failures, additional courts/publishers, and source-drift cases. Passing three public pages is not broad web safety or legal-source approval.
