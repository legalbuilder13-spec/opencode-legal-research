# ADR 0012: matter-scoped local-only mode

Status: accepted

Date: 2026-08-24

## Decision

Persist `localOnly` as a matter research default. Local-only matters retain local source capture, OCR, parsing, storage, retrieval, inspection, and export, but the host rejects subscription-backed answer creation before it constructs or sends model context. The workbench disables the drafting control, labels the matter and reason, hides the ChatGPT egress acknowledgement for that matter, and distinguishes optional CourtListener query egress from model egress.

Changing accounts, archiving, or restarting the application does not alter the setting. A user must explicitly edit the matter to re-enable ChatGPT drafting. No silent local generative fallback is claimed because the alpha does not bundle a local language model.

## Evidence

- Core restart coverage persists the local-only research default.
- `WB-10` proves the answer endpoint rejects before the synthesizer is invoked and preserves the matter.
- Browser verification confirms the visible local-only label, explanatory copy, and disabled drafting control without console errors.
