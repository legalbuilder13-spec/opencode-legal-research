import { hashText, LegalResearchStore } from "@legalbuilder/legal-research-core"
import { randomUUID } from "node:crypto"
import { mkdir, realpath } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import { discoverEvidenceWorkerRuntime, type EvidenceWorkerRuntime } from "./worker-runtime"

export type EvidenceMime =
  | "application/pdf"
  | "image/png"
  | "image/jpeg"
  | "text/html"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
export type EvidenceMode = "adaptive" | "strict_visual" | "structural"

export interface WorkerRequest {
  contract_version: 1
  job_id: string
  source_version_id: string
  blob_path: string
  output_dir: string
  expected_sha256: string
  mime: EvidenceMime
  mode: EvidenceMode
  language_hints: string[]
}

interface WorkerRegion {
  page_number: number
  page_width: number
  page_height: number
  bbox: { left: number; top: number; right: number; bottom: number }
}

interface WorkerResult {
  contract_version: 1
  job_id: string
  worker_version: string
  parser_name: string
  parser_version: string
  ocr_engine: string
  ocr_mode: EvidenceMode
  source_version_id: string
  source_hash: string
  normalized_text_sha256: string
  quality_metrics: unknown
  warnings: unknown
  page_count: number
  pages: Array<{ page_number: number; image_path: string; image_sha256: string }>
  items: Array<{
    worker_item_id: string
    source_ref: string
    order: number
    text: string
    text_sha256: string
    regions: WorkerRegion[]
  }>
}

export type EvidenceWorkerRunner = (request: WorkerRequest) => Promise<unknown>

export interface CapturedWebDocument {
  matterId: string
  title: string
  requestedUrl: string
  finalUrl: string
  canonicalUrl?: string
  html: Uint8Array
  screenshot?: { bytes: Uint8Array; mime: "image/png" | "image/jpeg" }
  languageHints?: string[]
}

export class EvidenceIngestionService {
  private readonly runner: EvidenceWorkerRunner

  constructor(
    readonly store: LegalResearchStore,
    readonly dataRoot: string,
    runner?: EvidenceWorkerRunner,
  ) {
    this.runner = runner ?? localEvidenceWorker()
  }

  async ingestPdf(input: {
    matterId: string
    title: string
    bytes: Uint8Array
    mode: "adaptive" | "strict_visual"
    languageHints?: string[]
  }) {
    return this.ingestDocument({ ...input, mime: "application/pdf" })
  }

  async ingestDocument(input: {
    matterId: string
    title: string
    bytes: Uint8Array
    mime: EvidenceMime
    mode?: "adaptive" | "strict_visual"
    languageHints?: string[]
  }) {
    const mode = modeForMime(input.mime, input.mode)
    const materialized = await this.store.materialize({
      matterId: input.matterId,
      title: input.title,
      kind: "upload",
      mime: input.mime,
      bytes: input.bytes,
      origin: `upload:${input.title}`,
      status: "partial",
      accessNotes: "Local evidence-worker ingestion pending",
    })
    const version = this.store.sourceVersion(materialized.sourceVersionId)
    return this.processDocument({
      sourceId: materialized.sourceId,
      sourceVersionId: version.id,
      mode,
      languageHints: input.languageHints,
      initialCapture: true,
    })
  }

  async reprocessDocument(input: {
    matterId: string
    sourceVersionId: string
    mode?: "adaptive" | "strict_visual"
    languageHints?: string[]
  }) {
    const matter = this.store.matter(input.matterId)
    if (matter.status !== "active") throw new Error(`Matter is not active: ${matter.status}`)
    const version = this.store.sourceVersion(input.sourceVersionId)
    if (version.matter_id !== matter.id) throw new Error("Source belongs to a different matter")
    if (version.deleted_at) throw new Error("Deleted source version cannot be reprocessed")
    const mime = evidenceMime(version.mime)
    if (version.capture_status !== "complete") throw new Error("Only completed sources can be reprocessed")
    return this.processDocument({
      sourceId: version.source_id,
      sourceVersionId: version.id,
      mode: modeForMime(mime, input.mode),
      languageHints: input.languageHints,
      initialCapture: false,
    })
  }

