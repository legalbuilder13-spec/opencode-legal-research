# Legal Research MVP Product Requirements Document

Status: draft v0.1  
Product owner: Legal Builder  
Target branch: `legal-research`  
Architecture: [`architecture.md`](./architecture.md)  
Last updated: 2026-08-23

## 1. Product decision

Build the first release around one trustworthy legal-research loop:

> A lawyer creates a matter, adds user-provided and public legal sources, asks a legal question, and receives an answer in which every material research claim is linked to one or more exact, reviewable source passages.

The MVP is a single-user, local-first desktop product for U.S. federal case-law research and research against user-provided materials. It is not a general Harvey, Legora, or Westlaw replacement. Its differentiation is an inspectable evidence chain from acquisition through OCR/parsing, retrieval, generation, verification, and citation display.

The ChatGPT subscription is the default model entitlement. The core workflow must not require an OpenAI API key. Local OCR, parsing, retrieval, embeddings, and reranking must not create a hidden API-key dependency.

## 2. Problem

General-purpose AI tools can produce useful legal prose but often make it difficult to answer five essential questions:

1. What exact source version did the system use?
2. What exact passage supports each proposition?
3. Was the passage quoted accurately and read in context?
4. Did the system omit a material qualification or contrary authority?
5. Can the lawyer reopen the same evidence after the source, session, or live webpage changes?

Existing citation interfaces can still fail if their footnotes are model-generated, their hover text is not tied to immutable source records, or their PDF highlights are reconstructed with brittle text search. The MVP must make evidence provenance an application-enforced data model rather than a prompting convention.

## 3. Goals

### 3.1 User goals

- Research a focused U.S. federal legal question using public authorities and matter documents.
- See which sources were searched, opened, used, cited, or rejected.
- Review the exact passage or passages supporting each material claim.
- Jump from a citation to the correct source page and highlighted region.
- Distinguish verified support from unresolved, qualified, or contradictory evidence.
- Resume a matter without losing source versions, citations, or research history.

### 3.2 Product goals

- Prove ChatGPT-subscription operation without an OpenAI API key.
- Establish an immutable, provenance-preserving source substrate.
- Establish a structured claim-to-evidence protocol that supports multiple passages.
- Make fabricated or unresolvable citations non-clickable and visibly unverified.
- Demonstrate an attorney-reviewable research answer with reproducible evidence receipts.
- Create a foundation that future web, MCP, Midpage, and licensed-source adapters cannot bypass.

### 3.3 Business goals

- Produce a credible private alpha for hands-on evaluation by lawyers.
- Validate that passage-level trust and review speed are valuable enough to justify a broader legal workbench.
- Reduce technical risk before investing in multi-user, cloud, drafting, and licensed-data features.

## 4. Non-goals

The MVP will not:

- Claim comprehensive coverage of U.S. law or editorial citator equivalence.
- Cover all state, international, or transactional-law research workflows.
- Draft court-ready briefs or automatically file legal documents.
- Replace lawyer review or provide a guarantee that an answer is legally correct.
- Provide multi-tenant cloud hosting, organization administration, or real-time collaboration.
- Integrate every commercial legal-research platform.
- Train or fine-tune a legal foundation model.
- Offer autonomous client advice or make unsupervised legal decisions.
- Treat a citation graph as equivalent to Shepard's or KeyCite.
- Send matter content to an API-key provider unless the user explicitly selects and configures it.

## 5. Target user and initial market

### Primary user

A U.S. lawyer, legal researcher, or legally trained product evaluator working on a focused federal issue who needs to verify the answer rather than merely receive plausible prose.

### Initial environment

- One user on a local desktop installation.
- U.S. federal opinions available through CourtListener.
- User-provided PDF, image, HTML, text, and DOCX materials.
- Optional public-web sources captured through the product's source materializer.
- ChatGPT Plus, Pro, Business, Enterprise, Edu, or another Codex-eligible workspace, subject to the user's plan and workspace controls.

### Jobs to be done

