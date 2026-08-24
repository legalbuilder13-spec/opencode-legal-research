# Unified subscription answer transaction

Status: live synthetic gate passed

Date: 2026-08-24

## Result

The workbench now joins local retrieval and citation finalization in one matter-owned transaction. The default synthesizer starts a Codex app-server thread using the current ChatGPT subscription, sends only support-eligible persisted passage envelopes, accepts strict structured claims/evidence, recomputes exact answer offsets, and rejects any passage ID outside the admitted context.

Finalization writes the answer, subscription thread ID, retrieval run IDs, claims, evidence relationships, verification results, application citation anchors, and read/cited ledger entries to the same SQLite database as the matter and source passages. The answer and its citation identities survive restart. The combined export contains answer, verification, ledger, matter, sources, hashes, passages, and candidate rankings.

## Live no-key gate

The gate removed `OPENAI_API_KEY`, used generated public protocol evidence containing a source-borne instruction to bypass policy, and completed through the signed-in ChatGPT account without following the injected instruction:

| Check                           | Result                    |
| ------------------------------- | ------------------------- |
| Account                         | `chatgpt`, plan `prolite` |
| API key present                 | No                        |
| Answer HTTP/status              | `201`, `finalized`        |
| Source completeness             | Pass                      |
| Subscription thread persisted   | Pass                      |
| Application citations/evidence  | 2 / 2                     |
| Ledger read/cited               | 1 / 1                     |
| Retrieval runs linked           | 2                         |
| Source prompt injection ignored | Pass                      |

The redacted machine-readable result is [`workbench-assets/unified-live-gate.json`](./workbench-assets/unified-live-gate.json). It stores only counts, states, and an answer digest—not the prompt or answer text.

## Browser evidence

- Finalized matter answer and export control: [`workbench-assets/unified-answer.png`](./workbench-assets/unified-answer.png)
- Persisted answer restored in the evidence workspace: [`workbench-assets/current-answer-evidence.png`](./workbench-assets/current-answer-evidence.png)
- Structural source fallback for a text source: [`workbench-assets/unified-structural-evidence.png`](./workbench-assets/unified-structural-evidence.png)

The browser run had no page or console errors. Axe 4.12.1 again reported zero WCAG A/AA violations.

## Fail-closed controls

- Model output must be valid JSON with exact, unique answer substrings.
- Every selected passage ID must be in the support-eligible packet sent to the subscription model.
- Finalization independently checks matter ownership, context admission, capture completeness, source availability, and passage text hash.
- Model-written footnote syntax remains plain text and cannot create an anchor.
- Interrupted or invalid responses never become finalized citations.

## Remaining boundary

The gate is synthetic and proves the transaction, not substantive legal quality. The full attorney-adjudicated corpus, live CourtListener token run, strict visual web capture, production parser sandbox, and primary OpenCode shell packaging remain release work.
