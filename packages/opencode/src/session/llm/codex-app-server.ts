import type { Auth } from "@/auth"
import type { Provider } from "@/provider/provider"
import { errorMessage } from "@/util/error"
import { connect, type ServerRequest, type TurnNotification } from "@legalbuilder/codex-app-server-spike"
import { LLMEvent, ToolResultValue, type LLMEvent as Event } from "@opencode-ai/llm"
import { Stream } from "effect"
import type { ModelMessage } from "ai"

type StatusInput = {
  readonly model: Provider.Model
  readonly provider: Provider.Info
  readonly auth: Auth.Info | undefined
}

type StreamInput = StatusInput & {
  readonly cwd: string
  readonly sessionID: string
  readonly system: string[]
  readonly messages: ModelMessage[]
  readonly small?: boolean
  readonly abort: AbortSignal
  readonly approve: (request: ServerRequest) => Promise<unknown>
}

export type RuntimeStatus = { readonly type: "supported" } | { readonly type: "unsupported"; readonly reason: string }

export type StreamResult =
  | { readonly type: "supported"; readonly stream: Stream.Stream<Event, unknown> }
  | { readonly type: "unsupported"; readonly reason: string }

export type AdapterState = {
  textOpen: boolean
  textID: string
  tools: Map<string, string>
  finished: boolean
}

export function adapterState(): AdapterState {
  return { textOpen: false, textID: "codex-message", tools: new Map(), finished: false }
}

export function status(input: StatusInput): RuntimeStatus {
  if (input.provider.id !== "openai" || input.model.providerID !== "openai") {
    return { type: "unsupported", reason: "provider is not OpenAI" }
  }
  if (input.auth?.type !== "oauth") {
    return { type: "unsupported", reason: "OpenAI auth is not ChatGPT subscription mode" }
  }
  return { type: "supported" }
}

export function stream(input: StreamInput): StreamResult {
  const current = status(input)
  if (current.type === "unsupported") return current

  const source = async function* (): AsyncGenerator<Event> {
    const client = await connect({
      cwd: input.cwd,
      requireSubscription: true,
      onServerRequest: (request) => input.approve(request),
    })
    let turn: Awaited<ReturnType<typeof client.startTurn>> | undefined
    const interrupt = () => {
      if (turn) void client.interruptTurn(turn).catch(() => undefined)
    }
    input.abort.addEventListener("abort", interrupt, { once: true })

    try {
      const thread = await client.startThread({
        cwd: input.cwd,
        model: input.model.api.id,
        ephemeral: true,
        approvalPolicy: "on-request",
        sandbox: input.small ? "read-only" : "workspace-write",
        developerInstructions: input.system.filter(Boolean).join("\n\n"),
        serviceName: "legalbuilder_opencode",
      })
      turn = await client.startTurn(thread.threadId, conversationPrompt(input.messages))
      const state = adapterState()
      yield LLMEvent.stepStart({ index: 0 })

      for await (const notification of client.streamTurn(turn)) {
        if (input.abort.aborted) throw new DOMException("The request was aborted", "AbortError")
        for (const event of toEvents(state, notification, input.small ?? false)) yield event
      }

      if (!state.finished) throw new Error("Codex app-server turn ended without a completion event")
    } finally {
      input.abort.removeEventListener("abort", interrupt)
      await client.close()
    }
  }

  return {
    type: "supported",
    stream: Stream.fromAsyncIterable(source(), (cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
  }
}

export function toEvents(state: AdapterState, notification: TurnNotification, small: boolean): Event[] {
  const params = record(notification.params)
  if (notification.method === "item/agentMessage/delta") {
    const delta = typeof params.delta === "string" ? params.delta : ""
    if (!delta) return []
    const id = typeof params.itemId === "string" ? params.itemId : "codex-message"
    const events: Event[] = []
    if (state.textOpen && state.textID !== id) {
      events.push(LLMEvent.textEnd({ id: state.textID }))
      state.textOpen = false
    }
    if (!state.textOpen) {
      state.textOpen = true
      state.textID = id
      events.push(LLMEvent.textStart({ id }))
    }
    events.push(LLMEvent.textDelta({ id, text: delta }))
    return events
  }

  if (!small && (notification.method === "item/started" || notification.method === "item/completed")) {
    const item = record(params.item)
    const id = typeof item.id === "string" ? item.id : undefined
    const name = toolName(item)
    if (id && name) {
      if (notification.method === "item/started") {
        state.tools.set(id, name)
        return [LLMEvent.toolCall({ id, name, input: toolInput(item), providerExecuted: true })]
      }
      const started = state.tools.get(id) ?? name
      state.tools.delete(id)
      if (toolFailed(item)) {
        return [LLMEvent.toolError({ id, name: started, message: toolFailure(item), error: toolFailure(item) })]
      }
      return [
        LLMEvent.toolResult({
          id,
          name: started,
          result: ToolResultValue.make(toolOutput(item), "text"),
          providerExecuted: true,
        }),
      ]
    }
  }

  if (notification.method !== "turn/completed") return []
  state.finished = true
  const turn = record(params.turn)
  const status = typeof turn.status === "string" ? turn.status : "failed"
  if (status === "failed") {
    const failure = record(turn.error)
    throw new Error(typeof failure.message === "string" ? failure.message : "Codex app-server turn failed")
  }

  const events: Event[] = []
  if (state.textOpen) events.push(LLMEvent.textEnd({ id: state.textID }))
  const reason = status === "interrupted" ? "unknown" : "stop"
  events.push(LLMEvent.stepFinish({ index: 0, reason }), LLMEvent.finish({ reason }))
  return events
}

export function conversationPrompt(messages: ModelMessage[]) {
  const rendered = messages
    .map((message) => {
      const content = messageContent(message.content)
      return content ? `<${message.role}>\n${content}\n</${message.role}>` : ""
    })
    .filter(Boolean)
    .join("\n\n")
  return rendered || "Continue the conversation."
}

function messageContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return json(content)
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return String(part)
      const value = record(part)
      if (typeof value.text === "string") return value.text
      if (value.type === "tool-call") {
        const name = typeof value.toolName === "string" ? value.toolName : "unknown"
        return `[tool call ${name}] ${json(value.input)}`
      }
      if (value.type === "tool-result")
        return `[tool result ${typeof value.toolName === "string" ? value.toolName : "unknown"}] ${json(value.output)}`
      if (value.type === "file") {
        const name =
          typeof value.filename === "string"
            ? value.filename
            : typeof value.mediaType === "string"
              ? value.mediaType
              : "attachment"
        return `[file ${name}]`
      }
      return json(value)
    })
    .filter(Boolean)
    .join("\n")
}

