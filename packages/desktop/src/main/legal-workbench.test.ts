import { afterEach, expect, test } from "bun:test"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  checkLegalWorkbenchHealth,
  legalWorkbenchEnvironment,
  legalWorkbenchExecutablePath,
  legalWorkbenchUrl,
  spawnLegalWorkbench,
} from "./legal-workbench"
import { startLegalWebRendererServer } from "./legal-web-renderer-server"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

test("resolves the packaged executable and isolates legal data", () => {
  expect(
    legalWorkbenchExecutablePath({ packaged: true, resourcesPath: "/opt/legalbuilder/resources", platform: "linux" }),
  ).toBe("/opt/legalbuilder/resources/legal-workbench")
  expect(
    legalWorkbenchExecutablePath({ packaged: true, resourcesPath: "C:\\LegalBuilder", platform: "win32" }),
  ).toEndWith("legal-workbench.exe")

  const environment = legalWorkbenchEnvironment({
    environment: { PATH: "/usr/bin", CODEX_APP_SERVER_BIN: "/opt/codex" },
    userDataPath: "/tmp/legalbuilder-profile",
    port: 43210,
  })
  expect(environment.LEGAL_RESEARCH_DATA_DIR).toBe("/tmp/legalbuilder-profile/legal-research")
  expect(environment.LEGAL_WORKBENCH_HOST).toBe("127.0.0.1")
  expect(environment.PORT).toBe("43210")
  expect(environment.CODEX_APP_SERVER_BIN).toBe("/opt/codex")

  const packaged = legalWorkbenchEnvironment({
    environment: { PATH: "/usr/bin" },
    userDataPath: "/tmp/legalbuilder-profile",
    packaged: true,
    resourcesPath: "/opt/legalbuilder/resources",
  })
  expect(packaged.LEGAL_EVIDENCE_WORKER_DIR).toBe("/opt/legalbuilder/resources/legal-evidence-worker")
})

test("supervises stop, reuse, and restart without killing a reused service", async () => {
  const root = await mkdtemp(join(tmpdir(), "legal-workbench-sidecar-test-"))
  const executable = join(root, "fixture-workbench")
  const userDataPath = join(root, "profile")
  const port = await availablePort()
  await Bun.write(
    executable,
    `#!${process.execPath}\n` +
      `const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.PORT), fetch(request) {\n` +
      `  const url = new URL(request.url);\n` +
      `  if (url.pathname === "/api/health") return Response.json({ service: "legalbuilder-legal-workbench", contractVersion: 1, status: "ok", capabilities: { fixture: true } });\n` +
      `  return new Response("fixture");\n` +
      `} });\n` +
      `const stop = () => { server.stop(true); process.exit(0); };\n` +
      `process.on("SIGINT", stop); process.on("SIGTERM", stop);\n`,
  )
  await chmod(executable, 0o755)
  cleanups.push(() => rm(root, { recursive: true, force: true }))

  const first = await spawnLegalWorkbench({
    packaged: false,
    resourcesPath: root,
    executablePath: executable,
    userDataPath,
    port,
    environment: { PATH: process.env.PATH },
    startTimeoutMs: 5_000,
    stopTimeoutMs: 2_000,
  })
  cleanups.push(first.listener.stop)
  expect(first.reused).toBe(false)
  expect(first.health.capabilities).toEqual({ fixture: true })

  await expect(
    spawnLegalWorkbench({
      packaged: true,
      resourcesPath: root,
      executablePath: executable,
      userDataPath,
      port,
      environment: { PATH: process.env.PATH },
    }),
  ).rejects.toThrow("refusing to reuse an unknown desktop profile")

  const reused = await spawnLegalWorkbench({
    packaged: false,
    resourcesPath: root,
    executablePath: executable,
    userDataPath,
    port,
    environment: { PATH: process.env.PATH },
  })
  expect(reused.reused).toBe(true)
  await reused.listener.stop()
  expect(await checkLegalWorkbenchHealth(legalWorkbenchUrl(port))).not.toBeNull()

  await first.listener.stop()
  await waitUntil(async () => (await checkLegalWorkbenchHealth(legalWorkbenchUrl(port))) === null)

  const restarted = await spawnLegalWorkbench({
    packaged: false,
    resourcesPath: root,
    executablePath: executable,
    userDataPath,
    port,
    environment: { PATH: process.env.PATH },
    startTimeoutMs: 5_000,
    stopTimeoutMs: 2_000,
  })
  cleanups.push(restarted.listener.stop)
  expect(restarted.reused).toBe(false)
  await restarted.listener.stop()
})

