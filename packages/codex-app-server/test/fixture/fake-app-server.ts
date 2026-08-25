import { mkdir } from "node:fs/promises"
import { createInterface } from "node:readline"

const args = Bun.argv.slice(2)

if (args[0] === "--version") {
  console.log("codex-cli fake-1.0.0")
  process.exit(0)
}

if (args[0] === "app-server" && args[1] === "generate-json-schema") {
  const outputIndex = args.indexOf("--out")
  const output = args[outputIndex + 1]
  if (!output) throw new Error("Missing schema output directory")
  await mkdir(output, { recursive: true })
  await Bun.write(
    `${output}/protocol.json`,
    `${JSON.stringify({ title: "Fake Codex app-server protocol", version: 1 }, null, 2)}\n`,
  )
  process.exit(0)
}

let threadCount = 0
let turnCount = 0
let loginCount = 0
let serverRequestCount = 900
const pendingTurns = new Map<string, { threadId: string; turnId: string }>()
const pendingApprovals = new Map<number, { threadId: string; turnId: string }>()

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of lines) {
  if (!line.trim()) continue
  await receive(record(JSON.parse(line)))
}

async function receive(message: Record<string, unknown>) {
  if (typeof message.id === "number" && pendingApprovals.has(message.id) && "result" in message) {
    const pending = pendingApprovals.get(message.id)!
    pendingApprovals.delete(message.id)
    const decision = record(message.result).decision
    notify("item/completed", {
      threadId: pending.threadId,
      turnId: pending.turnId,
      item: {
        type: "commandExecution",
        id: "command-approved",
        command: "pwd",
        cwd: "/tmp/project",
        status: decision === "accept" ? "completed" : "declined",
        aggregatedOutput: decision === "accept" ? "/tmp/project\n" : "",
        exitCode: decision === "accept" ? 0 : null,
      },
    })
    notify("turn/completed", { threadId: pending.threadId, turn: turn(pending.turnId, "completed") })
    return
  }
  if (typeof message.id !== "number" || typeof message.method !== "string") return
  const id = message.id
  const method = message.method
  const params = record(message.params)

  if (method === "initialize") {
    respond(id, {
      userAgent: "fake-codex-app-server/1.0.0",
      codexHome: "/tmp/fake-codex-home",
      platformFamily: "unix",
      platformOs: "darwin",
    })
    return
  }
  if (method === "account/read") {
    if (process.env.FAKE_ACCOUNT_TYPE === "signedOut") {
      respond(id, { requiresOpenaiAuth: true, account: null })
      return
    }
    const apiKeyAccount = process.env.FAKE_ACCOUNT_TYPE === "apiKey" || Boolean(process.env.OPENAI_API_KEY)
    respond(id, {
      requiresOpenaiAuth: true,
      account: apiKeyAccount ? { type: "apiKey" } : { type: "chatgpt", email: "lawyer@example.com", planType: "plus" },
    })
    return
  }
  if (method === "account/login/start") {
    const loginId = `login-${++loginCount}`
    if (params.type === "chatgptDeviceCode") {
      respond(id, {
        type: "chatgptDeviceCode",
        loginId,
        verificationUrl: "https://example.com/device?token=secret",
        userCode: "SECRET-CODE",
      })
    } else {
      respond(id, { type: "chatgpt", loginId, authUrl: "https://example.com/login?token=secret" })
    }
    notify("account/login/completed", { loginId, success: true, error: null })
    return
  }
  if (method === "account/login/cancel" || method === "account/logout") {
    respond(id, {})
    return
  }
  if (method === "account/rateLimits/read") {
    respond(id, {
      rateLimits: {
        limitId: "codex",
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: null,
        rateLimitReachedType: null,
      },
    })
    return
  }
  if (method === "thread/start") {
    respond(id, { thread: { id: `thread-${++threadCount}` } })
    return
  }
  if (method === "thread/resume") {
    respond(id, { thread: { id: params.threadId } })
    return
  }
  if (method === "turn/start") {
    const threadId = String(params.threadId)
    const turnId = `turn-${++turnCount}`
    const input = Array.isArray(params.input) ? record(params.input[0]) : {}
    respond(id, { turn: turn(turnId, "inProgress") })
    if (input.text === "wait") {
      pendingTurns.set(turnId, { threadId, turnId })
      return
    }
    if (input.text === "approval") {
      const requestId = ++serverRequestCount
      notify("item/started", {
        threadId,
        turnId,
        item: {
          type: "commandExecution",
          id: "command-approved",
          command: "pwd",
          cwd: "/tmp/project",
          status: "inProgress",
        },
      })
      pendingApprovals.set(requestId, { threadId, turnId })
      write({
        method: "item/commandExecution/requestApproval",
        id: requestId,
        params: { threadId, turnId, itemId: "command-approved", command: "pwd", cwd: "/tmp/project" },
      })
      return
    }
    if (input.text === "tools") {
      notify("item/started", {
        threadId,
        turnId,
        item: {
          type: "commandExecution",
          id: "command-1",
          command: "pwd",
          cwd: "/tmp/project",
          status: "inProgress",
        },
      })
      notify("item/completed", {
        threadId,
        turnId,
        item: {
          type: "commandExecution",
          id: "command-1",
          command: "pwd",
          cwd: "/tmp/project",
          status: "completed",
          aggregatedOutput: "/tmp/project\n",
          exitCode: 0,
        },
      })
    }
    notify("item/agentMessage/delta", { threadId, turnId, itemId: "message-1", delta: "hello " })
    notify("item/agentMessage/delta", { threadId, turnId, itemId: "message-1", delta: "world" })
    notify("turn/completed", { threadId, turn: turn(turnId, "completed") })
    return
  }
  if (method === "turn/interrupt") {
    const turnId = String(params.turnId)
    const pending = pendingTurns.get(turnId)
    respond(id, {})
    if (pending) {
      pendingTurns.delete(turnId)
      notify("turn/completed", { threadId: pending.threadId, turn: turn(turnId, "interrupted") })
    }
    return
  }
  if (method === "test/secret") {
    respond(id, {
      accessToken: "sk-secret-token-value",
      authorization: "Bearer deeply-secret-value",
      email: "lawyer@example.com",
    })
    return
  }
  if (method === "test/exit") process.exit(23)

  error(id, -32601, `Unknown method: ${method}`)
}

function respond(id: number, result: unknown) {
  write({ id, result })
}

function error(id: number, code: number, message: string) {
  write({ id, error: { code, message } })
}

function notify(method: string, params: unknown) {
  write({ method, params })
}

function write(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
}

function turn(id: string, status: string) {
  return { id, status, items: [], error: null }
}
