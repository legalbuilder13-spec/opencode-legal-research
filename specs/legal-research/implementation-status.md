# Legal research implementation status

Last updated: 2026-08-24

| Workstream                                        | Status                                          | Evidence                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| TS-01 ChatGPT subscription backend                | Passed                                          | [`spike-results/ts-01.md`](./spike-results/ts-01.md)                                                         |
| TS-02 evidence worker and OCR                     | Conditional synthetic pass                      | [`spike-results/ts-02.md`](./spike-results/ts-02.md)                                                         |
| TS-03 citation finalization                       | Passed                                          | [`spike-results/ts-03.md`](./spike-results/ts-03.md)                                                         |
| Cross-spike composed gate                         | Passed on synthetic evidence                    | [`spike-results/composed-gate.md`](./spike-results/composed-gate.md)                                         |
| Milestone B evidence substrate                    | Core exit passed                                | [`milestone-results/b-evidence-substrate.md`](./milestone-results/b-evidence-substrate.md)                   |
| Milestone C local PDF ingestion                   | Synthetic UI flow passed                        | [`milestone-results/c-pdf-ingestion-integration.md`](./milestone-results/c-pdf-ingestion-integration.md)     |
| Milestone C2 multi-format ingestion/reprocessing  | Synthetic UI flow passed                        | [`milestone-results/c2-multi-format-ingestion.md`](./milestone-results/c2-multi-format-ingestion.md)         |
| Milestone C3 public-web capture                   | Structural flow and strict contract passed      | [`milestone-results/c3-public-web-capture.md`](./milestone-results/c3-public-web-capture.md)                 |
| Milestone D local retrieval and research planning | Synthetic exit passed                           | [`milestone-results/d-local-retrieval.md`](./milestone-results/d-local-retrieval.md)                         |
| Milestone F CourtListener research alpha          | Deterministic product flow passed               | [`milestone-results/f-courtlistener-connector.md`](./milestone-results/f-courtlistener-connector.md)         |
| Local legal workflow UI                           | Alpha integration passed                        | [`milestone-results/workbench-integration.md`](./milestone-results/workbench-integration.md)                 |
| Unified subscription answer transaction           | Live synthetic pass                             | [`milestone-results/unified-answer-transaction.md`](./milestone-results/unified-answer-transaction.md)       |
| Recovery and destructive lifecycle controls       | Synthetic product gate passed                   | [`milestone-results/g-recovery-lifecycle.md`](./milestone-results/g-recovery-lifecycle.md)                   |
| Matter-scoped local-only mode                     | Synthetic product gate passed                   | [`adr/0012-matter-local-only-mode.md`](./adr/0012-matter-local-only-mode.md)                                 |
| Readable provenance export                        | Synthetic product gate passed                   | [`milestone-results/e-readable-provenance-export.md`](./milestone-results/e-readable-provenance-export.md)   |
| Private-beta P1 controls                          | Synthetic product gates passed                  | [`milestone-results/h-private-beta-controls.md`](./milestone-results/h-private-beta-controls.md)             |
| ChatGPT account switching                         | Synthetic product gate passed                   | [`adr/0014-account-switching-boundary.md`](./adr/0014-account-switching-boundary.md)                         |
| Native desktop workbench companion                | Companion lifecycle gate passed                 | [`milestone-results/i-desktop-workbench-companion.md`](./milestone-results/i-desktop-workbench-companion.md) |
| Relocatable offline OCR worker                    | macOS arm64 passed; Linux x64 CI-gated          | [`adr/0016-relocatable-evidence-worker.md`](./adr/0016-relocatable-evidence-worker.md)                       |
| Supervised strict-visual Electron renderer        | Pinned alpha transaction passed; corpus partial | [`adr/0018-pinned-renderer-proxy.md`](./adr/0018-pinned-renderer-proxy.md)                                   |
| Parser resource and malformed-input hardening     | Local security gate passed                      | [`threat-model.md`](./threat-model.md)                                                                       |
| Primary OpenCode shell route                      | Alpha route implemented                         | [`adr/0010-primary-shell-route.md`](./adr/0010-primary-shell-route.md)                                       |
| Full desktop/worker/renderer installer packaging  | Partial                                         | [`adr/0016-relocatable-evidence-worker.md`](./adr/0016-relocatable-evidence-worker.md)                       |
| Evaluation corpus schema and validator            | Synthetic scaffold passed                       | [`corpus/v0/README.md`](./corpus/v0/README.md)                                                               |
| Attorney-reviewed release corpus                  | Pending external review                         | Evaluation plan                                                                                              |
| P0 release gate audit                             | Published                                       | [`release-gates.md`](./release-gates.md)                                                                     |

“Passed” refers only to the stated fixture scope. It does not convert open attorney-review, licensing, corpus, or platform-packaging gates into completed work.
