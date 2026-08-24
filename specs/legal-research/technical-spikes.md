# Legal Research MVP Technical Spikes

Status: proposed v0.1

Product requirements: [`prd.md`](./prd.md)

Architecture: [`architecture.md`](./architecture.md)

Target branch: `legal-research`

Last updated: 2026-08-23

## 1. Purpose

Resolve the three highest-risk technical assumptions before production implementation:

1. A ChatGPT subscription can reliably power the fork through the documented Codex app-server without an OpenAI API key.
2. Docling can produce the text, page provenance, and coordinates needed for exact passage review across representative legal documents.
3. A persisted claim-to-passage model can drive finalized citation anchors, multi-passage hover cards, and exact source highlighting without trusting model-written footnotes.

These are evidence-producing experiments, not miniature production implementations. Each spike must end with reproducible fixtures, measurements, recorded limitations, and a decision. Prototype code may be discarded; test assets, protocol transcripts with secrets removed, results, and ADRs remain.

## 2. Operating rules

- Timebox each spike. Stop when its decision question is answered, even if the prototype could be polished further.
- Do not add a production dependency during a spike without a separate review.
- Use fixture credentials and redacted protocol logs. Never commit ChatGPT tokens, session cookies, user source content, or API keys.
- Record exact versions: OpenCode commit, Codex CLI/app-server, generated protocol schema, Docling, OCR engine/model, Python, Bun, OS, architecture, and accelerator.
- Prefer stable documented protocol surfaces. Experimental methods require a separate justification and cannot become an unstated release dependency.
- Preserve raw inputs and immutable expected outputs for deterministic comparisons.
- Distinguish a product failure from an environmental limitation such as unavailable network, unsupported hardware, or account policy.
- A spike passes only when another developer can reproduce its result from written instructions.
- Use conventional commits and repository-compliant branch names of three words or fewer.

## 3. Summary and order

| Spike | Decision | Depends on | Suggested timebox | Required output |
|---|---|---|---:|---|
| TS-01 | Select the default ChatGPT-subscription backend. | None | 3 engineering days | Harness, redacted transcripts, compatibility matrix, ADR |
| TS-02 | Select the Docling/OCR pipeline and provenance contract. | Gold document fixtures | 5 engineering days | Worker prototype, fixture results, performance report, ADR |
| TS-03 | Select the citation persistence and finalization design. | Minimal TS-02 output contract | 5 engineering days | Vertical prototype, adversarial tests, UI recording, ADR |

TS-01 and the fixture preparation for TS-02 can begin independently. TS-03 should consume the provenance shape proven by TS-02 rather than inventing a second coordinate model.

## 4. TS-01 — ChatGPT subscription through Codex app-server

### Decision question

Can the fork use Codex app-server as its default local model-execution boundary for authentication, streamed conversation, restart recovery, cancellation, and plan-limit display without requiring an OpenAI API key?

### Why this is risky

OpenCode already has a working ChatGPT Plus/Pro OAuth provider, but it directly targets a private ChatGPT Codex backend. Codex app-server is the documented product-embedding boundary and lets Codex own ChatGPT login and token refresh. The integration still introduces a supervised child process, a versioned protocol, a second conversation identity, and event translation into OpenCode's session model.

### Official baseline

As of the date of this specification:

- Codex officially supports ChatGPT sign-in for subscription access and API-key sign-in for usage-based access.
- App-server is intended for deep product integrations involving authentication, history, approvals, and streamed events.
- The default local transport is newline-delimited JSON over stdio.
- The current official page also labels the app-server command and WebSocket transport experimental and unsupported for production workloads. That maturity warning is a decision input, not something this spike may ignore.
- Clients initialize once, then start or resume threads and start turns while consuming item and turn notifications.
- The CLI can generate TypeScript or JSON Schema artifacts specific to the installed Codex version.
- Managed ChatGPT browser and device-code login, logout, account state, and rate-limit reads are exposed through the account JSON-RPC surface.
- WebSocket transport and externally managed ChatGPT tokens are experimental and are excluded from this spike.