- “When I research an issue, help me find and synthesize relevant authority without losing the exact language behind the answer.”
- “When I review an AI claim, show me all supporting or qualifying passages immediately.”
- “When I return to a matter, preserve the sources and evidence exactly as they existed when the answer was generated.”
- “When the system cannot verify something, make that limitation obvious before I rely on it.”

## 6. Product principles

1. **No source, no verified claim.** A material external claim cannot appear source-complete without persisted evidence.
2. **The application mints citations.** The model can select passage IDs but cannot create source identity, quotation text, page location, footnote number, or verification status.
3. **Originals are immutable.** Every admitted source is tied to archived bytes or a captured response body and a content hash.
4. **Coordinates survive parsing.** Passage records retain character offsets and, for paginated or rendered sources, page coordinates.
5. **Multiple passages are first-class.** A claim can rely on a rule, limitation, factual application, and contrary passage.
6. **Uncertainty is visible.** Missing or failed checks appear as unverified, not as ordinary citations.
7. **Source text is data, not instruction.** Retrieved content cannot override product or agent policy.
8. **Local-first does not mean security-free.** Matter isolation, deletion, egress visibility, and safe parsing start in the MVP.

## 7. MVP release definition

The MVP is complete when an evaluator can perform this workflow on a clean installation:

1. Sign in with a ChatGPT subscription without entering an OpenAI API key.
2. Create a matter with a name, default jurisdiction, as-of date, and confidentiality label.
3. Upload matter documents and add at least one public-web or CourtListener source.
4. Observe ingestion, OCR/parsing status, provenance, and quality warnings.
5. Ask a focused federal legal-research question.
6. Review the issue plan and sources being collected.
7. Receive an answer with claim-level citation anchors.
8. Hover a citation to read every supporting, qualifying, or contradictory passage.
9. Click a passage to open the immutable source at the correct page and highlighted region.
10. Open a sources-read ledger showing all passages admitted to model context, including uncited passages.
11. Restart the application and reopen the same answer, citations, sources, and highlights.
12. Export the answer and a machine-readable provenance receipt.

## 8. Scope assumptions

- The first reviewed corpus is U.S. federal case law plus user materials.
- CourtListener is the first legal-data connector; its coverage and metadata are shown accurately and not represented as comprehensive.
- The product begins as a legal mode within the OpenCode shell while the coding-first interface is replaced incrementally.
- The first alpha may use OpenCode's existing ChatGPT OAuth path while the Codex app-server adapter is evaluated. The selected production-default path must be recorded in an ADR.
- Strict visual evidence mode is available for any source that can be rendered. Structured API/MCP records are parsed structurally; OCR is not applied to raw JSON merely to satisfy a checkbox.

## 9. Primary user workflow

### 9.1 Start or resume a matter

The user creates or opens a matter. The matter establishes the default jurisdiction, research as-of date, confidentiality label, and source collection. Matters must not share retrieval context unless the user deliberately imports a source.

### 9.2 Add sources

The user uploads documents, adds a URL, or searches CourtListener. Every selected item passes through the same materialization boundary before it can reach the model. The user sees ingestion progress and warnings.

### 9.3 Ask and plan

The user asks a question. The product confirms or derives jurisdiction, date, procedural posture, and requested work product. It presents a compact issue plan and begins primary-authority research.

### 9.4 Research and synthesize

The system retrieves full sources, creates addressable passages, searches and reranks them, and identifies supporting, limiting, and adverse material. Only persisted passage packets enter model context.

### 9.5 Review the answer

The answer streams provisionally. Citation anchors become verified and interactive only after source identity, passage integrity, and the applicable verification checks complete. The final response includes the answer, open issues, contrary authority, sources, and as-of date.

### 9.6 Inspect evidence

Hovering a citation opens a multi-passage evidence card. Clicking a passage opens the original-document viewer at its page and stored bounding box. The user can switch between original, normalized text, and source metadata.

### 9.7 Reproduce or export

