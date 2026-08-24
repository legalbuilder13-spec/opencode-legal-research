import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import type { SidecarListener } from "./server"

export const LEGAL_WORKBENCH_HOST = "127.0.0.1"
export const LEGAL_WORKBENCH_PORT = 3212
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 6_000

export interface LegalWorkbenchHealth {
  service: "legalbuilder-legal-workbench"
  contractVersion: 1
  status: "ok"
  capabilities: Record<string, unknown>
}

interface SpawnLegalWorkbenchOptions {
  packaged: boolean
  resourcesPath: string
  userDataPath: string
  executablePath?: string
  port?: number
  environment?: NodeJS.ProcessEnv
  startTimeoutMs?: number
  stopTimeoutMs?: number
  onStdout?: (message: string) => void
  onStderr?: (message: string) => void
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

export function legalWorkbenchExecutablePath(input: {
  packaged: boolean
  resourcesPath: string
  platform?: NodeJS.Platform
}) {
  const name =
    input.platform === "win32" || (!input.platform && process.platform === "win32")
      ? "legal-workbench.exe"
      : "legal-workbench"
  return join(input.resourcesPath, name)
}

export function legalWorkbenchUrl(port = LEGAL_WORKBENCH_PORT) {
  return `http://${LEGAL_WORKBENCH_HOST}:${port}`
}

export async function checkLegalWorkbenchHealth(url: string): Promise<LegalWorkbenchHealth | null> {
  try {
    const response = await fetch(new URL("/api/health", url), {
      method: "GET",
      signal: AbortSignal.timeout(1_000),
    })
    if (!response.ok) return null
    const value = await response.json()
    if (!value || typeof value !== "object") return null
    const health = value as Partial<LegalWorkbenchHealth>
    if (
      health.service !== "legalbuilder-legal-workbench" ||
      health.contractVersion !== 1 ||
      health.status !== "ok" ||
      !health.capabilities ||
      typeof health.capabilities !== "object"
    )
      return null
    return health as LegalWorkbenchHealth
  } catch {
    return null
  }
}

export async function spawnLegalWorkbench(options: SpawnLegalWorkbenchOptions): Promise<{
  listener: SidecarListener
  health: LegalWorkbenchHealth
  reused: boolean
}> {
  const port = options.port ?? LEGAL_WORKBENCH_PORT
  const url = legalWorkbenchUrl(port)
  const existing = await checkLegalWorkbenchHealth(url)
  if (existing) {
    if (options.packaged)
      throw new Error(`A legal workbench is already running at ${url}; refusing to reuse an unknown desktop profile`)
    return { listener: { stop: async () => undefined }, health: existing, reused: true }
  }

  const executable = options.executablePath ?? legalWorkbenchExecutablePath(options)
  if (!existsSync(executable)) throw new Error(`Legal workbench executable is missing: ${executable}`)

  const environment = legalWorkbenchEnvironment({
    environment: options.environment,
    userDataPath: options.userDataPath,
    port,
    packaged: options.packaged,
    resourcesPath: options.resourcesPath,
  })
  const child = spawn(executable, [], {
    cwd: dirname(executable),
    env: environment,
    stdio: "pipe",
    windowsHide: true,
  })
  pipeLines(child, options)

  let startupError: Error | null = null
  child.once("error", (error) => {
    startupError = error
  })
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => {
      options.onExit?.(code, signal)
      resolve({ code, signal })
    })
  })

  let ready: { health: LegalWorkbenchHealth } | { error: Error }
  try {
    ready = await Promise.race([
      waitForHealth(url, options.startTimeoutMs ?? START_TIMEOUT_MS).then((health) => ({ health })),
      exit.then(({ code, signal }) => ({
        error: startupError ?? new Error(`Legal workbench exited before ready (code=${code}, signal=${signal})`),
      })),
    ])
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
    throw error
  }
  if ("error" in ready) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
    throw ready.error
  }

  let stopping: Promise<void> | undefined
  return {
    health: ready.health,
    reused: false,
    listener: {
      stop: () => {
        if (stopping) return stopping
        if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
        child.kill("SIGTERM")
        stopping = Promise.race([
          exit.then(() => undefined),
          delay(options.stopTimeoutMs ?? STOP_TIMEOUT_MS).then(() => {
            if (child.exitCode === null && child.signalCode === null)
              child.kill(process.platform === "win32" ? undefined : "SIGKILL")
          }),
        ])
        return stopping
      },
    },
  }
}

export function legalWorkbenchEnvironment(input: {
  environment?: NodeJS.ProcessEnv
  userDataPath: string
  port?: number
  packaged?: boolean
  resourcesPath?: string
}) {
  const source = input.environment ?? process.env
  const environment = Object.fromEntries(
    Object.entries(source).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
  )
  environment.LEGAL_RESEARCH_DATA_DIR = join(input.userDataPath, "legal-research")
  environment.LEGAL_WORKBENCH_HOST = LEGAL_WORKBENCH_HOST
  environment.PORT = String(input.port ?? LEGAL_WORKBENCH_PORT)
  if (input.packaged && input.resourcesPath && !environment.LEGAL_EVIDENCE_WORKER_DIR)
    environment.LEGAL_EVIDENCE_WORKER_DIR = join(input.resourcesPath, "legal-evidence-worker")
  if (!environment.CODEX_APP_SERVER_BIN) {
    const codex = installedChatGptCodexPath()
    if (codex) environment.CODEX_APP_SERVER_BIN = codex
  }
  return environment
}

function installedChatGptCodexPath() {
  if (process.platform !== "darwin") return undefined
  for (const candidate of [
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    join(homedir(), "Applications/ChatGPT.app/Contents/Resources/codex"),
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

async function waitForHealth(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await checkLegalWorkbenchHealth(url)
    if (health) return health
    await delay(100)
  }
  throw new Error(`Legal workbench did not become healthy within ${timeoutMs}ms: ${url}`)
}

function pipeLines(child: ChildProcessWithoutNullStreams, options: SpawnLegalWorkbenchOptions) {
  child.stdout.on("data", (chunk: Buffer) => options.onStdout?.(chunk.toString("utf8").trimEnd()))
  child.stderr.on("data", (chunk: Buffer) => options.onStderr?.(chunk.toString("utf8").trimEnd()))
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
