# Milestone C8 result: executable adversarial and malicious-source corpus

Date: 2026-08-24

Status: Deterministic synthetic gate passed; security and attorney review pending

Corpus version `0.2.0-synthetic` contains 24 executable safety cases. The set covers six source prompt-injection variants; active and malformed PDF/DOCX/HTML/image inputs; archive and image resource exhaustion; cross-matter and connector bypass; source-hash corruption; incomplete capture; and fabricated citation anchors. Every case names its expected control, executable test reference, and synthetic review state.

The worker preflight rejects recognizable PDF actions and embedded content, unsafe DOCX package structures and relationships, oversized image dimensions, and HTML extraction that attempts source-network access before complex conversion. The synthesis gate proves adversarial text remains a JSON value inside one explicit untrusted evidence envelope. Local verification passed all 33 worker tests, four synthesis tests, and four corpus-validation tests.

This milestone is engineering evidence only. It does not replace coverage-guided fuzzing, operating-system worker isolation, packaged cross-platform execution, security adjudication, or attorney review of the legal-research corpus.
