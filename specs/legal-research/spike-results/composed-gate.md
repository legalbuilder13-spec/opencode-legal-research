# Cross-spike composed gate

Status: passed on synthetic evidence
Date: 2026-08-23
Runner: [`../../../packages/legal-citation-spike/src/composed-gate.ts`](../../../packages/legal-citation-spike/src/composed-gate.ts)

## Result

The selected subscription, evidence-worker, and citation protocols completed one identity-preserving round trip. The run used the already-authenticated ChatGPT subscription and did not expose or require `OPENAI_API_KEY`.

## Gate trace

1. The Codex app-server adapter confirmed a ChatGPT account with plan type `prolite`.
2. The host loaded one native and one scanned TS-02 representation, preserving their source hashes, passage IDs, page images, and regions.
3. Four opaque persisted passages entered the synthetic evidence packet.
4. A live subscription-backed turn returned the fixed answer plus two structured claims.
5. Finalization persisted one qualified multi-source claim and one supported claim.
6. The application minted two citation anchors linked to three evidence records.
7. The fourth model-visible passage remained uncited but appeared in the sources-read ledger.
8. The SQLite store closed and reopened; the complete citation API view remained structurally identical.
9. The reopened store exported a receipt containing source-version hashes, passage hashes, retrieval event, relationships, verification states, and exact coordinates.

## Measured outcome

| Check                           | Result |
| ------------------------------- | -----: |
| Subscription-backed turn        |   Pass |
| API key required                |     No |
| Finalized citations             |      2 |
| Persisted evidence links        |      3 |
| Distinct model-visible passages |      4 |
| Source-complete                 |    Yes |
| Restart stable                  |    Yes |
| Provenance receipt              |   Pass |

## Artifacts

- [Redacted live-run summary](./composed-gate-assets/summary-live.json)
- [Synthetic-source provenance receipt](./composed-gate-assets/receipt-live.json)

The receipt contains only generated fixture content and opaque local identifiers. It excludes user identity, credentials, conversation transcript, and the app-server thread identifier.

## Scope of proof

This gate proves protocol composition on deterministic synthetic evidence. It does not satisfy the PRD's attorney-reviewed corpus, CourtListener, web capture, matter isolation, prompt-injection corpus, or production UI gates. Those remain production milestones rather than being inferred from this pass.
