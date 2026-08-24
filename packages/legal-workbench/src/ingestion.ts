import { LegalResearchStore } from "@legalbuilder/legal-research-core"
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"

export interface WorkerRequest {
  contract_version: 1
  job_id: string
  source_version_id: string
  blob_path: string
  output_dir: string
  expected_sha256: string
  mime: "application/pdf"
  mode: "adaptive" | "strict_visual"
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
  worker_version: string
  parser_name: string
  parser_version: string
  ocr_engine: string
  ocr_mode: "adaptive" | "strict_visual"
  source_version_id: string
  source_hash: string
  normalized_text_sha256: string
  quality_metrics: unknown
  warnings: unknown
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
    const materialized = await this.store.materialize({
      matterId: input.matterId,
      title: input.title,
      kind: "upload",
      mime: "application/pdf",
      bytes: input.bytes,
      origin: `upload:${input.title}`,
      status: "partial",
      accessNotes: "Local evidence-worker ingestion pending",
    })
    const version = this.store.sourceVersion(materialized.sourceVersionId)
    const outputDir = join(this.dataRoot, "worker-output", version.id, input.mode)
    await mkdir(outputDir, { recursive: true })
    const request: WorkerRequest = {
      contract_version: 1,
      job_id: `job_${randomUUID()}`,
      source_version_id: version.id,
      blob_path: this.store.blobs.path(version.blob_sha256),
      output_dir: outputDir,
      expected_sha256: version.content_sha256,
      mime: "application/pdf",
      mode: input.mode,
      language_hints: input.languageHints?.length ? input.languageHints : ["eng"],
    }
    try {
      const result = workerResult(await this.runner(request))
      if (result.source_version_id !== version.id) throw new Error("Evidence worker returned the wrong source version")
      if (result.source_hash !== version.content_sha256)
        throw new Error("Evidence worker returned the wrong source hash")
      const pageImages = new Map<number, string>()
      for (const page of result.pages) {
        const bytes = new Uint8Array(await Bun.file(join(outputDir, page.image_path)).arrayBuffer())
        const stored = await this.store.blobs.put(bytes)
        if (stored.sha256 !== page.image_sha256)
          throw new Error(`Evidence worker page hash mismatch: ${page.page_number}`)
        pageImages.set(page.page_number, stored.sha256)
      }
      this.store.setCaptureStatus(version.id, "complete", "Parsed locally by the supervised evidence worker")
      const representationId = this.store.addRepresentation({
        sourceVersionId: version.id,
        parserName: result.parser_name,
        parserVersion: result.parser_version,
        ocrEngine: result.ocr_engine,
        ocrVersion: result.worker_version,
        mode: result.ocr_mode,
        normalizedTextSha256: result.normalized_text_sha256,
        qualityMetrics: result.quality_metrics,
        warnings: result.warnings,
        passages: result.items.map((item) => ({
          sourceRef: item.source_ref,
          order: item.order,
          text: item.text,
          regions: item.regions.map((region) => ({
            pageNumber: region.page_number,
            pageWidth: region.page_width,
            pageHeight: region.page_height,
            left: region.bbox.left,
            top: region.bbox.top,
            right: region.bbox.right,
            bottom: region.bbox.bottom,
            imageBlobHash: pageImages.get(region.page_number),
          })),
        })),
      })
      return {
        sourceId: materialized.sourceId,
        sourceVersionId: version.id,
        representationId,
        mode: result.ocr_mode,
        pageCount: result.pages.length,
        passageCount: result.items.length,
        warnings: result.warnings,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Evidence worker failed"
      this.store.setCaptureStatus(version.id, "partial", `Evidence worker failure: ${message}`)
      throw error
    }
  }
}

export function localEvidenceWorker(
  workerRoot = resolve(import.meta.dir, "../../legal-evidence-worker"),
): EvidenceWorkerRunner {
  return async (request) => {
    const requestPath = join(request.output_dir, "request.json")
    await Bun.write(requestPath, `${JSON.stringify(request, null, 2)}\n`)
    const environment = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    )
    const processHandle = Bun.spawn(
      [join(workerRoot, ".venv/bin/python"), "-m", "legal_evidence_worker.cli", requestPath],
      {
        cwd: workerRoot,
        env: { ...environment, PYTHONPATH: "." },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      processHandle.exited,
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
    ])
    if (exitCode !== 0) throw new Error(`Evidence worker exited ${exitCode}: ${stderr.trim() || "no diagnostic"}`)
    try {
      return JSON.parse(stdout)
    } catch {
      throw new Error("Evidence worker returned invalid JSON")
    }
  }
}

function workerResult(value: unknown): WorkerResult {
  const result = record(value, "evidence-worker result")
  if (result.contract_version !== 1 || !Array.isArray(result.pages) || !Array.isArray(result.items))
    throw new Error("Invalid evidence-worker result contract")
  const mode = result.ocr_mode
  if (mode !== "adaptive" && mode !== "strict_visual") throw new Error("Invalid evidence-worker OCR mode")
  return {
    contract_version: 1,
    worker_version: requiredString(result.worker_version, "worker version"),
    parser_name: requiredString(result.parser_name, "parser name"),
    parser_version: requiredString(result.parser_version, "parser version"),
    ocr_engine: requiredString(result.ocr_engine, "OCR engine"),
    ocr_mode: mode,
    source_version_id: requiredString(result.source_version_id, "source version ID"),
    source_hash: requiredString(result.source_hash, "source hash"),
    normalized_text_sha256: requiredString(result.normalized_text_sha256, "normalized text hash"),
    quality_metrics: result.quality_metrics,
    warnings: result.warnings,
    pages: result.pages.map((value, index) => {
      const page = record(value, `page ${index}`)
      return {
        page_number: requiredNumber(page.page_number, `page ${index} number`),
        image_path: requiredString(page.image_path, `page ${index} image path`),
        image_sha256: requiredString(page.image_sha256, `page ${index} image hash`),
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
        text_sha256: requiredString(item.text_sha256, `item ${index} text hash`),
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
