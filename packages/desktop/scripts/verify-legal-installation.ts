#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { basename, isAbsolute, join, relative, resolve } from "node:path"

import { discoverEvidenceWorkerRuntime } from "../../legal-workbench/src/worker-runtime"
import { spawnLegalWorkbench } from "../src/main/legal-workbench"
import { verifyEvidenceWorkerLicenseReceipt } from "./evidence-worker-license-audit"
import { desktopLicenseReceiptName, verifyDesktopLicenseReceipt } from "./desktop-license-audit"

const resourcesPath = resolve(Bun.argv[2] ?? "")
const fixturePath = resolve(Bun.argv[3] ?? "")

if (!Bun.argv[2] || !Bun.argv[3]) throw new Error("usage: bun verify-legal-installation.ts RESOURCES_DIR OCR_FIXTURE")

const workbenchPath = join(resourcesPath, process.platform === "win32" ? "legal-workbench.exe" : "legal-workbench")
const workerRoot = join(resourcesPath, "legal-evidence-worker")
await verifyEvidenceWorkerLicenseReceipt(workerRoot)
await verifyDesktopLicenseReceipt(resolve(import.meta.dir, "../../.."), join(resourcesPath, desktopLicenseReceiptName))
const workbenchStat = await stat(workbenchPath)
if (!workbenchStat.isFile()) throw new Error("Installed legal workbench is not a file")

const discovery = discoverEvidenceWorkerRuntime(workerRoot)
if (discovery.status !== "ready" || discovery.runtime.kind !== "packaged") throw new Error(discovery.detail)
for (const path of [discovery.runtime.python, discovery.runtime.packageRoot, discovery.runtime.artifactsPath]) {
  if (!path || !contained(workerRoot, path)) throw new Error(`Installed worker path escapes its resource root: ${path}`)
}

const fixtureExists = await Bun.file(fixturePath).exists()
if (!fixtureExists) throw new Error(`OCR fixture is missing: ${fixturePath}`)

const temporary = await mkdtemp(join(tmpdir(), "legal-installation-gate-"))
try {
  await verifyWorkbench()
  const result = await verifyOcr()
  console.log(
    `Installed legal resources passed: ${basename(workbenchPath)}, ${result.ocr_engine}, ${result.items.length} OCR items, ${result.pages.length} canonical page`,
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}

async function verifyWorkbench() {
  const port = await availablePort()
  const running = await spawnLegalWorkbench({
    packaged: true,
    resourcesPath,
    userDataPath: join(temporary, "profile"),
    port,
    environment: safeEnvironment(),
    startTimeoutMs: 15_000,
    stopTimeoutMs: 3_000,
  })
  try {
    const evidenceWorker = running.health.capabilities.evidenceWorker
    if (!isRecord(evidenceWorker) || evidenceWorker.status !== "ready")
      throw new Error("Installed legal workbench did not discover its packaged evidence worker")
  } finally {
    await running.listener.stop()
  }
}

async function verifyOcr() {
  const source = new Uint8Array(await Bun.file(fixturePath).arrayBuffer())
  const output = join(temporary, "ocr")
  const requestPath = join(temporary, "request.json")
  await Bun.write(
    requestPath,
    `${JSON.stringify({
      contract_version: 1,
      job_id: "installed-resource-smoke",
      source_version_id: "installed-resource-source",
      blob_path: fixturePath,
      output_dir: output,
      expected_sha256: createHash("sha256").update(source).digest("hex"),
      mime: "image/png",
      mode: "strict_visual",
      language_hints: ["eng"],
    })}\n`,
  )
  const processHandle = Bun.spawn([discovery.runtime.python, "-m", "legal_evidence_worker.cli", requestPath], {
    cwd: discovery.runtime.packageRoot,
    env: {
      ...safeEnvironment(),
      PYTHONPATH: discovery.runtime.packageRoot,
      PYTHONNOUSERSITE: "1",
      DOCLING_ARTIFACTS_PATH: discovery.runtime.artifactsPath,
      LEGAL_EVIDENCE_OCR_ENGINE: discovery.runtime.ocrEngine,
      LEGAL_EVIDENCE_OCR_LANGUAGES: discovery.runtime.ocrLanguages.join(","),
      HF_HUB_OFFLINE: "1",
      HF_HUB_DISABLE_TELEMETRY: "1",
      TRANSFORMERS_OFFLINE: "1",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const timeout = setTimeout(() => processHandle.kill(), 5 * 60_000)
  const [code, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ])
  clearTimeout(timeout)
  if (code !== 0) throw new Error(`Installed OCR worker exited ${code}: ${stderr.slice(-4_000)}`)
  const result: unknown = JSON.parse(stdout)
  if (
    !isRecord(result) ||
    typeof result.ocr_engine !== "string" ||
    !result.ocr_engine.startsWith("rapidocr-") ||
    !Array.isArray(result.items) ||
    !result.items.length ||
    !Array.isArray(result.pages) ||
    result.pages.length !== 1
  )
    throw new Error("Installed OCR worker returned an invalid smoke result")
  return result as { ocr_engine: string; items: unknown[]; pages: unknown[] }
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const names = ["PATH", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG"]
  return Object.fromEntries(names.flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])))
}

function contained(root: string, candidate: string) {
  const relation = relative(resolve(root), resolve(candidate))
  return (
    relation !== ".." && !relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(relation)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function availablePort() {
  const server = createServer()
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolvePromise)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Could not allocate a loopback port")
  await new Promise<void>((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  )
  return address.port
}