  async ingestWebCapture(input: CapturedWebDocument) {
    const materialized = await this.store.materialize({
      matterId: input.matterId,
      title: input.title,
      kind: "web",
      mime: "text/html",
      bytes: input.html,
      origin: input.requestedUrl,
      finalUrl: input.finalUrl,
      canonicalUrl: input.canonicalUrl,
      status: "partial",
      accessNotes: "Local web evidence processing pending",
    })
    const version = this.store.sourceVersion(materialized.sourceVersionId)
    try {
      const structural = await this.processDocument({
        sourceId: materialized.sourceId,
        sourceVersionId: version.id,
        mode: "structural",
        languageHints: input.languageHints,
        initialCapture: false,
        allowIncomplete: true,
      })
      let visual: { representationId: string; pageCount: number; passageCount: number } | undefined
      if (input.screenshot) {
        const artifact = await this.store.blobs.put(input.screenshot.bytes)
        visual = await this.processDocument({
          sourceId: materialized.sourceId,
          sourceVersionId: version.id,
          mode: "strict_visual",
          languageHints: input.languageHints,
          initialCapture: false,
          allowIncomplete: true,
          artifact: { blobSha256: artifact.sha256, mime: input.screenshot.mime },
        })
      }
      this.store.setCaptureStatus(
        version.id,
        "complete",
        input.screenshot
          ? "Structural HTML and rendered visual evidence processed locally"
          : "Structural HTML processed locally",
      )
      return {
        sourceId: materialized.sourceId,
        sourceVersionId: version.id,
        mode: input.screenshot ? "strict_visual" : "structural",
        structuralRepresentationId: structural.representationId,
        visualRepresentationId: visual?.representationId ?? null,
        pageCount: visual?.pageCount ?? 0,
        passageCount: structural.passageCount + (visual?.passageCount ?? 0),
        requestedUrl: input.requestedUrl,
        finalUrl: input.finalUrl,
        canonicalUrl: input.canonicalUrl ?? null,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Web evidence processing failed"
      this.store.setCaptureStatus(version.id, "partial", `Web evidence processing failure: ${message}`)
      throw error
    }
  }

  private async processDocument(input: {
    sourceId: string
    sourceVersionId: string
    mode: EvidenceMode
    languageHints?: string[]
    initialCapture: boolean
    allowIncomplete?: boolean
    artifact?: { blobSha256: string; mime: EvidenceMime }
  }) {
    const version = this.store.sourceVersion(input.sourceVersionId)
    const artifact = input.artifact ?? { blobSha256: version.blob_sha256, mime: evidenceMime(version.mime) }
    const jobId = `job_${randomUUID()}`
    const outputDir = join(this.dataRoot, "worker-output", version.id, jobId)
    await mkdir(outputDir, { recursive: true })
    const request: WorkerRequest = {
      contract_version: 1,
      job_id: jobId,
      source_version_id: version.id,
      blob_path: this.store.blobs.path(artifact.blobSha256),
      output_dir: outputDir,
      expected_sha256: artifact.blobSha256,
      mime: artifact.mime,
      mode: input.mode,
      language_hints: input.languageHints?.length ? input.languageHints : ["eng"],
    }
    try {
      const result = workerResult(await this.runner(request))
      if (result.job_id !== jobId) throw new Error("Evidence worker returned the wrong job ID")
      if (result.source_version_id !== version.id) throw new Error("Evidence worker returned the wrong source version")
      if (result.source_hash !== artifact.blobSha256) throw new Error("Evidence worker returned the wrong source hash")
      if (result.ocr_mode !== input.mode) throw new Error("Evidence worker returned the wrong parsing mode")
      if (result.page_count !== result.pages.length) throw new Error("Evidence worker returned a page-count mismatch")
      if (hashText(result.items.map((item) => item.text).join("\n\n")) !== result.normalized_text_sha256)
        throw new Error("Evidence worker returned the wrong normalized-text hash")
      const pageImages = new Map<number, string>()
      for (const page of result.pages) {
        if (pageImages.has(page.page_number)) throw new Error(`Evidence worker duplicated page ${page.page_number}`)
        const pagePath = await boundedWorkerPath(outputDir, page.image_path)
        const bytes = new Uint8Array(await Bun.file(pagePath).arrayBuffer())
        const stored = await this.store.blobs.put(bytes)
        if (stored.sha256 !== page.image_sha256)
          throw new Error(`Evidence worker page hash mismatch: ${page.page_number}`)
        pageImages.set(page.page_number, stored.sha256)
      }
      if (input.initialCapture)
        this.store.setCaptureStatus(version.id, "complete", "Parsed locally by the supervised evidence worker")
      const representationId = this.store.addRepresentation({
        sourceVersionId: version.id,
        inputBlobSha256: artifact.blobSha256,
        parserName: result.parser_name,
        parserVersion: result.parser_version,
        ocrEngine: result.ocr_engine,
        ocrVersion: result.worker_version,
        mode: result.ocr_mode,
        normalizedTextSha256: result.normalized_text_sha256,
        qualityMetrics: result.quality_metrics,
        warnings: result.warnings,
        passages: passages(result, pageImages),
        allowIncomplete: input.allowIncomplete,
      })
      return {
        sourceId: input.sourceId,
        sourceVersionId: version.id,
        representationId,
        mode: result.ocr_mode,
        pageCount: result.pages.length,
        passageCount: result.items.length,
        warnings: result.warnings,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Evidence worker failed"
      if (input.initialCapture)
        this.store.setCaptureStatus(version.id, "partial", `Evidence worker failure: ${message}`)
      throw error
    }
  }
}

export function localEvidenceWorker(
  workerRoot = resolve(import.meta.dir, "../../legal-evidence-worker"),
): EvidenceWorkerRunner {
  const discovery = discoverEvidenceWorkerRuntime(workerRoot)
  if (discovery.status !== "ready") return unavailableEvidenceWorker(discovery.detail)
  const runtime = discovery.runtime
  return async (request) => {
    const requestPath = join(request.output_dir, "request.json")
    await Bun.write(requestPath, `${JSON.stringify(request, null, 2)}\n`)
    const processHandle = Bun.spawn([runtime.python, "-m", "legal_evidence_worker.cli", requestPath], {
      cwd: runtime.packageRoot,
      env: workerEnvironment(process.env, runtime),
      stdout: "pipe",
      stderr: "pipe",
    })
    const kill = () => processHandle.kill()
    const timedExit = new Promise<number>((resolveExit, rejectExit) => {
      const timer = setTimeout(
        () => {
          kill()
          rejectExit(new Error("Evidence worker exceeded the five-minute execution limit"))
        },
        5 * 60 * 1000,
      )
      void processHandle.exited.then(
        (code) => {
          clearTimeout(timer)
          resolveExit(code)
        },
        (error: unknown) => {
          clearTimeout(timer)
          rejectExit(error)
        },
      )
    })
    let exitCode: number
    let stdout: string
    let stderr: string
    try {
      ;[exitCode, stdout, stderr] = await Promise.all([
        timedExit,
        readBounded(processHandle.stdout, 4 * 1024 * 1024, kill, "stdout"),
        readBounded(processHandle.stderr, 4 * 1024 * 1024, kill, "stderr"),
      ])
    } catch (error) {
      kill()
      throw error
    }
    if (exitCode !== 0) throw new Error(`Evidence worker exited ${exitCode}: ${stderr.trim() || "no diagnostic"}`)
    try {
      return JSON.parse(stdout)
    } catch {
      throw new Error("Evidence worker returned invalid JSON")
    }
  }
}

export function unavailableEvidenceWorker(reason: string): EvidenceWorkerRunner {
  return async () => {
    throw new Error(reason)
  }
}

export function workerEnvironment(environment: NodeJS.ProcessEnv = process.env, runtime?: EvidenceWorkerRuntime) {
  const allowed = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "XDG_CACHE_HOME", "DOCLING_ARTIFACTS_PATH"] as const
  const result: Record<string, string> = {
    PYTHONPATH: runtime?.packageRoot ?? ".",
    PYTHONNOUSERSITE: "1",
  }
  for (const name of allowed) {
    const value = environment[name]
    if (value) result[name] = value
  }
  if (runtime?.kind === "packaged") {
    result.LEGAL_EVIDENCE_OCR_ENGINE = runtime.ocrEngine
    result.LEGAL_EVIDENCE_OCR_LANGUAGES = runtime.ocrLanguages.join(",")
    if (runtime.artifactsPath) result.DOCLING_ARTIFACTS_PATH = runtime.artifactsPath
    result.HF_HUB_OFFLINE = "1"
    result.HF_HUB_DISABLE_TELEMETRY = "1"
    result.TRANSFORMERS_OFFLINE = "1"
  }
  return result
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number, onLimit: () => void, name: string) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let output = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) return output + decoder.decode()
    size += chunk.value.byteLength
    if (size > limit) {
      onLimit()
      await reader.cancel()
      throw new Error(`Evidence worker ${name} exceeded the ${limit}-byte limit`)
    }
    output += decoder.decode(chunk.value, { stream: true })
  }
}