### Hypotheses

- H1: A clean local profile can complete managed ChatGPT login and one model turn without `OPENAI_API_KEY` or an API-key credential.
- H2: A single supervised stdio process can support the session lifecycle needed by the MVP.
- H3: OpenCode sessions can persist a Codex thread ID and resume it after both app-server and application restart.
- H4: Agent-message deltas, completion, errors, cancellation, and rate-limit states can be translated without scraping text output.
- H5: A pinned Codex version plus generated schemas can make protocol incompatibility fail clearly at startup.

### Prototype boundary

Build a narrow adapter harness outside the production provider path. It should:

1. Locate an allowed Codex binary and record its version and hash.
2. Generate TypeScript protocol bindings into a temporary or spike-owned generated directory.
3. Start `codex app-server` using the default stdio transport.
4. Send `initialize`, then `initialized`, without enabling `experimentalApi`.
5. Read account state.
6. Exercise browser login and device-code login as separate cases.
7. Start a thread and streamed turn.
8. Persist the returned thread ID in a spike-local store.
9. Stop and restart app-server, resume the thread, and run a second turn.
10. Interrupt an active turn and observe its terminal state.
11. Read ChatGPT rate-limit state and map it to a small neutral UI model.
12. Logout and confirm subsequent execution requires authentication.

The harness must not yet expose legal tools, dynamic tools, MCP orchestration, shell approvals, or production UI.

### Required test cases

| ID | Scenario | Expected evidence |
|---|---|---|
| AS-01 | Start with no cached auth and no OpenAI API key. | `account/read` shows signed out; environment snapshot proves the key is absent. |
| AS-02 | Complete managed browser login. | Login completion and account update show ChatGPT auth mode and available plan type. |
| AS-03 | Cancel browser login. | The pending login reaches a distinct unsuccessful terminal state without hanging the adapter. |
| AS-04 | Complete device-code login. | Verification URL/code are surfaced; completion produces managed ChatGPT auth. |
| AS-05 | Start a thread and turn. | One agent answer streams through structured notifications and reaches completed status. |
| AS-06 | Preserve ordering under streaming. | Reassembled agent text and item lifecycle match the final turn record with no duplicate deltas. |
| AS-07 | Interrupt a long turn. | The adapter sends turn interruption and receives a terminal interrupted/cancelled outcome within the timeout. |
| AS-08 | Restart app-server and resume. | A persisted thread ID resumes and accepts a new turn after process restart. |
| AS-09 | Restart the host application. | The OpenCode-side mapping restores without creating a duplicate thread or losing prior messages. |
| AS-10 | Read rate limits. | The adapter exposes used percentage, window/reset data when available, and a clear unavailable state otherwise. |
| AS-11 | Expire or invalidate auth. | Authorization failure becomes a reauthentication state; secrets do not appear in logs. |
| AS-12 | Kill app-server mid-turn. | The host reports model execution interrupted, keeps the admitted user request durable, and can safely restart. |
| AS-13 | Run with an incompatible schema/version. | Startup fails with a clear compatibility message before a legal-research turn begins. |
| AS-14 | Logout. | Account state clears while local matters and source records remain intact. |

### Event mapping to prove

| App-server concept | OpenCode target concept | Proof required |
|---|---|---|
| Thread ID | External execution-thread reference on a session | Stable one-to-one mapping across restart |
| Turn ID | Provider execution record | One durable execution identity per provider turn |
| Agent-message delta | Assistant message stream part | Ordered, idempotent append |
| Item start/completion | Tool/reasoning/status event | No invented lifecycle from text parsing |
| Turn completion | Session execution boundary | Exactly one terminal transition |
| Turn interruption | User cancellation | No later delta accepted as ordinary completion |
| Account update | Authentication state | Active mode and plan displayed without tokens |
| Rate-limit update/read | Usage state | Reset and reached states represented independently from errors |

