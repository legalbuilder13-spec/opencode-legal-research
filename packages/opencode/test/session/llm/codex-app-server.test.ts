// oxlint-disable typescript-eslint/no-unsafe-type-assertion -- focused partial provider fixtures
import { describe, expect, test } from "bun:test"
import { adapterState, conversationPrompt, status, toEvents } from "../../../src/session/llm/codex-app-server"

describe("Codex app-server LLM runtime", () => {
  test("selects only OpenAI ChatGPT subscription requests", () => {
    const base = {
      model: { providerID: "openai" },
      provider: { id: "openai" },
      auth: { type: "oauth" },
    }
    expect(status(base as never)).toEqual({ type: "supported" })
    expect(status({ ...base, auth: { type: "api", key: "sk-test" } } as never)).toEqual({
      type: "unsupported",
      reason: "OpenAI auth is not ChatGPT subscription mode",
    })
    expect(status({ ...base, model: { providerID: "anthropic" }, provider: { id: "anthropic" } } as never)).toEqual({
      type: "unsupported",
      reason: "provider is not OpenAI",
    })
  })

  test("preserves conversation roles when lowering a fresh app-server thread", () => {
    expect(
      conversationPrompt([
        { role: "user", content: "Find the rule." },
        { role: "assistant", content: [{ type: "text", text: "The rule is..." }] },
        { role: "user", content: "Give me the source." },
      ] as never),
    ).toBe(
      "<user>\nFind the rule.\n</user>\n\n<assistant>\nThe rule is...\n</assistant>\n\n<user>\nGive me the source.\n</user>",
    )
  })

  test("maps streamed text and provider-executed activity into OpenCode events", () => {
    const state = adapterState()
    const started = toEvents(
      state,
      {
        sequence: 1,
        method: "item/started",
        params: {
          item: {
            type: "commandExecution",
            id: "command-1",
            command: "pwd",
            cwd: "/tmp/project",
            status: "inProgress",
          },
        },
      },
      false,
    )
    expect(started).toMatchObject([
      { type: "tool-call", id: "command-1", name: "codex_command", providerExecuted: true },
    ])

    const completed = toEvents(
      state,
      {
        sequence: 2,
        method: "item/completed",
        params: {
          item: {
            type: "commandExecution",
            id: "command-1",
            status: "completed",
            aggregatedOutput: "/tmp/project\n",
            exitCode: 0,
          },
        },
      },
      false,
    )
    expect(completed).toMatchObject([
      { type: "tool-result", id: "command-1", name: "codex_command", providerExecuted: true },
    ])

    expect(
      toEvents(
        state,
        {
          sequence: 3,
          method: "item/agentMessage/delta",
          params: { itemId: "message-7", delta: "Supported." },
        },
        false,
      ),
    ).toMatchObject([
      { type: "text-start", id: "message-7" },
      { type: "text-delta", id: "message-7", text: "Supported." },
    ])

    expect(
      toEvents(
        state,
        {
          sequence: 4,
          method: "item/agentMessage/delta",
          params: { itemId: "message-8", delta: " Final." },
        },
        false,
      ),
    ).toMatchObject([
      { type: "text-end", id: "message-7" },
      { type: "text-start", id: "message-8" },
      { type: "text-delta", id: "message-8", text: " Final." },
    ])

    expect(
      toEvents(
        state,
        {
          sequence: 5,
          method: "turn/completed",
          params: { turn: { id: "turn-1", status: "completed" } },
        },
        false,
      ),
    ).toMatchObject([
      { type: "text-end", id: "message-8" },
      { type: "step-finish", reason: "stop" },
      { type: "finish", reason: "stop" },
    ])
  })
})
