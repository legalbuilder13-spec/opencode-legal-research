# Corpus changelog

## 0.2.0-synthetic — 2026-08-24

- Expanded the deterministic adversarial scaffold from six to 24 executable cases.
- Added prompt-injection, active/malformed PDF and DOCX, structural HTML, resource-exhaustion, image, hash, capture, and fabricated-anchor cases.
- Required every adversarial record to name an executable test reference and explicit review state.
- Added worker preflight and synthesis-envelope regression tests; security and attorney adjudication remain pending.

## 0.1.0-synthetic — 2026-08-23

- Added three generated PDF source versions with fixed hashes.
- Added two draft research questions, including an insufficient-evidence case.
- Added six deterministic safety cases.
- Added validation that prevents draft annotations from being presented as attorney-approved.
