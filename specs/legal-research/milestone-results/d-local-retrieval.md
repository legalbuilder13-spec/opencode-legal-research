# Milestone D result: Local retrieval and structured evidence

Status: synthetic exit passed; attorney corpus pending
Date: 2026-08-23
Package: [`../../../packages/legal-research-core`](../../../packages/legal-research-core)
ADR: [`../adr/0005-local-retrieval.md`](../adr/0005-local-retrieval.md)

## Result

The local core now provides matter-scoped FTS5 retrieval, deterministic local semantic vectors, reciprocal-rank fusion, legal reranking, metadata filters, source diversity, neighboring context, complete candidate/context logs, issue planning, a separate adverse-material lane, and secondary-to-primary lead records.

The synthetic Milestone D exit condition passes: evaluated fixture questions return their expected passages without a paid embedding API or configured embedding credential.

## Requirement evidence

| Requirement | Result         | Evidence                                                                                                  |
| ----------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| RET-01      | Synthetic pass | FTS5 plus local hashed semantic vectors rank the expected authority without `OPENAI_API_KEY`.             |
| RET-02      | Pass           | Jurisdiction, court, dates, type, and precedential status filter before ranking.                          |
| RET-03      | Pass           | Candidate ranks/scores, selected passages, neighbors, and sent-to-model state persist.                    |
| RET-04      | Pass           | Configurable per-source cap returns diverse authorities.                                                  |
| RES-01      | Core pass      | Issue plan exposes question, issues, jurisdiction/date/posture assumptions, and lanes.                    |
| RES-02      | Core pass      | Primary sources receive a rank preference and secondary-to-primary chains persist.                        |
| RES-03      | Synthetic pass | Explicit adverse query lane boosts exception, limitation, contrary, distinguishing, and overruling terms. |
| RES-04      | Pass           | `fullSource: false` results remain support-ineligible.                                                    |
| LED-01      | Retrieval pass | Every context passage is stored with `sent_to_model = 1`.                                                 |
| LED-02      | Retrieval pass | Query, filters, lexical/semantic ranks, fusion, rerank, selection, and context share one run ID.          |

## Verification

- 9 retrieval/research tests plus 9 substrate tests: 18 passing, 44 assertions.
- Strict type check, Oxlint, and Prettier pass.
- Matter-isolation regression passes.
- No model, network, local model download, or embedding credential is required.

## Limits

The transparent hashed semantic encoder is an alpha architecture baseline, not a claim of state-of-the-art legal retrieval. It must be compared with stronger local embedding and reranking models on attorney-labeled questions. CourtListener metadata quality, adverse-treatment evaluation, and the user-facing research-progress interface remain Milestone F/integration work.
