# Recovery and lifecycle controls

Status: synthetic product gate passed; live expiry/cancellation fixtures pending

Date: 2026-08-24

## Result

The workbench now presents subscription readiness as an operational state rather than a generic account label. Ready, signed-out, wrong-account, usage-limited, and unavailable states have distinct language and recovery guidance. Drafting is disabled until the ChatGPT subscription is ready and never falls back to API-key billing.

Before first drafting use, a blocking acknowledgement identifies the active ChatGPT subscription plan, explains that only selected materialized matter passages leave the device, distinguishes local OCR/storage/retrieval, and separately discloses CourtListener query egress. The acknowledgement persists locally across reload.

Source and matter deletion now require an explicit confirmation, state the searchable scope, and disclose content-addressed blob retention. Source deletion reports the number of other live references to the blob. Matter deletion reports retained and cross-matter shared blob counts. A shared-reference test confirms that removing one source cannot break the other matter's evidence.

- Source removal and account readiness UI: [`workbench-assets/source-lifecycle.png`](./workbench-assets/source-lifecycle.png)
- First-use ChatGPT egress acknowledgement: [`workbench-assets/egress-consent.png`](./workbench-assets/egress-consent.png)

## Acceptance evidence

- Workbench integration tests reject incorrect source and matter confirmations.
- Deleted source versions disappear from matter export and retrieval candidates.
- Shared content remains hash-valid and readable from the remaining matter.
- Browser controls remain responsive with no horizontal overflow.
- Drafting remains disabled until the first-use egress acknowledgement is checked and confirmed.
- Browser and console checks passed; WCAG A/AA audit reported zero violations.

## Boundary

Live expired-token, plan-cancellation, and interrupted-turn fixtures remain necessary before AUTH-03 can be marked fully passed. Physical blob compaction remains a separate retention-policy operation; deletions truthfully report that blobs are retained until that operation exists.