### Measurements

- Cold app-server startup time.
- Initialize-to-ready time.
- Login initiation and completion time, excluding human delay.
- First-delta latency and full-turn latency for the fixed prompt.
- Peak host and child-process memory during a turn.
- Delta duplication, loss, or reordering count.
- Restart-to-resumed-turn time.
- Cancellation-to-terminal-state time.
- Count and classification of protocol errors.
- Generated-schema diff across at least two supported Codex versions, if available.

Performance values are recorded, not initially release-gated, except that hangs and unbounded waits fail the spike.

### Pass criteria

TS-01 passes when:

- AS-01 through AS-10, AS-12, and AS-14 pass on a clean profile.
- No OpenAI API key is present or requested in the passing subscription path.
- No credential or raw authorization payload appears in committed logs.
- A two-turn conversation resumes after both child-process and host restart.
- Stream reconstruction has zero missing, duplicate, or reordered agent-text deltas in the fixture run.
- Cancellation reaches a terminal state and does not later appear completed.
- Unsupported protocol versions fail before a user turn.
- The harness operates on the non-experimental API surface without WebSocket or externally managed token mode.

AS-11 and AS-13 may use controlled fault injection rather than real credential expiration or an unsupported production install.

### Decision rubric

- **Select Codex app-server as default:** all pass criteria succeed and no blocker requires an experimental surface.
- **Select conditionally:** core flow passes, but packaging or a documented compatibility constraint requires a bounded follow-up. Record the constraint and block production release on it.
- **Retain OpenCode OAuth provisionally:** a critical pass criterion fails. Record the exact failure, keep the compatibility path visibly experimental, and create a dated re-evaluation trigger.
- **Reject subscription requirement:** only if neither managed path can meet the no-key acceptance gate. This would require revisiting the PRD rather than silently switching to paid API usage.

### Required artifacts

- Spike harness and automated protocol tests.
- Redacted request/response/notification transcript for each test case.
- Version and platform matrix.
- Event-mapping table with unresolved fields.
- Failure and recovery report.
- `ADR: Default ChatGPT subscription backend`.
- A short integration plan naming the production packages that would change.

## 5. TS-02 — Docling OCR, parsing, and visual provenance

### Decision question

Can a separately supervised Docling worker produce stable passage text, page identity, character spans, and bounding boxes accurate enough to support legal retrieval and click-to-evidence review across representative source types?

### Why this is risky

OCR correctness and visual grounding fail differently. Text may be accurate but attached to the wrong page or region; a box may be correct while reading order corrupts a quotation; native text and OCR may disagree on punctuation that matters to a citation. The MVP needs both searchable normalized text and defensible navigation back to the original rendering.

### Official baseline

Docling supports multiple local OCR engines, native PDF text/layout processing, full-page OCR, page images, document-item provenance, page numbers, and bounding boxes. Its visual-grounding example transforms provenance boxes to a top-left normalized coordinate system before drawing them. The spike must preserve coordinate origin and page dimensions rather than assuming all outputs share one convention.

### Hypotheses

- H1: Native and scanned federal opinions can be converted into ordered passages with reliable page provenance.
- H2: Adaptive OCR can preserve superior native text while filling scanned or low-confidence regions.
- H3: Full-page OCR can provide an independent strict visual representation for every rendered page.
- H4: Docling item provenance can be normalized into a stable internal region contract and used after restart.
- H5: Ingestion quality signals can detect most cases that should be blocked or reprocessed.
- H6: A local worker can meet acceptable latency and memory bounds on the target alpha hardware.

### Fixture corpus

Use immutable, redistributable fixtures where licensing permits. Store a manifest and hashes even when source files cannot be committed.

Minimum fixture set:

