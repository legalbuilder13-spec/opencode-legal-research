# Codex app-server subscription spike

This private workspace package tests whether the OpenCode fork can execute model turns through a signed-in ChatGPT account without an OpenAI API key. It is deliberately isolated from OpenCode's production provider path.

## Safety boundary

- Uses Codex app-server's default JSONL-over-stdio transport.
- Removes `OPENAI_API_KEY` from the child environment unless `requireSubscription: false` is explicitly set in code.
- Starts threads with `sandbox: "read-only"` and `approvalPolicy: "never"`.
- Redacts credentials, login URLs/codes, identity fields, prompts, and model text from optional protocol transcripts.
- Does not log out, mutate shared authentication, expose legal tools, or alter OpenCode sessions.

OpenAI currently describes app-server as experimental and unsupported for production workloads. This package is a feasibility harness, not yet a supported production adapter.

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

The tests launch a real fixture process and exchange newline-delimited JSON-RPC. They cover subscription-only environment handling, browser/device login notifications, streaming, restart/resume, interruption, rate-limit mapping, transcript redaction, controlled API-key opt-in, process failure, and schema drift detection.
