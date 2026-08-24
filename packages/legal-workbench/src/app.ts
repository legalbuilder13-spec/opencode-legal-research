import { connect } from "@legalbuilder/codex-app-server-spike"
import { CitationStore } from "@legalbuilder/legal-citation-spike"
import { seedDemo } from "@legalbuilder/legal-citation-spike/demo"
import {
  AnswerFinalizer,
  LegalResearchStore,
  ResearchPlanner,
  RetrievalEngine,
  SourceMaterializer,
} from "@legalbuilder/legal-research-core"
import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { EvidenceIngestionService, type EvidenceWorkerRunner } from "./ingestion"
import { fixtureSynthesizer, parseSynthesis, subscriptionSynthesizer, type WorkbenchSynthesizer } from "./synthesis"

export interface WorkbenchOptions {
  dataRoot: string
  fixtureAccount?: boolean
  synthesizer?: WorkbenchSynthesizer
  workerRunner?: EvidenceWorkerRunner
}

export async function createWorkbench(options: WorkbenchOptions) {
  const dataRoot = resolve(options.dataRoot)
  await mkdir(dataRoot, { recursive: true })
  const core = new LegalResearchStore({
    databasePath: join(dataRoot, "legal-research.sqlite"),
    blobRoot: join(dataRoot, "blobs"),
  })
  const materializer = new SourceMaterializer(core)
  const retrieval = new RetrievalEngine(core)
  const planner = new ResearchPlanner(core)
  const answers = new AnswerFinalizer(core)
  const ingestion = new EvidenceIngestionService(core, dataRoot, options.workerRunner)
  const synthesize =
    options.synthesizer ?? (options.fixtureAccount ? fixtureSynthesizer : subscriptionSynthesizer(dataRoot))
  const citations = new CitationStore()
  const citationDemo = await seedDemo(citations)
  const webRoot = join(import.meta.dir, "web")

  async function bootstrap() {
    const matters = core.listMatters({ includeArchived: true })
    return { matters, selectedMatterId: matters.find((matter) => matter.status === "active")?.id ?? null, citationDemo }
  }

  async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url)
    try {
      if (url.pathname === "/api/bootstrap" && request.method === "GET") return Response.json(await bootstrap())
      if (url.pathname === "/api/account" && request.method === "GET") {
        if (options.fixtureAccount)
          return Response.json({ mode: "subscription", planType: "fixture", apiKeyRequired: false })
        const client = await connect({ cwd: process.cwd() })
        try {
          const state = await client.account()
          return Response.json({
            mode: state.account?.type ?? "signed-out",
            planType: state.account?.type === "chatgpt" ? state.account.planType : null,
            apiKeyRequired: false,
          })
        } finally {
          await client.close()
        }
      }
      if (url.pathname === "/api/matters" && request.method === "POST") {
        const body = object(await request.json(), "matter request")
        const matter = core.createMatter({
          name: string(body.name, "name"),
          jurisdiction: string(body.jurisdiction, "jurisdiction"),
          researchAsOf: string(body.researchAsOf, "researchAsOf"),
          confidentiality: confidentiality(body.confidentiality),
          clientLabel: optionalString(body.clientLabel),
        })
        return Response.json(matter, { status: 201 })
      }
      const matterMatch = url.pathname.match(/^\/api\/matters\/([^/]+)$/)
      if (matterMatch && request.method === "PATCH") {
        const matterId = pathParameter(matterMatch)
        const body = object(await request.json(), "matter update")
        if (body.status === "active" || body.status === "archived") {
          return Response.json(core.setMatterStatus(matterId, body.status))
        }
        return Response.json(
          core.updateMatter(matterId, {
            name: optionalString(body.name),
            jurisdiction: optionalString(body.jurisdiction),
            researchAsOf: optionalString(body.researchAsOf),
            confidentiality: optionalConfidentiality(body.confidentiality),
            clientLabel: optionalString(body.clientLabel),
          }),
        )
      }
      const sourceMatch = url.pathname.match(/^\/api\/matters\/([^/]+)\/sources$/)
      if (sourceMatch && request.method === "GET") {
        const matterId = pathParameter(sourceMatch)
        const exported = core.exportMatter(matterId)
        return Response.json(
          exported.sources.map((source) => ({
            ...source,
            representations: exported.representations.filter(
              (representation) => representation.sourceVersionId === source.source_version_id,
            ),
          })),
        )
      }
      if (sourceMatch && request.method === "POST") {
        const matterId = pathParameter(sourceMatch)
        const body = object(await request.json(), "source request")
        const passage = await materializer.captureText({
          matterId,
          title: string(body.title, "title"),
          text: string(body.text, "text"),
          origin: "workbench:text-entry",
          kind: "upload",
        })
        return Response.json(passage, { status: 201 })
      }
      const uploadMatch = url.pathname.match(/^\/api\/matters\/([^/]+)\/uploads$/)
      if (uploadMatch && request.method === "POST") {
        const matterId = pathParameter(uploadMatch)
        const form = await request.formData()
        const file = form.get("file")
        if (!(file instanceof File)) throw new Error("PDF file is required")
        if (file.type !== "application/pdf") throw new Error("Only PDF ingestion is currently available")
        if (file.size > 100 * 1024 * 1024) throw new Error("PDF exceeds the 100 MB local limit")
        const modeValue = form.get("mode")
        const mode = modeValue === "strict_visual" ? "strict_visual" : "adaptive"
        const languageValue = form.get("languageHints")
        const languageHints =
          typeof languageValue === "string"
            ? languageValue
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean)
            : undefined
        return Response.json(
          await ingestion.ingestPdf({
            matterId,
            title: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
            mode,
            languageHints,
          }),
          { status: 201 },
        )
      }
      const planMatch = url.pathname.match(/^\/api\/matters\/([^/]+)\/plan$/)
      if (planMatch && request.method === "POST") {
        const matterId = pathParameter(planMatch)
        const body = object(await request.json(), "plan request")
        return Response.json(
          planner.plan({
            matterId,
            question: string(body.question, "question"),
            proceduralPosture: optionalString(body.proceduralPosture),
          }),
        )
      }
      const researchMatch = url.pathname.match(/^\/api\/matters\/([^/]+)\/research$/)
      if (researchMatch && request.method === "POST") {
        const matterId = pathParameter(researchMatch)
        const body = object(await request.json(), "research request")
        const question = string(body.question, "question")
        return Response.json({
          ordinary: retrieval.search({ matterId, query: question, limit: 6, maxPerSource: 2 }),
          adverse: retrieval.adverseSearch({ matterId, query: question, limit: 4, maxPerSource: 1 }),
        })
      }
      const answersMatch = url.pathname.match(/^\/api\/matters\/([^/]+)\/answers$/)
      if (answersMatch && request.method === "GET") {
        return Response.json(answers.list(pathParameter(answersMatch)))
      }
      if (answersMatch && request.method === "POST") {
        const matterId = pathParameter(answersMatch)
        const matter = core.matter(matterId)
        const body = object(await request.json(), "answer request")
        const question = string(body.question, "question")
        const proceduralPosture = optionalString(body.proceduralPosture)
        const plan = planner.plan({ matterId, question, proceduralPosture })
        const ordinary = retrieval.search({ matterId, query: question, limit: 6, maxPerSource: 2 })
        const adverse = retrieval.adverseSearch({ matterId, query: question, limit: 4, maxPerSource: 1 })
        const passages = [
          ...ordinary.results.map((passage) => ({ ...passage, lane: "primary" as const })),
          ...adverse.results.map((passage) => ({ ...passage, lane: "adverse" as const })),
        ].filter(
          (passage, index, all) =>
            passage.supportEligible && all.findIndex((item) => item.passageId === passage.passageId) === index,
        )
        if (!passages.length) throw new Error("No support-eligible full-source passages are available")
        const draft = await synthesize({
          matterId,
          question,
          jurisdiction: matter.jurisdiction,
          researchAsOf: matter.researchAsOf,
          proceduralPosture,
          passages,
        })
        const validated = parseSynthesis(
          JSON.stringify({ answer: draft.answer, claims: draft.claims }),
          new Set(passages.map((passage) => passage.passageId)),
        )
        const messageId = answers.create({
          matterId,
          question,
          text: validated.answer,
          threadId: draft.threadId ?? undefined,
          retrievalRunIds: [ordinary.retrievalRunId, adverse.retrievalRunId],
        })
        answers.finalize(
          messageId,
          validated.claims.map((claim) => {
            const start = validated.answer.indexOf(claim.text)
            return { start, end: start + claim.text.length, evidence: claim.evidence }
          }),
        )
        return Response.json(
          { plan, research: { ordinary, adverse }, answer: answers.view(messageId) },
          { status: 201 },
        )
      }
      if (url.pathname.startsWith("/api/answer-citations/") && request.method === "GET") {
        const citation = answers.resolve(decodeURIComponent(url.pathname.slice("/api/answer-citations/".length)))
        return citation ? Response.json(citation) : jsonError("Answer citation not found", 404)
      }
      const answerExportMatch = url.pathname.match(/^\/api\/answers\/([^/]+)\/export$/)
      if (answerExportMatch && request.method === "GET") {
        const answerId = pathParameter(answerExportMatch)
        return new Response(`${JSON.stringify(answers.receipt(answerId), null, 2)}\n`, {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="${answerId}-answer-receipt.json"`,
          },
        })
      }
      const exportMatch = url.pathname.match(/^\/api\/matters\/([^/]+)\/export$/)
      if (exportMatch && request.method === "GET") {
        const matterId = pathParameter(exportMatch)
        return new Response(`${JSON.stringify(core.exportMatter(matterId), null, 2)}\n`, {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="${matterId}-provenance.json"`,
          },
        })
      }
      if (url.pathname.startsWith("/api/citations/") && request.method === "GET") {
        const citation = citations.resolveCitation(decodeURIComponent(url.pathname.slice("/api/citations/".length)))
        return citation ? Response.json(citation) : jsonError("Citation not found", 404)
      }
      if (url.pathname.startsWith("/assets/page/") && request.method === "GET") {
        const asset = citations.pageAsset(decodeURIComponent(url.pathname.slice("/assets/page/".length)))
        return asset ? new Response(Bun.file(asset)) : jsonError("Page not found", 404)
      }
      if (url.pathname.startsWith("/assets/matter-page/") && request.method === "GET") {
        const asset = answers.pageAsset(decodeURIComponent(url.pathname.slice("/assets/matter-page/".length)))
        return asset ? new Response(Bun.file(asset)) : jsonError("Matter page not found", 404)
      }
      if (request.method !== "GET") return jsonError("Method not allowed", 405)
      const staticPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1)
      if (!/^(index\.html|app\.js|styles\.css)$/.test(staticPath)) return jsonError("Not found", 404)
      return new Response(Bun.file(join(webRoot, staticPath)))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected workbench error"
      return jsonError(message, 400)
    }
  }

  function close() {
    core.close()
    citations.close()
  }

  return { handler, close, core, answers }
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status })
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${name}`)
  return Object.fromEntries(Object.entries(value))
}

function string(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function confidentiality(value: unknown): "public" | "confidential" | "privileged" {
  if (value === "public" || value === "confidential" || value === "privileged") return value
  throw new Error("Invalid confidentiality label")
}

function optionalConfidentiality(value: unknown) {
  if (value === undefined) return undefined
  return confidentiality(value)
}

function pathParameter(match: RegExpMatchArray) {
  const value = match[1]
  if (!value) throw new Error("Invalid resource path")
  return decodeURIComponent(value)
}
