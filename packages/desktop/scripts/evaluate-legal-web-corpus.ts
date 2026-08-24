import { app, BrowserWindow } from "electron"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"

import { startElectronLegalWebRenderer } from "../src/main/legal-web-renderer-electron"
import { discoverEvidenceWorkerRuntime, type EvidenceWorkerRuntime } from "../../legal-workbench/src/worker-runtime"

interface CorpusCase {
  id: string
  sourceClass: string
  url: string
  allowedFinalHosts: string[]
  expectedHtmlText: string[]
  expectedOcrText: string[]
  minimumScreenshotBytes: number
  maximumRenderDurationMs: number
}

interface CorpusManifest {
  contractVersion: 1
  corpusId: string
  reviewStatus: string
  reviewedBy: string[]
  cases: CorpusCase[]
}

interface RenderResponse {
  contractVersion: 1
  finalUrl: string
  status: number
  htmlBase64: string
  screenshotBase64: string
  screenshotMime: "image/png"
}

const manifestPath = resolve(process.env.LEGAL_WEB_CORPUS_MANIFEST ?? "specs/legal-research/corpus/web-v0/corpus.json")
const outputRoot = resolve(
  process.env.LEGAL_WEB_CORPUS_OUTPUT ??
    join(tmpdir(), `legal-web-corpus-${new Date().toISOString().replace(/[:.]/g, "-")}`),
)

