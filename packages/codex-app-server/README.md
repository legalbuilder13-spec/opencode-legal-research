# Codex app-server subscription adapter

This private workspace package is the shared ChatGPT-subscription boundary for ordinary OpenCode sessions and legal-workbench synthesis. It executes model turns through a signed-in ChatGPT account without an OpenAI API key.

## Safety boundary

- Uses Codex app-server's default JSONL-over-stdio transport.
- Removes `OPENAI_API_KEY` from the child environment unless `requireSubscription: false` is explicitly set in code.
- Defaults standalone/legal synthesis threads to `sandbox: "read-only"` and `approvalPolicy: "never"`; ordinary OpenCode chat explicitly selects workspace-write sandboxing with `approvalPolicy: "on-request"` and routes approval requests through OpenCode permissions.
- Redacts credentials, login URLs/codes, identity fields, prompts, and model text from optional protocol transcripts.
- Does not copy ChatGPT credentials into OpenCode or legal matter storage.

The protocol manifest remains pinned and must be reviewed when the installed Codex executable changes.

## Commands

Run from this directory:

```sh
bun test
bun run typecheck
CODEX_APP_SERVER_BIN=/path/to/codex bun src/cli.ts inspect
CODEX_APP_SERVER_BIN=/path/to/codex bun src/cli.ts verify protocol-manifest.json
CODEX_APP_SERVER_BIN=/path/to/codex bun src/cli.ts status
CODEX_APP_SERVER_BIN=/path/to/codex bun src/cli.ts rate-limits
CODEX_APP_SERVER_BIN=/path/to/codex bun src/cli.ts turn "Reply with exactly: subscription spike ok"
CODEX_APP_SERVER_BIN=/path/to/codex bun src/cli.ts resume THREAD_ID "Continue"
```

`login-browser` and `login-device` are available for a disposable clean profile. Do not run `logout` against a shared developer profile as part of an automated test.

The compatibility manifest pins the executable hash and the hash of all generated JSON Schema files. A changed binary or schema must be reviewed before updating the manifest.

## Automated coverage

The tests launch a real fixture process and exchange newline-delimited JSON-RPC. They cover subscription-only environment handling, browser/device login notifications, rich turn-event streaming, restart/resume, interruption, rate-limit mapping, transcript redaction, controlled API-key opt-in, process failure, and schema drift detection. OpenCode adapter tests separately cover runtime selection, conversation lowering, and translation of text and provider-executed tool events.
