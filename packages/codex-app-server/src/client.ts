import { redact, redactText } from "./redact"
import { existsSync } from "node:fs"

export interface TranscriptEntry {
  direction: "client" | "server"
  at: string
  message: unknown
}

export interface ConnectOptions {
  command?: string[]
  cwd?: string
  env?: Record<string, string | undefined>
  requestTimeoutMs?: number
  notificationTimeoutMs?: number
  requireSubscription?: boolean
  onTranscript?: (entry: TranscriptEntry) => void
  onStderr?: (text: string) => void
  onServerRequest?: (request: ServerRequest) => Promise<unknown>
}

export interface ServerRequest {
  id: number
  method: string
  params: unknown
}

export interface AccountState {
  requiresOpenaiAuth: boolean
  account: { type: "chatgpt"; planType: string } | { type: "apiKey" } | { type: "amazonBedrock" } | null
}

export interface LoginStart {
  type: "chatgpt" | "chatgptDeviceCode"
  loginId: string
  authUrl?: string
  verificationUrl?: string
  userCode?: string
  cursor: number
}

export interface LoginCompletion {
  loginId: string | null
  success: boolean
  error: string | null
}

export interface ThreadHandle {
  threadId: string
}

export interface TurnHandle {
  threadId: string
  turnId: string
  cursor: number
}

export interface TurnResult extends TurnHandle {
  status: "completed" | "interrupted" | "failed" | "inProgress"
  text: string
}

export interface TurnNotification {
  sequence: number
  method: string
  params: unknown
}

export interface RateLimitWindow {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export interface RateLimitState {
  limitId: string | null
  primary: RateLimitWindow | null
  secondary: RateLimitWindow | null
  reachedType: string | null
}

type Notification = TurnNotification

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface NotificationWaiter {
  after: number
  method: string
  predicate: (params: unknown, method: string) => boolean
  resolve: (notification: Notification) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class RpcError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = "CodexAppServerRpcError"
    this.code = code
    this.data = data
  }
}

export class Client {
  private nextRequestId = 1
  private notificationSequence = 0
  private pending = new Map<number, PendingRequest>()
  private waiters = new Set<NotificationWaiter>()
  private notifications: Notification[] = []
  private closed = false
  private expectedClose = false
  private readTask: Promise<void>
  private stderrTask: Promise<void>