async function main() {
  const keepAlive = setInterval(() => undefined, 1_000)
  await app.whenReady()
  clearInterval(keepAlive)
  const keeper = new BrowserWindow({ show: false })
  const manifest = corpusManifest(JSON.parse(await readFile(manifestPath, "utf8")))
  const worker = configuredWorker()
  const renderer = await startElectronLegalWebRenderer()
  await mkdir(outputRoot, { recursive: true })
  const cases: Record<string, unknown>[] = []
  try {
    for (const item of manifest.cases) cases.push(await evaluateCase(renderer.url, renderer.token, item, worker))
    const receipt = {
      contractVersion: 1,
      corpusId: manifest.corpusId,
      reviewStatus: manifest.reviewStatus,
      reviewedBy: manifest.reviewedBy,
      generatedAt: new Date().toISOString(),
      runtime: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        platform: process.platform,
        arch: process.arch,
      },
      worker: worker ? { kind: worker.kind, ocrEngine: worker.ocrEngine, ocrLanguages: worker.ocrLanguages } : null,
      cases,
    }
    await writeFile(join(outputRoot, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`)
    console.log(`Live-web corpus passed ${cases.length} cases; receipt: ${join(outputRoot, "receipt.json")}`)
  } finally {
    await renderer.listener.stop()
    keeper.destroy()
  }
  app.quit()
}

async function evaluateCase(
  endpoint: string,
  token: string,
  item: CorpusCase,
  worker: EvidenceWorkerRuntime | undefined,
) {
  const started = performance.now()
  const response = await fetch(`${endpoint}/render`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ url: item.url }),
  })
  const value: unknown = await response.json()
  if (!response.ok) throw new Error(`${item.id}: ${errorMessage(value, response.status)}`)
  const rendered = renderResponse(value, item.id)
  const renderDurationMs = Math.round(performance.now() - started)
  if (renderDurationMs > item.maximumRenderDurationMs)
    throw new Error(`${item.id}: exceeded ${item.maximumRenderDurationMs}ms`)
  const final = new URL(rendered.finalUrl)
  if (!item.allowedFinalHosts.includes(final.hostname))
    throw new Error(`${item.id}: unexpected final host ${final.hostname}`)
  const html = Buffer.from(rendered.htmlBase64, "base64")
  const screenshot = Buffer.from(rendered.screenshotBase64, "base64")
  if (screenshot.byteLength < item.minimumScreenshotBytes)
    throw new Error(`${item.id}: screenshot was only ${screenshot.byteLength} bytes`)
  if (!png(screenshot)) throw new Error(`${item.id}: renderer did not return a PNG`)
  const htmlText = html.toString("utf8")
  for (const expected of item.expectedHtmlText)
    if (!includesText(htmlText, expected)) throw new Error(`${item.id}: HTML is missing ${JSON.stringify(expected)}`)

  const caseRoot = join(outputRoot, item.id)
  await mkdir(caseRoot, { recursive: true })
  const htmlPath = join(caseRoot, "rendered.html")
  const screenshotPath = join(caseRoot, "rendered.png")
  await Promise.all([writeFile(htmlPath, html), writeFile(screenshotPath, screenshot)])
  const dimensions = pngDimensions(screenshot)
  const ocr = worker ? await evaluateOcr(worker, item, screenshotPath, screenshot, caseRoot) : null
  console.log(
    `${item.id}: render ${renderDurationMs}ms${ocr ? `, OCR ${ocr.durationMs}ms` : ""}, ${dimensions.width}x${dimensions.height}, ${screenshot.byteLength} PNG bytes`,
  )
  return {
    id: item.id,
    sourceClass: item.sourceClass,
    requestedUrl: item.url,
    finalUrl: rendered.finalUrl,
    status: rendered.status,
    renderDurationMs,
    html: {
      file: basename(htmlPath),
      bytes: html.byteLength,
      sha256: sha256(html),
      expectedText: item.expectedHtmlText,
    },
    screenshot: {
      file: basename(screenshotPath),
      bytes: screenshot.byteLength,
      sha256: sha256(screenshot),
      ...dimensions,
    },
    ocr,
  }
}

async function evaluateOcr(
  worker: EvidenceWorkerRuntime,
  item: CorpusCase,
  screenshotPath: string,
  screenshot: Buffer,
  caseRoot: string,
) {
  const started = performance.now()
  const output = join(caseRoot, "ocr")
  await mkdir(output, { recursive: true })
  const sourceHash = sha256(screenshot)
  const requestPath = join(output, "request.json")
  await writeFile(
    requestPath,
    `${JSON.stringify(
      {
        contract_version: 1,
        job_id: `live_web_${item.id}`,
        source_version_id: `live_web_${item.id}`,
        blob_path: screenshotPath,
        output_dir: output,
        expected_sha256: sourceHash,
        mime: "image/png",
        mode: "strict_visual",
        language_hints: ["eng"],
      },
      null,
      2,
    )}\n`,
  )
  const result = await runWorker(worker, requestPath)
  const record = asRecord(result, `${item.id} OCR result`)
  if (record.source_hash !== sourceHash || !Array.isArray(record.items))
    throw new Error(`${item.id}: OCR contract mismatch`)
  const text = record.items
    .map((value) => asRecord(value, `${item.id} OCR item`).text)
    .filter((value): value is string => typeof value === "string")
    .join("\n")
  for (const expected of item.expectedOcrText)
    if (!includesText(text, expected)) throw new Error(`${item.id}: OCR is missing ${JSON.stringify(expected)}`)
  return {
    durationMs: Math.round(performance.now() - started),
    parser: record.parser_name,
    parserVersion: record.parser_version,
    engine: record.ocr_engine,
    workerVersion: record.worker_version,
    pageCount: record.page_count,
    itemCount: record.items.length,
    normalizedTextSha256: record.normalized_text_sha256,
    expectedText: item.expectedOcrText,
  }
}

function runWorker(runtime: EvidenceWorkerRuntime, requestPath: string) {
  return new Promise<unknown>((resolvePromise, reject) => {
    const child = spawn(runtime.python, ["-m", "legal_evidence_worker.cli", requestPath], {
      cwd: runtime.packageRoot,
      env: workerEnvironment(runtime),
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => child.kill(), 5 * 60 * 1_000)
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > 4 * 1024 * 1024) child.kill()
      else stdout.push(chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > 4 * 1024 * 1024) child.kill()
      else stderr.push(chunk)
    })
    child.once("error", reject)
    child.once("exit", (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`Evidence worker exited ${code}: ${Buffer.concat(stderr).toString().trim()}`))
        return
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(stdout).toString()))
      } catch {
        reject(new Error("Evidence worker returned invalid JSON"))
      }
    })
  })
}

function configuredWorker() {
  const root = process.env.LEGAL_EVIDENCE_WORKER_DIR
  if (!root) return undefined
  const discovery = discoverEvidenceWorkerRuntime(root)
  if (discovery.status !== "ready") throw new Error(discovery.detail)
  return discovery.runtime
}

function workerEnvironment(runtime: EvidenceWorkerRuntime) {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    PYTHONPATH: runtime.packageRoot,
    PYTHONNOUSERSITE: "1",
  }
  if (runtime.kind === "packaged") {
    env.DOCLING_ARTIFACTS_PATH = runtime.artifactsPath
    env.LEGAL_EVIDENCE_OCR_ENGINE = runtime.ocrEngine
    env.LEGAL_EVIDENCE_OCR_LANGUAGES = runtime.ocrLanguages.join(",")
    env.HF_HUB_OFFLINE = "1"
    env.HF_HUB_DISABLE_TELEMETRY = "1"
    env.TRANSFORMERS_OFFLINE = "1"
  }
  return env
}

function corpusManifest(value: unknown): CorpusManifest {
  const manifest = asRecord(value, "corpus manifest")
  if (
    manifest.contractVersion !== 1 ||
    typeof manifest.corpusId !== "string" ||
    typeof manifest.reviewStatus !== "string" ||
    !stringArray(manifest.reviewedBy) ||
    !Array.isArray(manifest.cases)
  )
    throw new Error("Unsupported live-web corpus manifest")
  return {
    contractVersion: 1,
    corpusId: manifest.corpusId,
    reviewStatus: manifest.reviewStatus,
    reviewedBy: manifest.reviewedBy,
    cases: manifest.cases.map(corpusCase),
  }
}

function corpusCase(value: unknown, index: number): CorpusCase {
  const item = asRecord(value, `corpus case ${index}`)
  if (
    typeof item.id !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.id) ||
    typeof item.sourceClass !== "string" ||
    typeof item.url !== "string" ||
    !stringArray(item.allowedFinalHosts) ||
    !item.allowedFinalHosts.length ||
    !stringArray(item.expectedHtmlText) ||
    !stringArray(item.expectedOcrText) ||
    typeof item.minimumScreenshotBytes !== "number" ||
    !Number.isInteger(item.minimumScreenshotBytes) ||
    item.minimumScreenshotBytes < 1 ||
    typeof item.maximumRenderDurationMs !== "number" ||
    !Number.isInteger(item.maximumRenderDurationMs) ||
    item.maximumRenderDurationMs < 1
  )
    throw new Error(`Invalid corpus case ${index}`)
  new URL(item.url)
  return {
    id: item.id,
    sourceClass: item.sourceClass,
    url: item.url,
    allowedFinalHosts: item.allowedFinalHosts,
    expectedHtmlText: item.expectedHtmlText,
    expectedOcrText: item.expectedOcrText,
    minimumScreenshotBytes: item.minimumScreenshotBytes,
    maximumRenderDurationMs: item.maximumRenderDurationMs,
  }
}

function renderResponse(value: unknown, id: string): RenderResponse {
  const response = asRecord(value, `${id} renderer response`)
  if (
    response.contractVersion !== 1 ||
    response.screenshotMime !== "image/png" ||
    typeof response.finalUrl !== "string" ||
    typeof response.status !== "number" ||
    typeof response.htmlBase64 !== "string" ||
    typeof response.screenshotBase64 !== "string"
  )
    throw new Error(`${id}: invalid renderer response`)
  return {
    contractVersion: 1,
    finalUrl: response.finalUrl,
    status: response.status,
    htmlBase64: response.htmlBase64,
    screenshotBase64: response.screenshotBase64,
    screenshotMime: "image/png",
  }
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`)
  return Object.fromEntries(Object.entries(value))
}

function errorMessage(value: unknown, status: number) {
  const error = value && typeof value === "object" && "error" in value ? value.error : undefined
  return typeof error === "string" ? error : `renderer returned ${status}`
}

function includesText(haystack: string, needle: string) {
  return normalized(haystack).includes(normalized(needle))
}

function normalized(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase()
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function png(value: Buffer) {
  return value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
}

function pngDimensions(value: Buffer) {
  if (value.byteLength < 24) throw new Error("PNG has no IHDR dimensions")
  return { width: value.readUInt32BE(16), height: value.readUInt32BE(20) }
}

void main().catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})
