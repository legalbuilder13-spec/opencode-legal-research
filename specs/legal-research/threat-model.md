# Legal research threat model

Status: alpha baseline

Date: 2026-08-24

## Assets and security goals

Protected assets include privileged matter content, original source bytes, ChatGPT and connector credentials, research history, citation integrity, attorney annotations, and export receipts. The primary goals are confidentiality, strict matter isolation, immutable evidence identity, complete provenance, explicit egress, and resistance to source-borne instructions.

## Trust boundaries

| Boundary                       | Untrusted input                                       | Required control                                                                                          |
| ------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| User/device to local app       | Files, pasted text, URLs, matter labels               | Validate size/type; restrict URLs to public HTTP(S); label confidentiality; never execute active content. |
| Source/tool to materializer    | Web bodies, connector blocks, CourtListener JSON/HTML | Persist before inference; hash originals; strip active HTML; mark text as untrusted source data.          |
| Parser worker to host          | OCR text, coordinates, warnings, page assets          | Supervised protocol; version engines; validate counts/geometry/hashes; fail closed on partial output.     |
| Retrieval to model context     | Ranked and neighboring passages                       | Enforce matter ID; send only persisted passage envelopes; log every admitted passage.                     |
| Local app to ChatGPT workspace | Matter question and selected evidence                 | Show backend/workspace egress before first use; no API-key implication; redact diagnostics.               |
| Local app to CourtListener     | Search query and token                                | Disclose query egress; keep token out of logs/exports; handle rate/auth failures distinctly.              |
| Model output to final UI       | Prose, proposed claims, passage IDs                   | Treat as untrusted; reload IDs; verify hashes/ownership; mint anchors in application code only.           |
| Export to external file        | Answer and provenance metadata                        | Require explicit user action; name matter/scope; avoid embedding unrelated matter content.                |

## Principal threats and controls

### Source prompt injection

An opinion, webpage, client file, or connector response may instruct the agent to ignore policy, reveal data, bypass citation checks, or call tools. Source material is always data. The materializer returns an explicit `untrustedSourceData` JSON envelope, and only host policy may authorize tools or egress. Six deterministic prompt-injection variants prove that quoting, role-switching, JSON-escape text, external links, cross-matter demands, and capture-bypass instructions remain inside that envelope. The corpus and tests are engineering evidence, not attorney or security approval.

### Cross-matter disclosure

An attacker may guess a passage/source ID or induce semantic retrieval across matters. Every passage lookup, search query, export, and source action carries a matter ID and checks ownership. Isolation tests use valid IDs from a second matter, not only missing IDs.

### Citation forgery and evidence drift

Model prose can fabricate footnotes, URLs, quotes, cases, or verification labels; remote content can also change after capture. The application owns source identity and anchors, original bytes are immutable, changed retrieval creates a new version, and verified display rechecks passage hashes. A real case is never labeled good law merely because it resolves.

### Parser and active-content compromise

PDF, DOCX, image, and HTML inputs can exploit parsers or execute scripts/macros. Parsing belongs in a supervised worker. The alpha host forwards an environment allowlist that excludes application and connector credentials, limits execution to five minutes, bounds stdout and stderr to 4 MB each, constrains page assets to the assigned job directory before and after symlink resolution, and independently validates result hashes and geometry. Before parser import, the supervised server applies OS CPU, output-file, core-dump, and descriptor limits. Linux additionally applies an 8 GiB virtual-address-space and 256-process ceiling. macOS omits those optional limits because its reserved address map conflicts with the fixed memory value and its per-user process accounting can block Tesseract on a busy desktop. The worker also bounds source bytes, page ranges/count, pixels, items, normalized text, DOCX entries/expanded bytes/compression ratio/XML size, and malformed images. PDF admission rejects missing bounded headers and recognizable active actions, embedded files, rich media, XFA, and encryption. DOCX admission rejects path escapes, duplicate normalized names, symlinks, encryption, macros, embeddings, ActiveX, XML entities, and non-hyperlink external relationships. HTML is parsed inertly without source-network access; scripts/styles are discarded for text extraction. Viewers render stored page images or structural text, not source macros or live scripts. These conservative checks may visibly reject an otherwise readable source and do not replace parser-grade sanitization. Production packaging still needs enforceable macOS/Windows memory/process-tree containment, worker network/filesystem isolation, and coverage-guided malformed-file fuzzing.