  constructor(
    private process: Bun.Subprocess<"pipe", "pipe", "pipe">,
    private options: Required<Pick<ConnectOptions, "requestTimeoutMs" | "notificationTimeoutMs">> & ConnectOptions,
  ) {
    this.readTask = this.readMessages().catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error))
      this.fail(failure)
      this.process.kill()
      throw failure
    })
    this.stderrTask = this.readStderr()
    void this.process.exited.then((code) => this.finish(code))
  }

  async initialize() {
    const result = requireRecord(
      await this.request("initialize", {
        clientInfo: {
          name: "legalbuilder_opencode_spike",
          title: "Legal Builder OpenCode Spike",
          version: "0.0.1",
        },
      }),
      "initialize response",
    )
    await this.notify("initialized", {})
    return {
      userAgent: requireString(result.userAgent, "initialize.userAgent"),
      codexHome: requireString(result.codexHome, "initialize.codexHome"),
      platformFamily: requireString(result.platformFamily, "initialize.platformFamily"),
      platformOs: requireString(result.platformOs, "initialize.platformOs"),
    }
  }

  async account(): Promise<AccountState> {
    const result = requireRecord(await this.request("account/read", { refreshToken: false }), "account/read response")
    if (result.account === null) {
      return {
        requiresOpenaiAuth: requireBoolean(result.requiresOpenaiAuth, "account.requiresOpenaiAuth"),
        account: null,
      }
    }

    const account = requireRecord(result.account, "account")
    const type = requireString(account.type, "account.type")
    const requiresOpenaiAuth = requireBoolean(result.requiresOpenaiAuth, "account.requiresOpenaiAuth")
    if (type === "chatgpt") {
      return {
        requiresOpenaiAuth,
        account: { type, planType: requireString(account.planType, "account.planType") },
      }
    }
    if (type === "apiKey") return { requiresOpenaiAuth, account: { type } }
    if (type === "amazonBedrock") return { requiresOpenaiAuth, account: { type } }
    throw new Error(`Unsupported account type: ${type}`)
  }

  async startLogin(type: "chatgpt" | "chatgptDeviceCode"): Promise<LoginStart> {
    const cursor = this.cursor()
    const params =
      type === "chatgpt"
        ? { type, useHostedLoginSuccessPage: true, appBrand: "chatgpt" }
        : { type: "chatgptDeviceCode" }
    const result = requireRecord(await this.request("account/login/start", params), "account/login/start response")
    const resultType = requireString(result.type, "login.type")
    if (resultType !== type) throw new Error(`Expected ${type} login, received ${resultType}`)

    return {
      type,
      loginId: requireString(result.loginId, "login.loginId"),
      authUrl: optionalString(result.authUrl, "login.authUrl"),
      verificationUrl: optionalString(result.verificationUrl, "login.verificationUrl"),
      userCode: optionalString(result.userCode, "login.userCode"),
      cursor,
    }
  }

  async waitForLogin(login: LoginStart): Promise<LoginCompletion> {
    const notification = await this.waitForNotification("account/login/completed", login.cursor, (params) => {
      const value = optionalRecord(params)
      return value?.loginId === login.loginId
    })
    const params = requireRecord(notification.params, "account/login/completed params")
    return {
      loginId: nullableString(params.loginId, "login completion id"),
      success: requireBoolean(params.success, "login completion success"),
      error: nullableString(params.error, "login completion error"),
    }
  }

  async cancelLogin(loginId: string) {
    await this.request("account/login/cancel", { loginId })
  }

  async logout() {
    await this.request("account/logout")
  }

  async rateLimits(): Promise<RateLimitState> {
    const response = requireRecord(await this.request("account/rateLimits/read"), "rate limit response")
    const snapshot = requireRecord(response.rateLimits, "rate limit snapshot")
    return {
      limitId: nullableString(snapshot.limitId, "rate limit id"),
      primary: parseRateLimitWindow(snapshot.primary, "primary rate limit"),
      secondary: parseRateLimitWindow(snapshot.secondary, "secondary rate limit"),
      reachedType: nullableString(snapshot.rateLimitReachedType, "rate limit reached type"),
    }
  }

  async startThread(input: {
    cwd: string
    model?: string
    ephemeral?: boolean
    approvalPolicy?: "untrusted" | "on-request" | "never"
    sandbox?: "read-only" | "workspace-write" | "danger-full-access"
    baseInstructions?: string
    developerInstructions?: string
    serviceName?: string
  }): Promise<ThreadHandle> {
    const response = requireRecord(
      await this.request("thread/start", {
        cwd: input.cwd,
        model: input.model,
        ephemeral: input.ephemeral ?? false,
        approvalPolicy: input.approvalPolicy ?? "never",
        sandbox: input.sandbox ?? "read-only",
        baseInstructions: input.baseInstructions,
        developerInstructions: input.developerInstructions,
        serviceName: input.serviceName,
      }),
      "thread/start response",
    )
    const thread = requireRecord(response.thread, "thread/start thread")
    return { threadId: requireString(thread.id, "thread.id") }
  }

  async resumeThread(threadId: string): Promise<ThreadHandle> {
    const response = requireRecord(await this.request("thread/resume", { threadId }), "thread/resume response")
    const thread = requireRecord(response.thread, "thread/resume thread")
    return { threadId: requireString(thread.id, "thread.id") }
  }

  async startTurn(threadId: string, text: string): Promise<TurnHandle> {
    const cursor = this.cursor()
    const response = requireRecord(
      await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text, text_elements: [] }],
      }),
      "turn/start response",
    )
    const turn = requireRecord(response.turn, "turn/start turn")
    return { threadId, turnId: requireString(turn.id, "turn.id"), cursor }
  }

  async collectTurn(handle: TurnHandle): Promise<TurnResult> {
    const chunks: string[] = []

    for await (const notification of this.streamTurn(handle)) {
      if (notification.method === "item/agentMessage/delta") {
        const params = requireRecord(notification.params, "agent message delta")
        chunks.push(requireString(params.delta, "agent message delta text"))
        continue
      }
      if (notification.method !== "turn/completed") continue
      const params = requireRecord(notification.params, "turn completion")
      const turn = requireRecord(params.turn, "completed turn")
      return {
        ...handle,
        status: requireTurnStatus(turn.status),
        text: chunks.join(""),
      }
    }

    throw new Error("Codex app-server turn stream ended without completion")
  }

  async *streamTurn(handle: TurnHandle): AsyncGenerator<TurnNotification> {
    const deadline = Date.now() + this.options.notificationTimeoutMs
    let cursor = handle.cursor

    while (true) {
      const notification = await this.waitForNotification(
        "*",
        cursor,
        (params, method) => matchesTurn(method, params, handle),
        Math.max(deadline - Date.now(), 1),
      )
      cursor = notification.sequence
      yield notification
      if (notification.method === "turn/completed") return
    }
  }

  async runTurn(threadId: string, text: string) {
    return this.collectTurn(await this.startTurn(threadId, text))
  }

  async interruptTurn(handle: TurnHandle) {
    await this.request("turn/interrupt", { threadId: handle.threadId, turnId: handle.turnId })
  }

  cursor() {
    return this.notificationSequence
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Codex app-server client is closed"))
    const id = this.nextRequestId++
    const message = params === undefined ? { method, id } : { method, id, params }
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timed out waiting for ${method} response`))
      }, this.options.requestTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
    try {
      this.send(message)
    } catch (error) {
      const pending = this.pending.get(id)
      if (pending) clearTimeout(pending.timer)
      this.pending.delete(id)
      return Promise.reject(error)
    }
    return promise
  }

  async notify(method: string, params?: unknown) {
    this.send(params === undefined ? { method } : { method, params })
  }

  async close() {
    if (this.closed) return
    this.expectedClose = true
    this.process.kill()
    await Promise.allSettled([this.process.exited, this.readTask, this.stderrTask])
  }

  private waitForNotification(
    method: string,
    after: number,
    predicate: (params: unknown, method: string) => boolean,
    timeoutMs = this.options.notificationTimeoutMs,
  ): Promise<Notification> {
    const existing = this.notifications.find(
      (item) =>
        item.sequence > after && (method === "*" || item.method === method) && predicate(item.params, item.method),
    )
    if (existing) return Promise.resolve(existing)
    if (this.closed) return Promise.reject(new Error("Codex app-server client is closed"))

    return new Promise((resolve, reject) => {
      const waiter: NotificationWaiter = {
        after,
        method,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          reject(new Error(`Timed out waiting for ${method} notification`))
        }, timeoutMs),
      }
      this.waiters.add(waiter)
    })
  }

  private send(message: unknown) {
    this.options.onTranscript?.({ direction: "client", at: new Date().toISOString(), message: redact(message) })
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
    this.process.stdin.flush()
  }

  private async readMessages() {
    const reader = this.process.stdout.getReader()
    const decoder = new TextDecoder()
    let buffered = ""

    while (true) {
      const item = await reader.read()
      if (item.done) break
      buffered += decoder.decode(item.value, { stream: true })
      const lines = buffered.split(/\r?\n/)
      buffered = lines.pop() ?? ""
      lines.filter(Boolean).forEach((line) => this.receive(JSON.parse(line)))
    }

    buffered += decoder.decode()
    if (buffered.trim()) this.receive(JSON.parse(buffered))
  }

  private async readStderr() {
    const reader = this.process.stderr.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const item = await reader.read()
      if (item.done) break
      this.options.onStderr?.(redactText(decoder.decode(item.value, { stream: true })))
    }
    const tail = decoder.decode()
    if (tail) this.options.onStderr?.(redactText(tail))
  }

  private receive(message: unknown) {
    this.options.onTranscript?.({ direction: "server", at: new Date().toISOString(), message: redact(message) })
    const value = requireRecord(message, "JSONL message")
    if (typeof value.id === "number" && ("result" in value || "error" in value)) {
      const pending = this.pending.get(value.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(value.id)
      if (value.error) {
        const error = requireRecord(value.error, "RPC error")
        pending.reject(
          new RpcError(
            requireNumber(error.code, "RPC error code"),
            requireString(error.message, "RPC error message"),
            error.data,
          ),
        )
        return
      }
      pending.resolve(value.result)
      return
    }

    if (typeof value.method !== "string") throw new Error("Invalid app-server message")
    if (typeof value.id === "number") {
      const request = { id: value.id, method: value.method, params: value.params } satisfies ServerRequest
      const handler = this.options.onServerRequest
      if (!handler) {
        this.send({ id: value.id, error: { code: -32601, message: `Unsupported server request: ${value.method}` } })
        return
      }
      void handler(request).then(
        (result) => this.send({ id: value.id, result }),
        (cause) =>
          this.send({
            id: value.id,
            error: { code: -32000, message: cause instanceof Error ? cause.message : String(cause) },
          }),
      )
      return
    }

    const notification = {
      sequence: ++this.notificationSequence,
      method: value.method,
      params: value.params,
    }
    this.notifications.push(notification)
    for (const waiter of this.waiters) {
      if (notification.sequence <= waiter.after) continue
      if (waiter.method !== "*" && waiter.method !== notification.method) continue
      if (!waiter.predicate(notification.params, notification.method)) continue
      clearTimeout(waiter.timer)
      this.waiters.delete(waiter)
      waiter.resolve(notification)
    }
  }

  private finish(code: number) {
    if (this.closed) return
    const error = new Error(
      this.expectedClose ? "Codex app-server client closed" : `Codex app-server exited unexpectedly with code ${code}`,
    )
    this.fail(error)
  }

  private fail(error: Error) {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.waiters.clear()
  }
}

export async function connect(options: ConnectOptions = {}) {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...options.env }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  if (options.requireSubscription !== false) delete env.OPENAI_API_KEY
  const command = options.command ?? [resolveCodexBinary(), "app-server", "--listen", "stdio://"]
  const processHandle = Bun.spawn(command, {
    cwd: options.cwd,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const client = new Client(processHandle, {
    ...options,
    requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
    notificationTimeoutMs: options.notificationTimeoutMs ?? 120_000,
  })
  return client
    .initialize()
    .then(async () => {
      if (options.requireSubscription === false) return client
      const state = await client.account()
      if (!state.account) {
        throw new Error("ChatGPT subscription sign-in is required in Codex app-server")
      }
      if (state.account.type !== "chatgpt") {
        throw new Error(`Subscription mode requires ChatGPT account auth; received ${state.account.type}`)
      }
      return client
    })
    .catch(async (error) => {
      await client.close()
      throw error
    })
}

function resolveCodexBinary() {
  if (process.env.CODEX_APP_SERVER_BIN) return process.env.CODEX_APP_SERVER_BIN
  const fromPath = Bun.which("codex")
  if (fromPath) return fromPath
  if (process.platform === "darwin") {
    const applications = [
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      "/Applications/Codex.app/Contents/Resources/codex",
    ]
    const installed = applications.find(existsSync)
    if (installed) return installed
  }
  return "codex"
}

function matchesTurn(method: string, params: unknown, handle: TurnHandle) {
  const value = optionalRecord(params)
  if (!value || value.threadId !== handle.threadId) return false
  if (method === "turn/completed") return optionalRecord(value.turn)?.id === handle.turnId
  return value.turnId === handle.turnId
}

function parseRateLimitWindow(value: unknown, name: string): RateLimitWindow | null {
  if (value === null) return null
  const window = requireRecord(value, name)
  return {
    usedPercent: requireNumber(window.usedPercent, `${name}.usedPercent`),
    windowDurationMins: nullableNumber(window.windowDurationMins, `${name}.windowDurationMins`),
    resetsAt: nullableNumber(window.resetsAt, `${name}.resetsAt`),
  }
}

function requireTurnStatus(value: unknown): TurnResult["status"] {
  if (value === "completed" || value === "interrupted" || value === "failed" || value === "inProgress") return value
  throw new Error("Invalid turn status")
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return Object.fromEntries(Object.entries(value))
  throw new Error(`Expected ${name} to be an object`)
}

function optionalRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return Object.fromEntries(Object.entries(value))
  return undefined
}

function requireString(value: unknown, name: string) {
  if (typeof value === "string") return value
  throw new Error(`Expected ${name} to be a string`)
}

function optionalString(value: unknown, name: string) {
  if (value === undefined) return undefined
  return requireString(value, name)
}

function nullableString(value: unknown, name: string) {
  if (value === null || value === undefined) return null
  return requireString(value, name)
}

function requireBoolean(value: unknown, name: string) {
  if (typeof value === "boolean") return value
  throw new Error(`Expected ${name} to be a boolean`)
}

function requireNumber(value: unknown, name: string) {
  if (typeof value === "number") return value
  throw new Error(`Expected ${name} to be a number`)
}

function nullableNumber(value: unknown, name: string) {
  if (value === null || value === undefined) return null
  return requireNumber(value, name)
}