- 4 native-text federal opinions with reliable page text.
- 4 scanned opinions, including skew, noise, stamps, and faint text.
- 3 mixed PDFs containing both native and scanned pages.
- 2 multi-column opinions.
- 2 documents with dense footnotes and running headers.
- 2 table-heavy documents.
- 2 image exhibits or screenshots.
- 2 DOCX files with headings, footnotes, and tables.
- 2 HTML pages, including one rendered snapshot.
- 2 malformed or partially unreadable documents.
- 1 document with non-English text or an explicit language hint.
- 1 duplicate document with byte-level variation but equivalent visible content.

At least ten passages must have attorney- or researcher-reviewed gold text and page/region annotations. Include short pin-cite-sensitive strings, punctuation, section symbols, docket/citation formats, and footnote markers.

### Worker contract to prove

The spike worker should expose one versioned local request and one event stream:

```text
ingest {
  job_id,
  source_version_id,
  blob_path,
  expected_sha256,
  mime,
  mode: adaptive | strict_visual,
  language_hints,
  page_range?
}

events:
  accepted -> progress* -> completed | failed | cancelled

completed {
  worker_version,
  parser_version,
  ocr_engine_and_model,
  source_hash,
  page_count,
  normalized_text_hash,
  items[],
  pages[],
  quality_metrics,
  warnings[]
}
```

Each model-visible item must contain ordered text and provenance references. Each region must contain page number, page width/height, coordinate origin, bounding box or polygon, and a stable link to the item. The host creates final source, representation, passage, and passage-region IDs; the worker does not become the database authority.

### Pipeline variants

Compare at least:

1. Native/adaptive Docling extraction with OCR enabled for required regions.
2. Full-page OCR using a portable local engine.
3. Native macOS OCR where available, recorded as a platform-specific comparison rather than the only path.
4. A second portable OCR engine on the scanned subset when practical.

Do not choose a default from one visually clean PDF. Run every candidate over the fixed subset and preserve raw outputs.

### Required test cases

| ID | Scenario | Expected evidence |
|---|---|---|
| DL-01 | Verify source hash before conversion. | Hash mismatch fails before parsing and produces no completed representation. |
| DL-02 | Parse native opinion. | Gold text, reading order, page association, and regions meet thresholds. |
| DL-03 | Parse scanned opinion adaptively. | OCR text is present and low-confidence regions are identifiable. |
| DL-04 | Run strict visual mode. | Every page has a canonical image and full-page OCR representation in addition to native output. |
| DL-05 | Parse mixed PDF. | Native and OCR pages remain ordered in one document without silent gaps. |
| DL-06 | Preserve footnotes. | Gold footnote text and marker relationship survive serialization. |
| DL-07 | Preserve table structure. | Gold cells and row/column relationships are represented or explicitly degraded. |
| DL-08 | Normalize coordinates. | Stored boxes reopen on the intended visual text at multiple zoom levels. |
| DL-09 | Handle rotation and crop boxes. | Region navigation remains correct or the source is visibly blocked. |
| DL-10 | Reprocess with language hint. | A new immutable representation is created; the earlier one remains resolvable. |
| DL-11 | Cancel and restart worker. | Partial jobs do not appear completed; a retry is idempotent by job/source/mode. |
| DL-12 | Parse malformed input. | Failure is bounded, classified, and does not crash the host. |
| DL-13 | Detect empty or near-empty pages. | Quality warning points to the affected page range. |
| DL-14 | Detect native/OCR disagreement. | Material disagreement creates a warning with page and compared representation IDs. |
| DL-15 | Restart and reopen coordinates. | Serialized output alone reproduces the same page and highlight after restart. |

### Metrics

#### Text and structure

- Character error rate after documented normalization, reported separately for native and OCR text.
- Exact-string recovery rate for gold legal citations, quotations, section symbols, and footnote markers.
- Reading-order pair accuracy for annotated neighboring blocks.
- Footnote text recall and marker-link accuracy.
- Table cell precision, recall, and row/column relationship accuracy.
- Missing-page and duplicated-page rate.

