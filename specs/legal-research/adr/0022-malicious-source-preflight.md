# ADR 0022: Reject recognizable active and structurally unsafe sources before parsing

Status: Deterministic alpha gate accepted; fuzzing and review pending

Date: 2026-08-24

## Decision

Run a conservative, bounded preflight before constructing Docling or image decoders. PDF input must expose a PDF header in its first 1,024 bytes and must not contain recognizable declarations for JavaScript, launch/open/additional actions, embedded files, rich media, XFA, or encryption. DOCX input must be a bounded ZIP package with unique contained paths, no symlinks or encrypted entries, bounded XML parts, no macros/embeddings/ActiveX, no DTD or entity declarations, and no external relationships except ordinary hyperlinks. Image admission converts decompression-bomb warnings into a bounded failure. Structural HTML extraction must not fetch subresources and continues to discard scripts and styles.

Failures are visible ingestion failures; the worker does not silently downgrade or extract a subset from a rejected source. These controls reduce exposure before complex parsers run. They are deliberately conservative and are not a claim that byte-token scanning sanitizes all valid PDFs or detects obfuscated active content.

Source text supplied to synthesis remains data inside an explicit `untrustedSourceData` JSON envelope. Host policy is written before that envelope, synthesis has no tool authorization, and the application—not the model—validates persisted passage identities and mints final citation anchors.

## Current evidence

- Thirty-three Python worker tests pass, including deterministic PDF, DOCX, image, archive, and structural-HTML security cases plus real local OCR.
- Twenty-four corpus records now include a concrete payload, expected control, executable test reference, and explicit synthetic review state.
- Six prompt-injection variants round-trip through JSON serialization without creating another policy section or escaping the untrusted evidence envelope.
- The corpus validator fails records that omit their payload, executable test reference, or review state.

## Remaining gate

Add coverage-guided and parser-specific fuzzing, isolate worker network and filesystem access at the OS boundary, enforce memory/process containment on macOS and Windows, run the cases across packaged platforms, and obtain security and attorney adjudication. The synthetic corpus must never be described as reviewed legal-quality or production security assurance.
