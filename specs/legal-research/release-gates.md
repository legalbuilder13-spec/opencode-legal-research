# P0 release gate matrix

Date: 2026-08-23

Legend: **Pass** means the stated automated or documented acceptance evidence exists for its stated fixture scope. **Partial** means a core control exists but the full product, corpus, live-service, or user-flow gate remains. **Open** means no qualifying acceptance evidence exists yet.

| IDs                           | Status  | Current evidence                                                                                                                         | Remaining gate                                                                        |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| AUTH-01, AUTH-04              | Pass    | TS-01 live no-key turn/resume and ADR 0001                                                                                               | Repeat on every supported clean-install profile before release.                       |
| AUTH-02                       | Pass    | Workbench visibly labels ChatGPT subscription mode and does not present subscription as API credit.                                      | Main-shell settings packaging.                                                        |
| AUTH-03                       | Partial | Adapter distinguishes account, rate-limit, RPC, and terminal turn states.                                                                | Recoverable expired-login/cancellation/limit UI states.                               |
| MAT-01, MAT-02                | Partial | Core persists create/edit/archive/reopen/defaults; workbench creates/opens/displays defaults.                                            | Workbench rename/archive/edit controls and restart browser test.                      |
| MAT-03                        | Pass    | Cross-matter passage, source, retrieval, and API tests.                                                                                  | —                                                                                     |
| SRC-01                        | Partial | Core accepts required MIME types; PDF pipeline and text UI tested.                                                                       | User-facing image/HTML/DOCX/PDF upload flow.                                          |
| SRC-02                        | Pass    | Web envelope persists body, requested/final/canonical URLs, time, MIME, status, and hash.                                                | Strict visual web capture is ING-04.                                                  |
| SRC-03                        | Partial | CourtListener v4 search/full-opinion adapter passes deterministic tests.                                                                 | Live token smoke test and reviewed opinion corpus.                                    |
| SRC-04–SRC-07                 | Pass    | Materialization interception, immutable versioning, rehash, deduplication, and incomplete-status exclusion tests.                        | Surface all access notes in production UI.                                            |
| ING-01–ING-03, ING-05, ING-08 | Pass    | TS-02 native/scanned/mixed fixtures preserve passages, hashes, pages, regions, page images, modes, and parser/OCR versions.              | Full document corpus and supported-hardware run.                                      |
| ING-04                        | Open    | —                                                                                                                                        | Rendered web snapshot, page images, OCR, and structural HTML in strict mode.          |
| ING-06, ING-07                | Partial | Worker records quality metrics/warnings and immutable reprocessing modes.                                                                | UI warnings, language hints, reprocess controls, and broader failure corpus.          |
| RET-01–RET-04                 | Pass    | 9 retrieval/workflow tests; local FTS5 + semantic fusion/rerank; filters, logging, context, diversity.                                   | Attorney-corpus threshold.                                                            |
| RES-01–RES-04                 | Pass    | Inspectable planner, adverse lane, authority lead, and snippet-ineligibility tests; workbench UI.                                        | Attorney-reviewed end-to-end completeness score.                                      |
| CIT-01–CIT-07                 | Pass    | TS-03 claim/evidence/finalization tests, restart test, browser citation cards and exact-region navigation.                               | Join finalization to live matter answers.                                             |
| VER-01–VER-06                 | Pass    | TS-03 identity, quote, relationship, coverage, resolution/treatment separation, and visible failure tests.                               | Attorney-scored support thresholds and production treatment provider decision.        |
| LED-01, LED-02                | Partial | Citation demo ledger and core retrieval run/candidate export are reproducible.                                                           | One transaction linking live turn, retrieval, claims, citations, and verifier output. |
| PER-01                        | Partial | Core matter/source persistence and TS-03 citation restart durability pass separately.                                                    | Unified answer transaction restart test.                                              |
| PER-02                        | Pass    | Messages/ledgers reference source and passage identities; blob bytes remain content addressed.                                           | —                                                                                     |
| EXP-01                        | Partial | Matter provenance export includes sources, hashes, passages, retrieval runs/scores; TS-03 exports answer citations/verifiers separately. | Unified human-readable answer plus provenance receipt.                                |
| SEC-01                        | Partial | Source envelopes are marked untrusted; adversarial schema and interception controls exist.                                               | Live-model prompt-injection execution suite.                                          |
| SEC-02                        | Partial | CourtListener HTML parsing is inert and source viewers use stored page images.                                                           | Sandboxed worker and malicious-format corpus.                                         |
| SEC-03                        | Pass    | Workbench discloses ChatGPT workspace and CourtListener query egress.                                                                    | First-run acknowledgement/policy configuration.                                       |
| SEC-04                        | Pass    | Automated core check confirms no raw source text in default diagnostics.                                                                 | Production telemetry audit.                                                           |
| SEC-05                        | Partial | Core deletion reports scope and retained-blob policy.                                                                                    | Explicit UI confirmation and shared-reference/compaction tests.                       |

## Release blockers

The fork is not ready to call the PRD complete or to market as a Harvey/Legora replacement. The blocking work is:

1. unify live subscription synthesis, retrieved passages, finalization, ledger, and export in one matter-owned transaction;
2. complete strict visual web capture and the user-facing multi-format ingestion/reprocessing flow;
3. run live CourtListener acquisition with an authorized token;
4. assemble and attorney-adjudicate the full document/question/adversarial corpus and meet its thresholds;
5. complete worker sandboxing, malformed-input security tests, and organizational ChatGPT workspace policy;
6. package and localize the legal route in the primary OpenCode shell.
