# ADR 0001: ChatGPT subscription backend

Status: provisional acceptance
Date: 2026-08-23

## Decision

Use Codex app-server over local stdio as the candidate default ChatGPT-subscription execution boundary. Keep OpenCode's existing ChatGPT OAuth provider as a visibly experimental compatibility path. Do not merge the spike package into the production provider path until the remaining clean-profile and product-integration gates are complete.

The production adapter must refuse API-key fallback in subscription mode, pin a reviewed Codex executable/protocol manifest, persist the Codex thread ID beside the OpenCode session, and translate structured app-server events rather than parse terminal output.

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

## Why provisional

OpenAI's current app-server documentation describes the command as experimental and unsupported for production workloads. The live check reused an existing signed-in profile; it did not log out or disturb shared credentials. Clean-profile browser/device login, cancelled login, invalidated auth, host-level session persistence, and logout isolation therefore remain release gates.

## Consequences

- Subscription model usage can be separated from usage-based OpenAI API credentials.
- Codex owns ChatGPT authentication, refresh, thread execution, and subscription limit reporting.
- The fork inherits an experimental upstream boundary and must fail clearly when its pinned protocol changes.
- A supervised child process and OpenCode-to-Codex session mapping become production responsibilities.
- Legal source ingestion, retrieval, and citation truth remain outside Codex and must be implemented in the evidence layer described in the architecture.

## Re-evaluation trigger

Revisit this ADR when OpenAI changes app-server's support status, when the pinned schema changes, or before enabling the adapter for confidential or production legal matters.