#### Visual provenance

- Correct-page rate for gold passages.
- Region hit rate: the stored highlight intersects the annotated target and does not primarily cover unrelated text.
- Intersection-over-union for boxes where a gold box exists.
- Coordinate stability across supported zoom and viewport sizes.
- Passage-to-region completeness rate.

#### Quality detection

- Recall and precision for documents/pages intentionally labeled poor quality.
- Native/OCR disagreement detection rate.
- Percentage of failed inputs incorrectly marked ready.

#### Performance

- Seconds per page at p50/p95 by mode and fixture class.
- Peak memory and model-download/storage size.
- Cold and warm worker startup.
- CPU/GPU utilization and thermal behavior on target hardware.
- Cancellation latency and temporary-disk cleanup.

### Initial pass criteria

- 100% source-hash verification and page-count accounting.
- 0 failed or partial jobs marked ready.
- At least 99% correct-page association on annotated passages.
- At least 95% region hit rate, matching the PRD's initial navigation gate.
- 100% exact recovery for gold citations and quotations on native-text fixtures.
- At least 98% median character accuracy on the reviewed scanned-text subset, with every lower-quality page warned.
- At least 95% footnote text recall on the annotated subset.
- 100% of strict-mode pages produce a canonical image and OCR result or a visible blocking failure.
- Reprocessing never mutates the prior representation.
- Cancellation and malformed inputs do not crash or corrupt the host.

These thresholds are spike gates, not final corpus-wide claims. The evaluation plan owns release thresholds and confidence intervals.

### Decision rubric

- **Adopt Docling as primary worker:** provenance and quality gates pass with an acceptable portable OCR engine.
- **Adopt hybrid pipeline:** Docling supplies document structure/provenance, while a different local OCR engine supplies text for defined fixture classes. Both must produce the same internal contract.
- **Conditional adoption:** core PDF flow passes but one source format needs a bounded fallback. Document the fallback and prevent silent coordinate loss.
- **Reject:** page/region provenance is not stable enough for citation navigation or poor outputs cannot be detected reliably.

### Required artifacts

- Hashed fixture manifest and gold annotation format.
- Worker protocol prototype and version negotiation test.
- Raw normalized outputs for each pipeline variant.
- Metric report by fixture and mode.
- Visual overlay gallery for all annotated passages.
- Failure/warning taxonomy.
- Packaging and hardware notes.
- `ADR: Evidence worker and OCR pipeline`.

## 6. TS-03 — Claim-to-passage citation round trip

### Decision question

Can the application persist structured claims and multiple evidence relationships, finalize citations only after validation, and reopen exact passage highlights after restart without parsing model-generated Markdown as the source of truth?

### Why this is risky

Citation UX often looks trustworthy while relying on fragile internals: the model emits a footnote, hover text is copied from its answer, or the PDF viewer searches for a quote at click time. Those designs can produce convincing but unresolvable citations. This spike must prove the complete identity chain with minimal production-like schemas.

### Hypotheses

- H1: Opaque passage IDs can be supplied to the model and returned in a structured claim/evidence envelope.
- H2: The host can map streamed provisional text to finalized claim spans without letting provisional markers become verified citations.
- H3: One claim can link to multiple supporting, qualifying, and contradictory passages.
- H4: Citation display can be built entirely from persisted application data.
- H5: A source page and region can reopen after restart without searching for the quote.
- H6: Invalid passage IDs, mutated hashes, and model-invented footnotes fail closed.

### Minimal data slice

Implement spike-owned versions of:

- `source`
- `source_version`
- `source_representation`
- `passage`
- `passage_region`
- `assistant_message`
- `claim`
- `claim_evidence`
- `verification_result`
- `citation_anchor`
- `retrieval_event`
- `citation_ledger_entry`