function workerResult(value: unknown): WorkerResult {
  const result = record(value, "evidence-worker result")
  if (result.contract_version !== 1 || !Array.isArray(result.pages) || !Array.isArray(result.items))
    throw new Error("Invalid evidence-worker result contract")
  const mode = result.ocr_mode
  if (mode !== "adaptive" && mode !== "strict_visual" && mode !== "structural")
    throw new Error("Invalid evidence-worker OCR mode")
  if (!Array.isArray(result.warnings)) throw new Error("Invalid evidence-worker warnings")
  return {
    contract_version: 1,
    job_id: requiredString(result.job_id, "job ID"),
    worker_version: requiredString(result.worker_version, "worker version"),
    parser_name: requiredString(result.parser_name, "parser name"),
    parser_version: requiredString(result.parser_version, "parser version"),
    ocr_engine: requiredString(result.ocr_engine, "OCR engine"),
    ocr_mode: mode,
    source_version_id: requiredString(result.source_version_id, "source version ID"),
    source_hash: requiredString(result.source_hash, "source hash"),
    normalized_text_sha256: requiredHash(result.normalized_text_sha256, "normalized text hash"),
    quality_metrics: result.quality_metrics,
    warnings: result.warnings,
    page_count: requiredNumber(result.page_count, "page count"),
    pages: result.pages.map((value, index) => {
      const page = record(value, `page ${index}`)
      return {
        page_number: requiredNumber(page.page_number, `page ${index} number`),
        image_path: requiredString(page.image_path, `page ${index} image path`),
        image_sha256: requiredHash(page.image_sha256, `page ${index} image hash`),
      }
    }),
    items: result.items.map((value, index) => {
      const item = record(value, `item ${index}`)
      if (!Array.isArray(item.regions)) throw new Error(`Invalid item ${index} regions`)
      return {
        worker_item_id: requiredString(item.worker_item_id, `item ${index} worker ID`),
        source_ref: requiredString(item.source_ref, `item ${index} source ref`),
        order: requiredNumber(item.order, `item ${index} order`),
        text: requiredString(item.text, `item ${index} text`),
        text_sha256: requiredHash(item.text_sha256, `item ${index} text hash`),
        regions: item.regions.map((value, regionIndex) => {
          const region = record(value, `item ${index} region ${regionIndex}`)
          const bbox = record(region.bbox, `item ${index} region ${regionIndex} box`)
          return {
            page_number: requiredNumber(region.page_number, `item ${index} region ${regionIndex} page`),
            page_width: requiredNumber(region.page_width, `item ${index} region ${regionIndex} width`),
            page_height: requiredNumber(region.page_height, `item ${index} region ${regionIndex} height`),
            bbox: {
              left: requiredNumber(bbox.left, "box left"),
              top: requiredNumber(bbox.top, "box top"),
              right: requiredNumber(bbox.right, "box right"),
              bottom: requiredNumber(bbox.bottom, "box bottom"),
            },
          }
        }),
      }
    }),
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${name}`)
  return Object.fromEntries(Object.entries(value))
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Invalid ${name}`)
  return value
}

function requiredNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${name}`)
  return value
}

function requiredHash(value: unknown, name: string): string {
  const result = requiredString(value, name)
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`Invalid ${name}`)
  return result
}

function evidenceMime(value: string): EvidenceMime {
  if (
    value === "application/pdf" ||
    value === "image/png" ||
    value === "image/jpeg" ||
    value === "text/html" ||
    value === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return value
  throw new Error(`Unsupported evidence MIME type: ${value}`)
}

function modeForMime(mime: EvidenceMime, requested?: "adaptive" | "strict_visual"): EvidenceMode {
  if (mime === "text/html" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return "structural"
  return requested ?? "adaptive"
}

async function boundedWorkerPath(outputDir: string, relativePath: string) {
  const root = await realpath(resolve(outputDir))
  const candidate = resolve(root, relativePath)
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`))
    throw new Error("Evidence worker page path escaped its output directory")
  const canonical = await realpath(candidate)
  if (canonical !== root && !canonical.startsWith(`${root}${sep}`))
    throw new Error("Evidence worker page path resolved outside its output directory")
  return canonical
}

function passages(result: WorkerResult, pageImages: Map<number, string>) {
  const orders = new Set<number>()
  let characterOffset = 0
  return result.items.map((item) => {
    if (hashText(item.text) !== item.text_sha256) throw new Error(`Evidence worker item hash mismatch: ${item.order}`)
    if (!Number.isInteger(item.order) || item.order < 0 || orders.has(item.order))
      throw new Error(`Evidence worker returned an invalid item order: ${item.order}`)
    orders.add(item.order)
    const startOffset = characterOffset
    const endOffset = startOffset + item.text.length
    characterOffset = endOffset + 2
    return {
      sourceRef: item.source_ref,
      order: item.order,
      text: item.text,
      startOffset,
      endOffset,
      sectionPath: item.source_ref,
      regions: item.regions.map((region) => {
        const box = region.bbox
        const valid =
          Number.isInteger(region.page_number) &&
          region.page_number > 0 &&
          region.page_width > 0 &&
          region.page_height > 0 &&
          box.left >= 0 &&
          box.top >= 0 &&
          box.right > box.left &&
          box.bottom > box.top &&
          box.right <= region.page_width &&
          box.bottom <= region.page_height
        if (!valid) throw new Error(`Evidence worker returned invalid geometry for item ${item.order}`)
        const imageBlobHash = pageImages.get(region.page_number)
        if (!imageBlobHash) throw new Error(`Evidence worker omitted page image ${region.page_number}`)
        return {
          pageNumber: region.page_number,
          pageWidth: region.page_width,
          pageHeight: region.page_height,
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          imageBlobHash,
        }
      }),
    }
  })
}
