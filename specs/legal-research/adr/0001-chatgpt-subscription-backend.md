# ADR 0001: ChatGPT subscription backend

Status: accepted and implemented
Date: 2026-08-25

## Decision

Use Codex app-server over local stdio as the only ChatGPT-subscription authentication and model-execution boundary for both ordinary OpenCode sessions and the legal workbench. Codex owns browser/device login, credential persistence, refresh, account state, and upstream model transport. Remove the direct OpenCode-to-private-ChatGPT subscription transport. Keep OpenAI API-key authentication as a separate, explicitly selected usage-based provider mode.

The adapter refuses API-key fallback in subscription mode, pins a reviewed Codex executable/protocol manifest, and translates structured app-server events rather than parsing terminal output. Each OpenCode inference creates an ephemeral Codex thread and lowers the complete OpenCode conversation into that thread. This avoids a second persistent conversation identity and makes process restart recovery depend on OpenCode's existing session record. It can be replaced by a persisted one-to-one thread mapping if later performance measurements justify the added state.

## Evidence

On the local 2026-08-23 evaluation environment, the isolated harness:

- removed `OPENAI_API_KEY` before starting Codex;
- read an authenticated ChatGPT account with plan type `prolite`;
- read the `codex` subscription rate-limit window;
- completed a read-only model turn with the exact requested response;
- restarted app-server, resumed the returned thread ID, and completed a second turn;
- passed ten automated real-child-process tests covering lifecycle, cancellation, redaction, auth-mode enforcement, failure, and compatibility behavior; and
- fingerprinted Codex CLI `0.148.0-alpha.15`, its executable, and 288 generated JSON Schema files.

The live run produced warnings from an unrelated expired Notion connector. They did not affect account reads or model turns and should be isolated from the eventual legal-research runtime configuration.

On 2026-08-25, the production OpenCode session path was switched to the same adapter and rechecked against the signed-in subscription. An ordinary `openai/gpt-5.4-mini` OpenCode session selected `llm.runtime=codex-app-server`, returned the exact requested text without an API key or refresh-token request, and surfaced a provider-executed shell command plus its output as a completed OpenCode tool event. The legal workbench had already passed the same-boundary OCR/citation smoke test.

## Remaining release gates

The live check reused an existing signed-in profile; it did not log out or disturb shared credentials. Clean-profile browser/device login, cancelled login, invalidated auth, and logout isolation remain release gates. Protocol-manifest review also remains mandatory when the installed Codex binary changes.

## Consequences

- Subscription model usage can be separated from usage-based OpenAI API credentials.
- Codex owns ChatGPT authentication, refresh, thread execution, and subscription limit reporting.
- The fork inherits an experimental upstream boundary and must fail clearly when its pinned protocol changes.
- A supervised child process and OpenCode-to-Codex event translation become production responsibilities.
- Existing stale OpenCode OAuth tokens are no longer refreshed or sent upstream; account recovery occurs through Codex app-server.
- Ordinary command/file approvals are reviewed through OpenCode's existing permission service while Codex enforces its workspace sandbox; unhandled app-server requests fail closed.
- Legal source ingestion, retrieval, and citation truth remain outside Codex and must be implemented in the evidence layer described in the architecture.

## Re-evaluation trigger

Revisit this ADR when OpenAI changes app-server's support status, when the pinned schema changes, or before enabling the adapter for confidential or production legal matters.