Use stable opaque IDs and content hashes. The spike may use a temporary SQLite database and local fixture blobs. It must not encode citations solely inside Markdown.

### Vertical flow

1. Materialize two or more fixture sources with immutable versions.
2. Load TS-02-compatible passages and regions.
3. Create an evidence packet containing bounded text and opaque passage IDs.
4. Obtain or simulate streamed prose plus structured claim/evidence selections.
5. Persist provisional assistant text separately from finalized claims.
6. Validate passage existence, source/hash integrity, answer spans, and evidence relationship.
7. Mint citation anchors from stored claim/evidence records.
8. Render an answer, multi-passage hover card, and source panel.
9. Click each passage and draw its stored region on the original page image/PDF.
10. Restart the prototype and repeat hover/click without regenerating the answer or searching for quote text.

The deterministic test suite must not require a live model. A single live subscription-backed demonstration can supplement, but not replace, fixture responses.

### Required test cases

| ID | Scenario | Expected evidence |
|---|---|---|
| CT-01 | One claim, one supporting passage. | One application-minted anchor resolves to stored passage text and region. |
| CT-02 | One claim, multiple supporting sources. | Hover shows every passage without merging away source identity. |
| CT-03 | Support plus qualification. | Relationships are visually distinct and the qualifier is not hidden behind an aggregate green state. |
| CT-04 | Contradictory passage. | The claim cannot appear ordinarily verified; contradiction is visible. |
| CT-05 | Model emits fake Markdown footnote. | Text may display as untrusted prose, but no clickable verified anchor is created. |
| CT-06 | Model returns unknown passage ID. | Finalization rejects that evidence link and records an unverified result. |
| CT-07 | Passage hash changes. | Integrity check fails and the prior citation does not silently retarget. |
| CT-08 | Answer offsets are invalid or stale. | Finalization fails closed or recomputes only through a documented deterministic mapping. |
| CT-09 | Stream is interrupted before finalization. | Provisional markers remain visibly pending/unverified and never become ordinary citations. |
| CT-10 | Duplicate source text appears on multiple pages. | Click uses stored page/region identity, not first text-search match. |
| CT-11 | OCR-normalized quote differs from visual glyphs. | Hover labels the OCR-normalized state and still opens the stored region. |
| CT-12 | Source has no coordinates. | Hover remains available; click uses a visibly labeled structural/text fallback. |
| CT-13 | Restart application. | All finalized anchors resolve to identical source versions, passages, relationships, and regions. |
| CT-14 | Delete a referenced source. | Product explains the reference and deletion scope; no dangling ordinary-looking citation remains. |
| CT-15 | Uncited context passage. | The passage appears in the sources-read ledger but not as a citation. |
| CT-16 | Material claim has no evidence. | Coverage gate prevents `source-complete` status. |

### UI prototype requirements

- Finalized citation anchors must be keyboard focusable.
- Hover/focus cards list source, location, exact passage, relationship, and verification state.
- Multiple passages are independently selectable.
- Click opens original and normalized-text tabs.
- The original view draws stored page coordinates.
- Pending, supported, qualified, contradicted, OCR-normalized, and unverified states are visually and textually distinct.
- A trust summary separates source integrity, quote fidelity, claim support, citation resolution, and treatment rather than showing one universal score.
- A sources-read drawer includes uncited context.

The spike should use the existing session UI primitives where possible, but it should not force final visual design decisions.

### Measurements

- Citation-resolution precision and recall over deterministic cases.
- Invalid citation rejection rate.
- Correct source/page/region navigation rate.
- Restart durability rate.
- Claim-span alignment rate.
- Coverage-gate recall on intentionally unsupported material claims.
- Hover-to-visible latency and click-to-highlight latency on local fixtures.
- Accessibility checks for focus, labels, and non-color-only states.