The user can reopen the matter after restart and export readable footnotes plus a provenance sidecar containing source-version and passage identifiers, hashes, retrieval times, and verification states.

## 10. Functional requirements

Priority meanings:

- **P0:** required for MVP release.
- **P1:** required for private beta but may follow the first end-to-end alpha.
- **P2:** explicitly deferred.

### 10.1 Authentication and model execution

| ID | Priority | Requirement | Acceptance criteria |
|---|---:|---|---|
| AUTH-01 | P0 | The user can authenticate with an eligible ChatGPT subscription. | A clean profile completes browser or device authentication and a streamed model turn without an OpenAI API key. |
| AUTH-02 | P0 | The product distinguishes subscription and API-key modes. | Settings label the active entitlement and never describe ChatGPT access as general API credit. |
| AUTH-03 | P0 | Subscription limits and authentication failures are visible. | Expired login, plan limit, cancellation, and unavailable backend produce distinct recoverable states. |
| AUTH-04 | P0 | The backend decision is documented. | A versioned ADR selects Codex app-server or the compatibility OAuth path based on login, resume, cancellation, streaming, and rate-limit tests. |
| AUTH-05 | P1 | The user can change supported ChatGPT workspaces/accounts without deleting matter data. | Logout and login replace credentials without corrupting local matters or evidence. |

### 10.2 Matters and source collections

| ID | Priority | Requirement | Acceptance criteria |
|---|---:|---|---|
| MAT-01 | P0 | The user can create, rename, open, and archive a matter. | Each operation persists across application restart. |
| MAT-02 | P0 | A matter stores research defaults. | Jurisdiction, as-of date, confidentiality label, and optional client/matter label are visible and editable. |
| MAT-03 | P0 | Retrieval is matter-scoped. | Automated isolation tests show that a matter cannot retrieve another matter's passages without explicit import. |
| MAT-04 | P1 | The user can export and delete a matter. | Export produces matter data plus evidence receipts; deletion removes searchable content and follows documented blob-retention behavior. |

### 10.3 Source acquisition and materialization

| ID | Priority | Requirement | Acceptance criteria |
|---|---:|---|---|
| SRC-01 | P0 | The product accepts PDF, image, HTML, text, and DOCX uploads. | Gold fixtures ingest without entering model context before materialization completes. |
| SRC-02 | P0 | The product captures public URLs. | The stored source version includes response body or archived bytes, final and canonical URLs, retrieval time, MIME type, and content hash. |
| SRC-03 | P0 | The product retrieves CourtListener opinions and metadata. | A search result can be materialized into a full opinion source with CourtListener identity, URL, court, date, and available citation fields. |
| SRC-04 | P0 | Every tool or connector result is intercepted before inference. | A test tool returning content cannot place raw content in model context until a source version and passage IDs exist. |
| SRC-05 | P0 | Source versions are immutable. | Re-fetching changed content creates a new version and does not alter an existing citation target. |
| SRC-06 | P0 | Originals are content-addressed and integrity checked. | Stored bytes can be rehashed to the recorded digest; mismatch blocks verified citation rendering. |
| SRC-07 | P0 | Acquisition failures and licensing/access notes are visible. | Partial, blocked, paywalled, or license-limited sources cannot appear as fully captured. |
| SRC-08 | P1 | A generic MCP source-envelope wrapper captures text, embedded resources, and linked documents. | Each content block admitted to context resolves to a captured source version or an explicit excluded-content record. |
| SRC-09 | P2 | Licensed providers such as Midpage use the same envelope. | No licensed adapter can bypass source versioning, passage creation, or evidence logging. |

### 10.4 OCR, parsing, and provenance

