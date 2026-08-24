# Workbench integration result

Status: local alpha surface passed; unified live answer transaction pending

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

The browser reported no page errors. At a 390-pixel viewport, document width equaled viewport width with no horizontal overflow. Axe 4.12.1 reported 18 WCAG A/AA passes, zero incomplete checks, and zero violations after the contrast correction.

## Honest boundary

The local retrieval workflow and deterministic citation-finalization workflow are available in one UI but are not yet one atomic live answer transaction. Live subscription synthesis must next consume only retrieved passage envelopes, propose structured claims/evidence, and pass application finalization into persistent matter-owned citations. Main OpenCode shell packaging and localization follow that transaction.
