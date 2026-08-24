# ADR 0005: Local hybrid retrieval and research lanes

Status: accepted for alpha; encoder re-evaluation required
Date: 2026-08-23

## Decision

Use matter-scoped SQLite FTS5 as the lexical retrieval baseline and combine it with a fully local deterministic semantic vector scorer. Fuse lexical and semantic ranks with reciprocal-rank fusion, then rerank using query coverage, primary-authority preference, and an explicit adverse-material lane.

The alpha semantic vector is a hashed bag of normalized legal terms plus a small transparent synonym expansion. It is offline, deterministic, inspectable, and credential-free. It proves the retrieval and logging contract but is not selected as the final quality encoder. A stronger local embedding model may replace it only if it preserves matter isolation, reproducibility, and the same logged candidate contract.

Apply jurisdiction, court, decision-date, authority-type, and precedential-status filters before ranking. Limit passages per source version to preserve diversity. Add neighboring passages only after selection and log candidates, both ranks, fused/rerank scores, selections, and every passage sent to the model.

Run primary and adverse research as distinct inspectable lanes. Record when a secondary source leads to a materialized primary source. Mark incomplete-source/search-snippet passages ineligible for verified claim support even if they are retrievable as leads.

## Evidence

Deterministic tests prove:

- FTS5 and local semantic ranking work with no embedding or OpenAI API credential;
- all legal filters alter results deterministically;
- selected passages and neighboring context are recorded separately;
- a per-source cap preserves source diversity;
- issue plans retain jurisdiction, as-of date, and procedural posture;
- adverse terms raise limiting authority in the adverse lane;
- secondary-to-primary chains persist; and
- snippet-only content remains support-ineligible.

## Consequences

- Retrieval remains available offline and has no paid embedding dependency.
- The local alpha encoder favors reproducibility and architecture proof over corpus-level semantic quality.
- Stored rankings can be replayed and evaluated without reconstructing model context.
- Primary-source preference is an explicit score and research-chain concern, not a prompt-only instruction.
- A future local encoder change requires a versioned evaluation and migration strategy; stored passage identity does not change.

## Re-evaluation triggers

Replace or supplement the alpha encoder after benchmarking candidate local models on the attorney-reviewed corpus. Revisit the reranker when real-query nDCG, adverse-authority recall, or latency misses the evaluation-plan thresholds.