function toolName(item: Record<string, unknown>) {
  switch (item.type) {
    case "commandExecution":
      return "codex_command"
    case "fileChange":
      return "codex_file_change"
    case "mcpToolCall":
      return "codex_mcp_tool"
    case "dynamicToolCall":
      return typeof item.tool === "string" ? item.tool : "codex_dynamic_tool"
    case "webSearch":
      return "codex_web_search"
    case "imageView":
      return "codex_image_view"
    default:
      return undefined
  }
}

function toolInput(item: Record<string, unknown>) {
  switch (item.type) {
    case "commandExecution":
      return { command: item.command, cwd: item.cwd }
    case "fileChange":
      return { changes: item.changes }
    case "mcpToolCall":
      return { server: item.server, tool: item.tool, arguments: item.arguments }
    case "dynamicToolCall":
      return item.arguments ?? {}
    case "webSearch":
      return { query: item.query, action: item.action }
    case "imageView":
      return { path: item.path }
    default:
      return item
  }
}

function toolFailed(item: Record<string, unknown>) {
  return item.status === "failed" || item.status === "declined" || Boolean(item.error)
}

function toolFailure(item: Record<string, unknown>) {
  if (typeof item.error === "string") return item.error
  if (item.error) return json(item.error)
  const type = typeof item.type === "string" ? item.type : "tool"
  const status = typeof item.status === "string" ? item.status : "failed"
  return `Codex ${type} ${status}`
}

function toolOutput(item: Record<string, unknown>) {
  if (item.type === "commandExecution") {
    const output = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : ""
    const exitCode = typeof item.exitCode === "number" ? item.exitCode : "unknown"
    return `${output}${output ? "\n" : ""}Exit code: ${exitCode}`
  }
  if (item.type === "fileChange") return `Applied file changes: ${json(item.changes)}`
  if (item.type === "mcpToolCall") return json(item.result ?? item.error ?? { status: item.status })
  if (item.type === "dynamicToolCall") return json(item.contentItems ?? { success: item.success })
  return json(item)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
}

function json(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch (cause) {
    return errorMessage(cause)
  }
}

export * as CodexAppServerRuntime from "./codex-app-server"