const compiledExecutable = process.env.LEGAL_WORKBENCH_TEST_EXECUTABLE
const compiledWorker = process.env.LEGAL_EVIDENCE_WORKER_TEST_DIR
const compiledTest = compiledExecutable ? test : test.skip

compiledTest(
  "starts the compiled workbench with embedded UI and truthful capabilities",
  async () => {
    if (!compiledExecutable) return
    const root = await mkdtemp(join(tmpdir(), "legal-workbench-compiled-test-"))
    const port = await availablePort()
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const rendererScreenshot = compiledWorker
      ? new Uint8Array(
          await Bun.file(
            resolve(import.meta.dir, "../../../legal-evidence-worker/fixtures/generated/scan_page_1.png"),
          ).arrayBuffer(),
        )
      : new Uint8Array([137, 80, 78, 71])
    const renderer = await startLegalWebRendererServer(async (url) => ({
      finalUrl: url,
      status: 200,
      html: new TextEncoder().encode(
        "<html><title>Packaged authority</title><body>Controlling legal text.</body></html>",
      ),
      screenshot: rendererScreenshot,
      screenshotMime: "image/png",
    }))
    cleanups.push(renderer.listener.stop)

    const running = await spawnLegalWorkbench({
      packaged: true,
      resourcesPath: root,
      executablePath: compiledExecutable,
      userDataPath: join(root, "profile"),
      port,
      environment: {
        PATH: process.env.PATH,
        CODEX_APP_SERVER_BIN: process.env.CODEX_APP_SERVER_BIN,
        LEGAL_EVIDENCE_WORKER_DIR: compiledWorker,
        LEGAL_WEB_RENDERER_URL: renderer.url,
        LEGAL_WEB_RENDERER_TOKEN: renderer.token,
      },
      startTimeoutMs: 10_000,
      stopTimeoutMs: 2_000,
    })
    cleanups.push(running.listener.stop)
    expect(running.reused).toBe(false)
    expect(running.health.capabilities).toMatchObject({
      evidenceWorker: { status: compiledWorker ? "ready" : "unavailable" },
      strictVisualWebRenderer: { status: "ready" },
    })

    const shell = await fetch(legalWorkbenchUrl(port))
    expect(shell.status).toBe(200)
    expect(await shell.text()).toContain("Review exact evidence")
    if (compiledWorker) {
      const matterResponse = await fetch(`${legalWorkbenchUrl(port)}/api/matters`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Packaged strict capture",
          jurisdiction: "U.S.",
          researchAsOf: "2026-08-24",
          confidentiality: "public",
        }),
      })
      expect(matterResponse.status).toBe(201)
      const matter: unknown = await matterResponse.json()
      if (!isRecord(matter) || typeof matter.id !== "string") throw new Error("Matter response did not include an ID")
      const capture = await fetch(`${legalWorkbenchUrl(port)}/api/matters/${matter.id}/web`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/", mode: "strict_visual", languageHints: ["eng"] }),
      })
      expect(capture.status).toBe(201)
    }
    await running.listener.stop()
  },
  120_000,
)

async function availablePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Could not allocate test port")
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return address.port
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function waitUntil(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(50)
  }
  throw new Error("Timed out waiting for supervised workbench state")
}
