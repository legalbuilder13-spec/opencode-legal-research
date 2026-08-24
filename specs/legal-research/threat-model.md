# Legal research threat model

Status: alpha baseline

Date: 2026-08-24

## Assets and security goals

Protected assets include privileged matter content, original source bytes, ChatGPT and connector credentials, research history, citation integrity, attorney annotations, and export receipts. The primary goals are confidentiality, strict matter isolation, immutable evidence identity, complete provenance, explicit egress, and resistance to source-borne instructions.

## Trust boundaries

| Boundary                       | Untrusted input                                       | Required control                                                                                      |
| ------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| User/device to local app       | Files, pasted text, URLs, matter labels               | Validate size/type; restrict URLs to public HTTP(S); label confidentiality; never execute active content. |
| Source/tool to materializer    | Web bodies, connector blocks, CourtListener JSON/HTML | Persist before inference; hash originals; strip active HTML; mark text as untrusted source data.      |
| Parser worker to host          | OCR text, coordinates, warnings, page assets          | Supervised protocol; version engines; validate counts/geometry/hashes; fail closed on partial output. |
| Retrieval to model context     | Ranked and neighboring passages                       | Enforce matter ID; send only persisted passage envelopes; log every admitted passage.                 |
| Local app to ChatGPT workspace | Matter question and selected evidence                 | Show backend/workspace egress before first use; no API-key implication; redact diagnostics.           |
| Local app to CourtListener     | Search query and token                                | Disclose query egress; keep token out of logs/exports; handle rate/auth failures distinctly.          |
| Model output to final UI       | Prose, proposed claims, passage IDs                   | Treat as untrusted; reload IDs; verify hashes/ownership; mint anchors in application code only.       |
| Export to external file        | Answer and provenance metadata                        | Require explicit user action; name matter/scope; avoid embedding unrelated matter content.            |

## Principal threats and controls

### Source prompt injection

An opinion, webpage, client file, or connector response may instruct the agent to ignore policy, reveal data, bypass citation checks, or call tools. Source material is always data. The materializer returns an explicit `untrustedSourceData` envelope, and only host policy may authorize tools or egress. Adversarial corpus cases exercise document and connector bypass attempts.

### Cross-matter disclosure

An attacker may guess a passage/source ID or induce semantic retrieval across matters. Every passage lookup, search query, export, and source action carries a matter ID and checks ownership. Isolation tests use valid IDs from a second matter, not only missing IDs.

### Citation forgery and evidence drift

Model prose can fabricate footnotes, URLs, quotes, cases, or verification labels; remote content can also change after capture. The application owns source identity and anchors, original bytes are immutable, changed retrieval creates a new version, and verified display rechecks passage hashes. A real case is never labeled good law merely because it resolves.

### Parser and active-content compromise

PDF, DOCX, image, and HTML inputs can exploit parsers or execute scripts/macros. Parsing belongs in a supervised worker. The alpha host forwards an environment allowlist that excludes application and connector credentials, limits execution to five minutes, bounds stdout and stderr to 4 MB each, constrains page assets to the assigned job directory before and after symlink resolution, and independently validates result hashes and geometry. The worker applies OS CPU, output-file, core-dump, and descriptor limits before parser import; it also bounds source bytes, page ranges/count, pixels, items, normalized text, DOCX entries/expanded bytes/compression ratio, and malformed images. HTML is parsed inertly; scripts/styles are discarded for text extraction. Viewers render stored page images or structural text, not source macros or live scripts. Production packaging still needs OS memory/network isolation and broader malformed-file fuzzing.

### Public-web SSRF and active content

URL capture accepts only credential-free HTTP(S) on standard ports, resolves every initial/redirect/final hostname, and rejects local, private, link-local, and reserved addresses. Redirect count and response/screenshot sizes are bounded. Structural HTML is archived and parsed inertly. Strict mode cannot silently downgrade when the supervised renderer is absent. Production rendering must additionally pin the validated address to the network connection, block or separately validate subresources, and test DNS rebinding before untrusted URLs are enabled outside the alpha boundary.

### Credential and diagnostic leakage

ChatGPT auth, CourtListener tokens, matter text, and raw tool payloads must not enter default logs. The adapter redacts credential-shaped fields; core tests assert that default diagnostics contain no source text. CourtListener tokens remain in page memory, clear on reload, and are absent from local storage, matter records, and exports. Production telemetry must remain opt-in and structured around IDs, timing, counts, and error classes.

### Excessive or undisclosed egress

Personal ChatGPT workspace use may be inappropriate for privileged matters. Before first use the UI identifies subscription-backed research and warns that matter evidence is sent to the selected ChatGPT workspace. CourtListener search disclosure is separate. Organizational policy, retention, training, and data-control decisions remain deployment prerequisites.

### Availability and resource exhaustion

Large or malformed documents, OCR, rate limits, or a stalled model may exhaust CPU, memory, disk, or time. The upload host caps source files at 100 MB; the worker host enforces execution/output limits; the protocol supports progress/cancellation and quality failures; and adapters surface auth/rate-limit classes. Production gates still require page/decompression limits, CPU/memory/disk quotas, crash recovery, and compaction policies.

### Unsafe deletion and retention assumptions

Deleting a source or matter may leave a content-addressed blob referenced elsewhere. Destructive actions must name the scope and report retention. Logical deletion removes content from retrieval immediately; physical compaction requires a reference proof and audit event.

## Security acceptance evidence

- Matter and retrieval isolation tests.
- Tool-result interception before context.
- Incomplete-capture exclusion.
- Passage-hash and fabricated-anchor citation tests.
- Inert CourtListener HTML parsing and cross-origin URL rejection.
- Inert uploaded-HTML parsing, worker credential-environment exclusion, bounded output paths, and execution/output limits.
- No-source-text diagnostic test.
- Deterministic adversarial corpus with prompt injection, cross-matter, connector bypass, hash corruption, incomplete capture, and fabricated anchor cases.
- Loopback-only default workbench binding and page-memory-only CourtListener token browser gate.

## Open production gates

- Add OS-enforced memory, filesystem-namespace, and network isolation around the Docling/OCR worker.
- Fuzz malformed PDF, DOCX, HTML, image, archive, and decompression-bomb inputs.
- Add OS keychain-backed connector credentials and rotation/revocation tests.
- Complete organizational ChatGPT workspace policy and retention review for confidential matters.
- Add authenticated local UI access before any deployment intentionally binds beyond loopback.
- Complete dependency, license, secret, and supply-chain scanning in CI.
- Have security and legal reviewers approve the full adversarial corpus and deletion/retention policy.