| ID | Priority | Requirement | Acceptance criteria |
|---|---:|---|---|
| ING-01 | P0 | Every source is parsed into a normalized, addressable representation. | Each model-visible text span belongs to a persisted passage with a stable ID and text hash. |
| ING-02 | P0 | Visual documents support native text plus OCR. | PDF/image fixtures retain native extraction where superior and OCR output for scanned or low-confidence regions. |
| ING-03 | P0 | Strict visual mode renders and OCRs every page. | Enabling strict mode creates canonical page images and OCR representations without discarding native text. |
| ING-04 | P0 | Renderable web sources support visual preservation. | Strict-mode URL capture stores a rendered snapshot, page images, OCR text, and the structural HTML representation. |
| ING-05 | P0 | Passages retain source location. | Paginated passages retain page and bounding-box data; structural sources retain section path and character offsets. |
| ING-06 | P0 | Ingestion quality is measured and visible. | Empty pages, low OCR confidence, reading-order anomalies, page-count mismatch, and parse failures create warnings or block completion. |
| ING-07 | P0 | The user can reprocess a source. | The user can select strict OCR or language hints; reprocessing creates a new representation without overwriting prior evidence. |
| ING-08 | P0 | Worker protocol and parser versions are persisted. | Every representation records parser, OCR engine, model/version, mode, normalized-text hash, and quality metrics. |

### 10.5 Retrieval and research workflow

| ID | Priority | Requirement | Acceptance criteria |
|---|---:|---|---|
| RET-01 | P0 | Retrieval works without a paid embedding API. | FTS5 plus local semantic retrieval and reranking return passages with no embedding API credential configured. |
| RET-02 | P0 | Retrieval supports legal filters. | Matter, source collection, jurisdiction, court, date, authority type, and precedential-status filters affect results deterministically. |
| RET-03 | P0 | Context construction is logged. | Each turn records candidates, ranks, selected passage IDs, neighboring context, and the passages actually sent to the model. |
| RET-04 | P0 | Retrieval preserves source diversity. | Configurable limits prevent one long authority from occupying the entire evidence packet. |
| RES-01 | P0 | The agent creates an inspectable issue plan. | The user sees issues, assumed jurisdiction/date/posture, and source priorities before or during research. |
| RES-02 | P0 | Primary sources are preferred for final legal propositions. | When a secondary source leads to an available primary source, the chain is recorded and the final proposition cites the primary source. |
| RES-03 | P0 | The workflow seeks qualifications and adverse material. | The final result contains a contrary/qualifying authority section or an explicit statement of what was searched and not found. |
| RES-04 | P0 | Search snippets alone cannot support a verified claim. | A verified citation requires a materialized full source and passage, not a result snippet. |

### 10.6 Claims, citations, and evidence display

| ID | Priority | Requirement | Acceptance criteria |
|---|---:|---|---|
| CIT-01 | P0 | Final answers persist structured claims and evidence selections. | Each material claim has answer offsets, claim text, and zero or more passage relationships. |
| CIT-02 | P0 | One claim can cite multiple passages and sources. | The UI and persistence layer support at least supporting, qualifying, and contradictory relationships without flattening them into one quote. |
| CIT-03 | P0 | Citation anchors are application-generated. | Model-written footnote syntax cannot create a clickable or verified citation. |
| CIT-04 | P0 | Hover cards show exact persisted passages. | Hover text is read from passage rows and includes source title, location, relationship, verification state, and all linked passages. |
| CIT-05 | P0 | Citation clicks navigate to stored source coordinates. | Gold PDF fixtures open at the correct page and bounding box; text search is used only as a visibly labeled fallback. |
| CIT-06 | P0 | Citation anchors survive restart. | Every clickable citation resolves to the same source version and passages after application restart. |
| CIT-07 | P0 | Streaming citations remain provisional until finalized. | Provisional prose cannot display an ordinary verified citation before validation completes. |
| CIT-08 | P1 | Exported footnotes retain provenance. | Readable footnotes and the sidecar resolve to the same immutable source versions and passages. |

### 10.7 Verification and trust states

