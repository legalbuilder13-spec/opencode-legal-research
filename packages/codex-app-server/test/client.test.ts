import { afterEach, describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { connect, type Client, type TranscriptEntry } from "../src/client"

const fixture = fileURLToPath(new URL("./fixture/fake-app-server.ts", import.meta.url))
const command = [process.execPath, fixture, "app-server"]
const clients: Client[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
})

describe("Codex app-server subscription client", () => {
  test("uses ChatGPT account auth, runs a turn, and resumes after restart", async () => {
    const first = await create({ env: { OPENAI_API_KEY: "sk-should-not-reach-child" } })
    expect(await first.account()).toEqual({ requiresOpenaiAuth: true, account: { type: "chatgpt", planType: "plus" } })

    const thread = await first.startThread({ cwd: process.cwd() })
    expect(await first.runTurn(thread.threadId, "research this")).toMatchObject({
      status: "completed",
      text: "hello world",
    })
    await first.close()

    const second = await create()
    expect(await second.resumeThread(thread.threadId)).toEqual(thread)
    expect(await second.runTurn(thread.threadId, "continue")).toMatchObject({
      status: "completed",
      text: "hello world",
    })
  })

  test("supports browser and device login completion notifications", async () => {
    const client = await create()
    const browser = await client.startLogin("chatgpt")
    expect(browser.authUrl).toContain("/login")
    expect(await client.waitForLogin(browser)).toEqual({ loginId: browser.loginId, success: true, error: null })

    const device = await client.startLogin("chatgptDeviceCode")
    expect(device.verificationUrl).toContain("/device")
    expect(device.userCode).toBe("SECRET-CODE")
    expect(await client.waitForLogin(device)).toEqual({ loginId: device.loginId, success: true, error: null })
  })

  test("reads subscription rate limits", async () => {
    const client = await create()
    expect(await client.rateLimits()).toEqual({
      limitId: "codex",
      primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: null,
      reachedType: null,
    })
  })

  test("interrupts an in-progress turn without polling sleeps", async () => {
    const client = await create()
    const thread = await client.startThread({ cwd: process.cwd() })
    const turn = await client.startTurn(thread.threadId, "wait")
    const completion = client.collectTurn(turn)
    await client.interruptTurn(turn)
    expect(await completion).toMatchObject({ status: "interrupted", text: "" })
  })

  test("streams the complete turn event sequence for rich clients", async () => {
    const client = await create()
    const thread = await client.startThread({
      cwd: process.cwd(),
      sandbox: "workspace-write",
      developerInstructions: "Use the host interface.",
      ephemeral: true,
    })
    const turn = await client.startTurn(thread.threadId, "tools")
    const methods: string[] = []
    for await (const notification of client.streamTurn(turn)) methods.push(notification.method)

    expect(methods).toEqual([
      "item/started",
      "item/completed",
      "item/agentMessage/delta",
      "item/agentMessage/delta",
      "turn/completed",
    ])
  })

  test("routes app-server approval requests through the host client", async () => {
    const requests: string[] = []
    const client = await create({
      onServerRequest: async (request) => {
        requests.push(request.method)
        return { decision: "accept" }
      },
    })
    const thread = await client.startThread({ cwd: process.cwd(), approvalPolicy: "on-request" })
    expect(await client.runTurn(thread.threadId, "approval")).toMatchObject({ status: "completed" })
    expect(requests).toEqual(["item/commandExecution/requestApproval"])
  })

  test("redacts credentials, identity, prompts, and model output from transcripts", async () => {
    const transcript: TranscriptEntry[] = []
    const client = await create({ onTranscript: (entry) => transcript.push(entry) })
    await client.account()
    await client.request("test/secret", { text: "private legal prompt", apiKey: "sk-client-secret-value" })
    const serialized = JSON.stringify(transcript)

    expect(serialized).not.toContain("lawyer@example.com")
    expect(serialized).not.toContain("private legal prompt")
    expect(serialized).not.toContain("sk-client-secret-value")
    expect(serialized).not.toContain("sk-secret-token-value")
    expect(serialized).not.toContain("deeply-secret-value")
    expect(serialized).toContain("[REDACTED]")
  })

  test("allows API-key auth only when explicitly requested", async () => {
    const client = await create({ requireSubscription: false, env: { OPENAI_API_KEY: "sk-explicit-api-key" } })
    expect(await client.account()).toEqual({ requiresOpenaiAuth: true, account: { type: "apiKey" } })
  })

  test("rejects a stored API-key account in subscription mode", async () => {
    await expect(create({ env: { FAKE_ACCOUNT_TYPE: "apiKey" } })).rejects.toThrow(
      "Subscription mode requires ChatGPT account auth",
    )
  })

  test("reports a clear recovery action when subscription auth is signed out", async () => {
    await expect(create({ env: { FAKE_ACCOUNT_TYPE: "signedOut" } })).rejects.toThrow(
      "ChatGPT subscription sign-in is required in Codex app-server",
    )
  })

  test("rejects pending work when the app-server exits", async () => {
    const client = await create()
    await expect(client.request("test/exit")).rejects.toThrow("exited unexpectedly with code 23")
  })
})

async function create(options: Parameters<typeof connect>[0] = {}) {
  const client = await connect({ command, requestTimeoutMs: 2_000, notificationTimeoutMs: 2_000, ...options })
  clients.push(client)
  return client
}