Strict-visual web capture runs active pages only inside a fresh sandboxed Electron session with no Node integration, permissions, popups, webviews, downloads, or persistent storage. An authenticated loopback service admits one bounded capture at a time. Request interception blocks private/reserved targets, writes, frames, XHR, WebSockets, pings, media, objects, and excessive requests/resources. A second ephemeral loopback proxy resolves and validates every HTTP(S) authority and dials an address from that same answer set, so Chromium cannot re-resolve a rebinding hostname before connection. The proxy allows no direct fallback, request bodies, upgrades, or nonstandard ports and bounds aggregate traffic. Deterministic tests reject a hostname that changes from a public to a private answer before a second dial.

### Public-web SSRF and active content

URL capture accepts only credential-free HTTP(S) on standard ports, resolves every initial/redirect/final/subresource hostname, rejects local, private, link-local, and reserved addresses, and pins each connection to the selected validated IP. Redirect count, proxy traffic, and response/screenshot sizes are bounded. Structural HTML is archived and parsed inertly. Strict mode cannot silently downgrade when the supervised renderer is absent. The reviewed live-web corpus must still test reserved-address classification, redirect/subresource behavior, hostile local proxy clients, layout fidelity, and OCR before untrusted URLs leave the alpha boundary.

### Credential and diagnostic leakage

ChatGPT auth, CourtListener tokens, matter text, and raw tool payloads must not enter default logs. The adapter redacts credential-shaped fields; core tests assert that default diagnostics contain no source text. CourtListener tokens remain in page memory, clear on reload, and are absent from local storage, matter records, and exports. Production telemetry must remain opt-in and structured around IDs, timing, counts, and error classes.

### Excessive or undisclosed egress

Personal ChatGPT workspace use may be inappropriate for privileged matters. Before first use the UI identifies subscription-backed research and warns that matter evidence is sent to the selected ChatGPT workspace. CourtListener search disclosure is separate. A persisted local-only matter setting keeps ingestion, OCR, storage, retrieval, inspection, and export local while UI and API block ChatGPT synthesis before context construction. Account switching uses app-server device login, keeps the one-time session in memory, leaves the matter store untouched, and clears the prior egress acknowledgement. Organizational policy, retention, training, and data-control decisions remain deployment prerequisites.

### Availability and resource exhaustion

Large or malformed documents, OCR, rate limits, or a stalled model may exhaust CPU, memory, disk, or time. The upload host caps source files at 100 MB; the worker host enforces execution/output limits; Linux workers apply an 8 GiB address-space ceiling; the protocol supports progress/cancellation and quality failures; and adapters surface auth/rate-limit classes. Production gates still require enforceable macOS/Windows memory containment, equivalent Windows process enforcement, disk quotas, crash recovery, and compaction policies.

### Unsafe deletion and retention assumptions

Deleting a source or matter may leave a content-addressed blob referenced elsewhere. Destructive actions must name the scope and report retention. Logical deletion removes content from retrieval immediately; physical compaction requires a reference proof and audit event.

## Security acceptance evidence

- Matter and retrieval isolation tests.
- Tool-result interception before context.
- Incomplete-capture exclusion.
- Passage-hash and fabricated-anchor citation tests.
- Inert CourtListener HTML parsing and cross-origin URL rejection.
- Inert uploaded-HTML parsing, worker credential-environment exclusion, bounded output paths, and execution/output limits.
- Pinned-proxy public-address selection, deterministic private rebinding rejection, and real Electron HTTP/HTTPS capture.
- No-source-text diagnostic test.
- Twenty-four executable deterministic adversarial cases covering prompt injection, cross-matter/connector bypass, active and malformed formats, resource exhaustion, hash corruption, incomplete capture, and fabricated anchors.
- Loopback-only default workbench binding and page-memory-only CourtListener token browser gate.
- Matter-local-only persistence and pre-synthesis egress rejection.

## Open production gates

- Add filesystem/network isolation around the Docling/OCR worker, enforceable macOS memory containment, and equivalent Windows memory/process containment.
- Add coverage-guided fuzzing beyond the deterministic PDF, DOCX, HTML, image, archive, and decompression-bomb cases.
- Add OS keychain-backed connector credentials and rotation/revocation tests.
- Complete organizational ChatGPT workspace policy and retention review for confidential matters.
- Add authenticated local UI access before any deployment intentionally binds beyond loopback.
- Obtain counsel approval for the CI-generated dependency/model license receipts and exact-version overrides; generate and attest the final signed-installer SBOM; resolve or formally exclude broader nonpackaged monorepo findings.
- Have security and legal reviewers approve the full adversarial corpus and deletion/retention policy.