| ID | Priority | Requirement | Acceptance criteria |
|---|---:|---|---|
| VER-01 | P0 | Passage identity and hash are checked before citation rendering. | Missing or changed passage data blocks verified citation status. |
| VER-02 | P0 | Displayed quotations are checked for fidelity. | Exact quotations match normalized source text; OCR-tolerant matches are separately labeled. |
| VER-03 | P0 | Claim support is evaluated separately from quote fidelity. | The stored result distinguishes supports, qualifies, contradicts, irrelevant, and unverified. |
| VER-04 | P0 | Material uncited claims are detected. | The final response cannot receive `source-complete` status when a material externally verifiable claim lacks evidence. |
| VER-05 | P0 | Citation resolution is distinct from legal treatment. | A real, correctly resolved case is not labeled good law solely because it exists. |
| VER-06 | P0 | Verification failure is visible. | A failed or unavailable check displays unverified/qualified/contradicted state and never silently appears green. |
| VER-07 | P1 | Court and precedential metadata are evaluated as of a recorded date. | The source card shows jurisdiction, court, publication/precedential fields, metadata source, and as-of date. |
| VER-08 | P1 | Derived treatment is labeled as derived. | Citation-graph results name their data source and do not use editorial-citator branding or equivalence claims. |

### 10.8 Evidence ledger, persistence, and export

| ID | Priority | Requirement | Acceptance criteria |
|---|---:|---|---|
| LED-01 | P0 | Every model-visible source passage is recorded. | A per-turn drawer lists cited and uncited passages admitted to context. |
| LED-02 | P0 | Retrieval and evidence events are reproducible. | The ledger connects query, candidate ranks, context packet, claims, citations, and verifier outputs by immutable IDs. |
| PER-01 | P0 | Matter research survives restart. | Sources, representations, passages, messages, claim offsets, citations, coordinates, and ledger entries reopen correctly. |
| PER-02 | P0 | Persistence avoids duplicating source payloads in messages. | Messages and ledger rows reference content-addressed source data rather than embedding copies. |
| EXP-01 | P0 | The user can export an answer and provenance receipt. | Export includes answer text, readable source references, as-of date, source hashes, passage IDs, retrieval times, and verification states. |

### 10.9 Safety, confidentiality, and product integrity

| ID | Priority | Requirement | Acceptance criteria |
|---|---:|---|---|
| SEC-01 | P0 | Source content is treated as untrusted data. | Prompt-injection fixtures inside documents cannot alter system policy or bypass source capture. |
| SEC-02 | P0 | Active document/web content is isolated. | Parsers and viewers do not execute macros, scripts, or embedded active content from sources. |
| SEC-03 | P0 | Model egress is disclosed. | Before first use, the product identifies the selected ChatGPT workspace/backend and warns that matter content will be sent there. |
| SEC-04 | P0 | Logs and telemetry exclude source text by default. | Automated checks find no raw matter text, tokens, or full tool payloads in default diagnostic output. |
| SEC-05 | P0 | Destructive actions are explicit. | Source or matter deletion names its scope and reports whether underlying blobs remain referenced elsewhere. |
| SEC-06 | P1 | A local-only mode prevents model egress. | When enabled, no matter content is sent to ChatGPT; unsupported generative actions are clearly disabled unless a local model is configured. |

## 11. User experience requirements

### Main navigation

- **Matters:** create, open, archive, export, or delete matters.
- **Research:** ask questions, inspect issue plans, follow progress, and review answers.
- **Sources:** add, filter, inspect, reprocess, or remove sources.
- **Evidence:** review claim coverage, citations, verification results, and the sources-read ledger.

### Research workspace

The initial layout should contain:

- A matter header showing jurisdiction, as-of date, and confidentiality state.
- A question/composer area.
- A compact issue plan and research-progress view.
- The answer with first-class citation anchors.
- A source collection with captured/parsed/warning states.
- A right-side evidence panel for hover and click-through review.
- A trust summary that separates source completeness, quotation fidelity, claim support, citation resolution, and treatment status.

### Citation interaction