### Pass criteria

- 100% of clickable anchors resolve to persisted source versions and passages.
- 0 fake Markdown footnotes or unknown passage IDs become clickable verified anchors.
- 100% of verbatim-labeled hover text is loaded from stored passage data and matches its hash.
- 100% of multi-passage relationships survive persistence and restart.
- At least 95% of gold fixture clicks open the correct page/region; every failure is labeled.
- Duplicate visible text never causes navigation to a different stored region.
- Interrupted streams never finalize citations automatically.
- Every model-visible passage appears in the sources-read ledger.
- Material unsupported claims prevent `source-complete` state.
- The deterministic suite passes without a live model or network dependency.

### Decision rubric

- **Adopt first-class citation anchors:** pass criteria succeed using schema/protocol/session UI boundaries consistent with the architecture.
- **Revise span protocol:** passage identity works but streamed claim offsets are unstable. Prefer explicit finalization/replacement events over Markdown parsing.
- **Revise viewer contract:** citations persist correctly but coordinate navigation fails. Return to TS-02 rather than introducing silent quote-search behavior.
- **Reject design:** model output can mint verified citations, references cannot survive restart, or the ledger is incomplete.

### Required artifacts

- Minimal migrations/schema and deterministic fixture generator.
- Structured model response fixtures covering all relationships and failures.
- Citation finalization state diagram.
- Automated adversarial tests.
- Screen recording or screenshots of hover and click behavior.
- Persistence/restart test report.
- `ADR: Citation anchor and finalization protocol`.
- Production implementation map by package.

## 7. Cross-spike integration gate

After all three spikes, run one composed demonstration:

1. Authenticate through the selected subscription backend with no OpenAI API key.
2. Ingest one native opinion and one scanned opinion through the selected evidence worker.
3. Persist at least four passages with page regions.
4. Ask one fixed legal question using only those evidence packets.
5. Finalize one multi-source claim and one qualified claim.
6. Hover every citation and click every passage.
7. Show all context passages in the ledger.
8. Restart all local processes and reopen the same citations.
9. Export a provenance receipt.

The composed gate passes only if each layer uses IDs and hashes from the preceding layer. Re-keying sources or reconstructing locations by text search invalidates the result.

## 8. Evidence package and review

Each spike report must include:

- Question and hypotheses.
- Environment/version manifest.
- Fixture manifest and licenses.
- Steps or automated command to reproduce.
- Raw results with secrets and privileged content removed.
- Metrics with numerator, denominator, and excluded cases.
- Failures and unexpected observations.
- Decision, confidence, limitations, and follow-up work.
- ADR link.
- PRD requirements proven, partially proven, or still unproven.

The product owner and technical reviewer approve the decision. An attorney reviewer approves only legal/evidence interpretations and corpus labels; technical approval is not delegated to legal review.

## 9. PRD traceability

| Spike | Primary PRD requirements |
|---|---|
| TS-01 | AUTH-01 through AUTH-05; PER-01; SEC-03; MVP Milestone A |
| TS-02 | SRC-05 through SRC-07; ING-01 through ING-08; CIT-05; PER-01; SEC-02; MVP Milestone C |
| TS-03 | SRC-04; CIT-01 through CIT-08; VER-01 through VER-06; LED-01 through EXP-01; MVP Milestone E |
| Composed gate | MVP release definition steps 1 through 12 and the evidence-integrity release gates |

## 10. Sources

- OpenAI Codex app-server: <https://learn.chatgpt.com/docs/app-server>
- OpenAI Codex authentication: <https://learn.chatgpt.com/docs/auth>
- Docling OCR engines: <https://docling-project.github.io/docling/concepts/OCR/>
- Docling full-page OCR: <https://docling-project.github.io/docling/_generated/examples/full_page_ocr/>
- Docling visual grounding: <https://docling-project.github.io/docling/_generated/examples/visual_grounding/>
