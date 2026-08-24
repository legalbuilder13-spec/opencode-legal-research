import { afterEach, describe, expect, test } from "bun:test"
import { hashBytes, hashText } from "@legalbuilder/legal-research-core"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWorkbench } from "../src/app"
import type { EvidenceWorkerRunner } from "../src/ingestion"

const close: Array<() => void> = []

afterEach(() => {
  for (const stop of close.splice(0)) stop()
})

async function fixture() {
  const dataRoot = await mkdtemp(join(tmpdir(), "legal-workbench-test-"))
  const workbench = await createWorkbench({ dataRoot, fixtureAccount: true, workerRunner: fixtureWorker })
  close.push(workbench.close)
  return workbench
}

async function call(handler: (request: Request) => Promise<Response>, path: string, init?: RequestInit) {
  return handler(
    new Request(`http://workbench.test${path}`, {
      headers: typeof init?.body === "string" ? { "Content-Type": "application/json" } : undefined,
      ...init,
    }),
  )
}

describe("legal workbench integration", () => {
  test("WB-01 serves the usable shell and subscription fixture", async () => {
    const { handler } = await fixture()
    const shell = await call(handler, "/")
    expect(shell.status).toBe(200)
    expect(await shell.text()).toContain("Review exact evidence")

    const account = await call(handler, "/api/account")
    expect(await account.json()).toEqual({ mode: "subscription", planType: "fixture", apiKeyRequired: false })
  })

  test("WB-02 completes matter, evidence, research, citation, and export workflow", async () => {
    const { handler } = await fixture()
    const createMatter = await call(handler, "/api/matters", {
      method: "POST",
      body: JSON.stringify({
        name: "Synthetic immunity matter",
        jurisdiction: "9th Cir.",
        researchAsOf: "2026-08-23",
        confidentiality: "privileged",
      }),
    })
    expect(createMatter.status).toBe(201)
    const matter = record(await createMatter.json(), "matter")
    const matterId = string(matter.id, "matter id")

    const updateMatter = await call(handler, `/api/matters/${matterId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Updated immunity matter",
        jurisdiction: "N.D. Cal.",
        researchAsOf: "2026-08-24",
        confidentiality: "confidential",
        clientLabel: "Client 001",
      }),
    })
    expect(await updateMatter.json()).toMatchObject({
      name: "Updated immunity matter",
      jurisdiction: "N.D. Cal.",
      researchAsOf: "2026-08-24",
      confidentiality: "confidential",
      clientLabel: "Client 001",
    })
    const archiveMatter = await call(handler, `/api/matters/${matterId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    })
    expect(await archiveMatter.json()).toHaveProperty("status", "archived")
    const reopenMatter = await call(handler, `/api/matters/${matterId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active" }),
    })
    expect(await reopenMatter.json()).toHaveProperty("status", "active")

    const capture = await call(handler, `/api/matters/${matterId}/sources`, {
      method: "POST",
      body: JSON.stringify({
        title: "Synthetic qualified-immunity authority",
        text: "Qualified immunity is denied when controlling precedent clearly establishes the asserted right. A narrow exception applies to obvious constitutional violations.",
      }),
    })
    expect(capture.status).toBe(201)
    expect(await capture.json()).toHaveProperty("untrustedSourceData", true)

    const sources = await call(handler, `/api/matters/${matterId}/sources`)
    const sourceList = array(await sources.json(), "source list").map((source) => record(source, "source"))
    expect(sourceList).toHaveLength(1)
    expect(sourceList[0]?.capture_status).toBe("complete")
    expect(sourceList[0]?.content_sha256).toHaveLength(64)

    const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])
    const uploadBody = new FormData()
    uploadBody.append("file", new File([pdfBytes], "synthetic-opinion.pdf", { type: "application/pdf" }))
    uploadBody.append("mode", "strict_visual")
    uploadBody.append("languageHints", "eng")
    const upload = await call(handler, `/api/matters/${matterId}/uploads`, { method: "POST", body: uploadBody })
    expect(upload.status).toBe(201)
    expect(await upload.json()).toMatchObject({ mode: "strict_visual", pageCount: 1, passageCount: 1 })
    const sourcesAfterUpload = array(
      await (await call(handler, `/api/matters/${matterId}/sources`)).json(),
      "sources after upload",
    ).map((source) => record(source, "source after upload"))
    const pdfSource = sourcesAfterUpload.find((source) => source.mime === "application/pdf")
    expect(pdfSource).toBeDefined()
    expect(pdfSource?.capture_status).toBe("complete")
    expect(pdfSource?.representations).toHaveProperty("0.mode", "strict_visual")

    const plan = await call(handler, `/api/matters/${matterId}/plan`, {
      method: "POST",
      body: JSON.stringify({ question: "When is qualified immunity denied?", proceduralPosture: "summary judgment" }),
    })
    expect(await plan.json()).toHaveProperty("lanes.1.kind", "adverse")

    const research = await call(handler, `/api/matters/${matterId}/research`, {
      method: "POST",
      body: JSON.stringify({ question: "qualified immunity controlling precedent exception" }),
    })
    const ranked = record(await research.json(), "research result")
    const ordinary = record(ranked.ordinary, "ordinary result")
    const firstResult = record(array(ordinary.results, "ranked results")[0], "first ranked result")
    expect(firstResult.sourceTitle).toBe("Synthetic qualified-immunity authority")
    expect(firstResult.supportEligible).toBe(true)

    const draftResponse = await call(handler, `/api/matters/${matterId}/answers`, {
      method: "POST",
      body: JSON.stringify({
        question: "When is qualified immunity denied?",
        proceduralPosture: "summary judgment",
      }),
    })
    expect(draftResponse.status).toBe(201)
    const draft = record(await draftResponse.json(), "draft response")
    const answer = record(draft.answer, "finalized answer")
    expect(answer).toMatchObject({
      matterId,
      status: "finalized",
      sourceComplete: true,
      threadId: "fixture-subscription-thread",
    })
    const answerCitation = record(array(answer.citations, "answer citations")[0], "answer citation")
    const answerCitationId = string(answerCitation.citationId, "answer citation id")
    const resolvedAnswerCitation = await call(handler, `/api/answer-citations/${answerCitationId}`)
    expect(await resolvedAnswerCitation.json()).toHaveProperty(
      "evidence.0.sourceTitle",
      "Synthetic qualified-immunity authority",
    )

    const answers = await call(handler, `/api/matters/${matterId}/answers`)
    expect(array(await answers.json(), "matter answers")).toHaveLength(1)
    const answerReceipt = await call(handler, `/api/answers/${string(answer.id, "answer id")}/export`)
    expect(answerReceipt.headers.get("Content-Disposition")).toContain("answer-receipt.json")
    expect(await answerReceipt.json()).toHaveProperty("answer.sourceComplete", true)

    const bootstrap = await call(handler, "/api/bootstrap")
    const state = record(await bootstrap.json(), "bootstrap")
    expect(state.selectedMatterId).toBe(matterId)
    const citationDemo = record(state.citationDemo, "citation demo")
    const firstCitation = record(array(citationDemo.citations, "citations")[0], "first citation")
    const citationId = string(firstCitation.citationId, "citation id")
    const citation = await call(handler, `/api/citations/${citationId}`)
    expect(await citation.json()).toHaveProperty("evidence.length", 2)

    const receipt = await call(handler, `/api/matters/${matterId}/export`)
    expect(receipt.headers.get("Content-Disposition")).toContain("provenance.json")
    const exported = record(await receipt.json(), "export receipt")
    expect(record(exported.matter, "exported matter").id).toBe(matterId)
    expect(array(exported.sources, "exported sources")).toHaveLength(2)
    expect(array(exported.retrievalRuns, "exported retrieval runs").length).toBeGreaterThanOrEqual(4)
  })

  test("WB-03 rejects cross-matter source access", async () => {
    const { handler } = await fixture()
    const response = await call(handler, "/api/matters/mat_missing/sources")
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Unknown matter: mat_missing" })
  })
})

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected ${name}`)
  return Object.fromEntries(Object.entries(value))
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${name}`)
  return value
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`Expected ${name}`)
  return value
}

const fixtureWorker: EvidenceWorkerRunner = async (request) => {
  const passage = "An unrelated PDF protocol passage."
  const pageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  await Bun.write(join(request.output_dir, "page-0001.png"), pageBytes)
  return {
    contract_version: 1,
    worker_version: "fixture-worker-1",
    parser_name: "docling",
    parser_version: "fixture-docling",
    ocr_engine: "fixture-ocr",
    ocr_mode: request.mode,
    source_version_id: request.source_version_id,
    source_hash: request.expected_sha256,
    normalized_text_sha256: hashText(passage),
    quality_metrics: { pages_with_text: 1, empty_page_count: 0 },
    warnings: [],
    pages: [{ page_number: 1, image_path: "page-0001.png", image_sha256: hashBytes(pageBytes) }],
    items: [
      {
        worker_item_id: "fixture-item-1",
        source_ref: "#/items/0",
        order: 0,
        text: passage,
        text_sha256: hashText(passage),
        regions: [
          {
            page_number: 1,
            page_width: 612,
            page_height: 792,
            bbox: { left: 72, top: 100, right: 400, bottom: 120 },
          },
        ],
      },
    ],
  }
}