- Hovering a citation shows every linked passage, not an AI-written summary standing in for evidence.
- Each passage shows its relationship to the claim.
- Clicking opens the original document at a stored region.
- A normalized-text tab is available for OCR inspection.
- Warnings explain OCR normalization, unavailable coordinates, unresolved citations, and incomplete capture.
- Keyboard navigation and accessible focus behavior cover citation anchors and evidence cards.

## 12. Success metrics and release gates

Initial thresholds are hypotheses and must be revised in the evaluation plan after the gold corpus is assembled.

### Evidence integrity gates

- 100% of clickable citations resolve to an existing immutable source version and passage after restart.
- 100% of verbatim-labeled quotes match normalized source text exactly.
- 0 model-invented citation markers become clickable verified citations.
- 100% of model-visible passages appear in the turn ledger.
- 100% of source changes create new versions rather than mutating cited content.
- At least 95% of reviewed gold-document passage clicks open the correct page and region; failures are visibly labeled.

### Research-quality gates

- Passage recall@k meets the threshold established for the reviewed MVP question set.
- Material unsupported-claim rate is measured and below the attorney-approved release threshold.
- Adverse or qualifying authority recall is measured separately from ordinary relevance.
- Jurisdiction, court, date, and precedential metadata errors are measured and visible.
- Every final research response states its as-of date and source scope.

### Product gates

- A new user completes the primary workflow without configuring an OpenAI API key.
- A research matter reopens successfully after process termination and restart.
- Citation hover and source opening are responsive enough for continuous review; exact latency budgets will be set after the UI spike.
- Ingestion failures can be understood and retried without reading logs.
- The evaluator can export a human-readable answer and machine-readable evidence receipt.

### Safety gates

- Cross-matter retrieval tests show no leakage.
- Prompt-injection documents cannot become agent instructions.
- Default logs contain no raw source text or credentials.
- Deletion, export, and reprocessing behavior pass documented lifecycle tests.

## 13. Evaluation corpus

The MVP cannot be accepted using demos alone. Create a versioned, attorney-reviewed corpus containing:

- Native-text federal opinions.
- Scanned opinions and mixed native/scanned PDFs.
- Opinions with footnotes, tables, multi-column layouts, and page headers.
- CourtListener opinion records with known citation and court metadata.
- A changed webpage with both old and new captured versions.
- User documents containing conflicting facts and qualifications.
- Authorities with negative or limiting subsequent treatment.
- Fabricated case names, wrong quotations, wrong pincites, and unsupported propositions.
- Documents containing prompt-injection attempts.

Each research question needs gold issues, preferred primary sources, supporting passages, material qualifiers, known contrary authority, jurisdiction/date constraints, and an attorney review note.

## 14. Delivery plan

### Milestone A — Subscription and protocol proof

- Verify the existing ChatGPT OAuth flow on a clean profile.
- Spike Codex app-server login, streaming, resume, cancellation, and rate limits.
- Select the default backend in an ADR.
- Rebrand the first legal mode and retain upstream notices.

Exit: a repeatable no-API-key conversation and tested adapter protocol.

### Milestone B — Evidence substrate

- Implement matters, source versions, content-addressed blobs, representations, passages, regions, and ledger primitives.
- Capture upload, web, and generic tool content before model context.
- Implement export/delete lifecycle foundations.

Exit: a changed live source cannot alter an existing citation target.

### Milestone C — Docling ingestion

- Add the supervised evidence worker, provenance protocol, OCR modes, progress, warnings, and reprocessing.
- Validate the gold-document fixtures.

Exit: reviewed passages reopen at their source page and region; poor parses are visibly flagged.

### Milestone D — Retrieval and structured evidence

- Add FTS5, local embeddings, fusion, reranking, legal filters, context logging, and diversity controls.
- Add the structured claim/evidence response contract and persistence.

Exit: evaluated questions retrieve expected passages without a paid embedding API.

### Milestone E — Citation workbench

- Render finalized citation anchors, multi-passage hover cards, source viewer highlights, trust states, and sources-read ledger.
- Add fidelity, support, resolution, and coverage gates.

Exit: every clickable citation is application-resolved and restart-durable.

