# Workbench integration result

Status: local alpha surface and unified live answer transaction passed on synthetic evidence

Date: 2026-08-23

## Delivered

- Responsive legal workbench with Research, Sources, Evidence, and Matters views.
- ChatGPT subscription entitlement display with no API-key requirement.
- Persistent matter creation/opening and matter-scoped source capture.
- SHA-256 source identity, immutable local blobs, and source status display.
- Inspectable issue planning with primary and adverse research lanes.
- Local hybrid retrieval with support-eligibility labels.
- Application-minted multi-passage citation cards, OCR/native source states, exact page image, and bounding-box highlight.
- Sources-read ledger and JSON provenance export including retrieval runs and candidate scores.
- Subscription-backed synthesis constrained to admitted passage IDs, with matter-owned finalization and combined answer receipt.

## Automated verification

- Workbench: 3 tests, 20 assertions.
- Legal research core: 24 tests, 63 assertions.
- Type checks: workbench and core pass.
- Lint: zero warnings/errors for the changed packages.

## Browser verification

The full workflow created a privileged matter, captured and hashed a source, ran issue planning and both retrieval lanes, opened an OCR-normalized citation, and rendered its exact page region.

- Desktop research result: [`workbench-assets/research.png`](./workbench-assets/research.png)
- Exact evidence region: [`workbench-assets/evidence.png`](./workbench-assets/evidence.png)
- Mobile layout: [`workbench-assets/mobile.png`](./workbench-assets/mobile.png)
- Unified answer: [`workbench-assets/unified-answer.png`](./workbench-assets/unified-answer.png)

The browser reported no page errors. At a 390-pixel viewport, document width equaled viewport width with no horizontal overflow. Axe 4.12.1 reported 18 WCAG A/AA passes, zero incomplete checks, and zero violations after the contrast correction.

## Honest boundary

The transaction now works through the live signed-in ChatGPT subscription and persists matter-owned citations. This proves protocol composition on generated evidence. It does not establish corpus-wide legal quality, treatment accuracy, production parser security, or live CourtListener completeness. Main OpenCode shell packaging and localization also remain.
