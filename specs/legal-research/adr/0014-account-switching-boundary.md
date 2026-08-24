# ADR 0014: account switching is separate from matter persistence

Status: accepted

Date: 2026-08-24

## Decision

Use the Codex app-server account protocol for explicit ChatGPT logout and device-code login. Account operations do not write to the legal-research database or blob store. A pending login is held only in workbench process memory, its one-time code is shown only in the current page, and the app-server client is closed after completion, failure, cancellation, or workbench shutdown.

Changing accounts clears the prior ChatGPT egress acknowledgement. Before the next drafting request, the user must acknowledge egress to the newly displayed subscription context. Local matters, source versions, passages, citations, and exports remain available while signed out.

The verification URL must use HTTPS. The workbench does not accept or persist ChatGPT passwords, session cookies, API keys, refresh tokens, or device codes in matter data.

## Evidence

- `WB-12` creates a matter and source, logs out, completes a deterministic device-code login, and confirms the same matter and evidence remain readable.
- The existing app-server protocol fixture covers browser/device login completion, logout RPC, subscription account type, and credential redaction.
