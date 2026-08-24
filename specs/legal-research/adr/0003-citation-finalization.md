# ADR 0003: Citation anchor and finalization protocol

Status: accepted for production implementation
Date: 2026-08-23

## Decision

Represent citations as application-minted database records linked through `assistant_message → claim → claim_evidence → passage`. The model may return answer spans, opaque passage IDs, and evidence relationships, but it cannot mint citation IDs, footnote numbers, source labels, quotations, locations, or trust states.

Persist streamed text as `provisional`. Finalization is one database transaction that validates claim offsets, passage existence, source availability, and passage hashes before it creates any citation anchor. Interrupted messages remain non-final and model-written Markdown footnotes remain inert prose.

Use explicit final answer offsets rather than parsing citation syntax from streamed Markdown. A claim may retain multiple `supports`, `qualifies`, and `contradicts` relationships. Resolve hover and click content only from persisted passage, source-version, representation, and region rows.

## State transition

```text
stream starts
    |
    v
provisional message ---- interruption ----> interrupted / no anchors
    |
    | final structured selections
    v
validate offsets + IDs + hashes + source availability
    |                         |
    | all/partial valid       | invalid evidence
    v                         v
persist claims         record unverified result
    |
    v
mint anchors only for claims with valid persisted evidence
    |
    v
finalized (source-complete only if every material claim is supported or qualified)
```

## Evidence

The SQLite vertical prototype consumes TS-02 representations directly and passes all sixteen deterministic adversarial cases. It proves multiple sources, qualifications and contradictions, fake-footnote rejection, unknown-ID and stale-hash rejection, interruption safety, duplicate-text identity, OCR-normalized labeling, coordinate-free fallback, restart durability, source deletion behavior, uncited-context logging, and the material-claim coverage gate.

The tested UI reads exact passages from persistence, exposes every relationship on hover/focus, and opens the canonical page image using stored coordinates. Browser verification found and fixed an empty-state layering defect before acceptance.

## Consequences

- Citation identity is independent from answer formatting and model prose.
- Claim support, quote fidelity, citation resolution, source integrity, and legal treatment remain distinct states.
- Deleting a source version makes prior evidence visibly unavailable instead of leaving an ordinary-looking citation.
- Coordinate-free structural sources keep hover evidence but use an explicit fallback rather than quote search.
- Messages reference content-addressed evidence rather than duplicating source payloads.
- Production streaming needs a final structured replacement/finalization event; provisional inline markers are never promoted implicitly.

## Production implementation map

| Prototype concern                  | Production boundary                                               |
| ---------------------------------- | ----------------------------------------------------------------- |
| SQLite migrations and repositories | new legal evidence package, called from the OpenCode server layer |
| message and claim finalization     | legal-mode session service and app-server event adapter           |
| passage interception               | centralized tool/source materialization middleware                |
| citation and ledger API            | server routes with matter authorization                           |
| hover cards and viewer             | session UI legal-mode components                                  |
| page assets                        | content-addressed blob service with integrity checks              |
| provenance export                  | matter export service using the same persisted IDs                |

## Re-evaluation triggers

Revisit span mapping if the selected model protocol cannot reliably return UTF-16 answer offsets, if collaborative editing is introduced, or if a richer annotation protocol can preserve the same fail-closed guarantees with fewer finalization retries.