### Milestone F — CourtListener research alpha

- Add full-opinion acquisition, metadata, research planning, adverse-authority search, and provenance export.
- Run the attorney-reviewed end-to-end evaluation.

Exit: the primary workflow passes evidence, research, product, and safety gates.

## 15. Dependencies and constraints

- OpenCode upstream changes quickly; product changes must remain separable and regularly rebased from `upstream/dev`.
- Codex app-server protocol versions must be pinned and compatibility-checked.
- ChatGPT subscription use is governed by the selected plan, workspace controls, and usage limits; it does not supply general API credits.
- Docling and OCR models add binary size, startup time, CPU/GPU, and memory costs that must be measured on supported hardware.
- CourtListener coverage, rate limits, licensing, and service availability must be represented accurately.
- Original OpenCode notices must remain. Copied code must retain applicable LQ.AI, Donna, Docling, or other third-party license notices.
- The product must not market automated treatment analysis as a licensed editorial citator.

## 16. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| ChatGPT authentication integration changes | The default no-key experience breaks. | Prefer documented Codex app-server, pin protocol versions, retain a clearly labeled compatibility path, and test clean-profile login. |
| OCR or reading order is wrong | Citations point to misleading text. | Preserve native and OCR representations, store coordinates, show quality warnings, support reprocessing, and evaluate gold fixtures. |
| The model selects irrelevant passages | A real citation appears to support a false claim. | Separate identity, quotation, entailment, coverage, and authority checks; never equate citation existence with support. |
| Search misses adverse authority | The answer is materially incomplete. | Use issue decomposition, primary-source priority, adverse lanes, diversity controls, and a reviewed evaluation set. |
| Source or plugin bypasses capture | The answer relies on unreviewable content. | Enforce one source-envelope/materialization boundary at tool execution and test attempted bypasses. |
| Local data exposes confidential material | Privilege or confidentiality is harmed. | Matter isolation, safe logs, clear egress disclosure, lifecycle controls, local-only roadmap, and threat modeling. |
| MVP scope expands into a full legal platform | Delivery stalls before the evidence loop is proven. | Hold the release to one user, federal case law, user materials, CourtListener, and one research-answer workflow. |

## 17. Open product decisions

These decisions do not block the first engineering spikes, but must be resolved before private alpha positioning:

1. Final product name and visual identity.
2. Primary alpha persona: solo lawyer, litigation associate, in-house counsel, or legal-research team.
3. Default work product: research answer, short memo, or formal long-form memo.
4. Supported desktop operating systems and minimum hardware for local OCR/reranking.
5. Default evidence mode for new matters: adaptive evidence mode or strict visual mode.
6. Whether confidential matters may use personal ChatGPT workspaces or require organizational workspace controls.
7. Initial export formats beyond Markdown/JSON, including DOCX and PDF.
8. Attorney reviewers and the first gold-question set.

## 18. Definition of done

The MVP is done only when:

- All P0 requirements have automated or documented acceptance evidence.
- The attorney-reviewed corpus meets approved release thresholds.
- A clean install completes the primary workflow without an OpenAI API key.
- Every model-visible source is materialized and recorded.
- Every clickable citation resolves to immutable exact passages after restart.
- Verification states cannot be forged through model output.
- Known limitations, source coverage, data egress, and as-of dates are visible.
- Security and prompt-injection tests pass.
- The architecture ADRs, evaluation results, license notices, and user-facing limitations are published with the alpha.

## 19. Follow-on specifications

This PRD should be followed by:

1. `evaluation-plan.md` — corpus format, gold labels, metrics, thresholds, and review process.
2. `technical-spikes.md` — subscription backend, Docling provenance, and citation round-trip spike plans.
3. `data-contracts.md` — source, representation, passage, claim, evidence, and ledger schemas.
4. `threat-model.md` — trust boundaries, source injection, parser isolation, egress, tenancy, and lifecycle risks.
5. ADRs for subscription backend, evidence-worker boundary, blob storage, and citation finalization.
