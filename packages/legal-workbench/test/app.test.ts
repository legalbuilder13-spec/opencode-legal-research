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

async function fixture(workerRunner: EvidenceWorkerRunner = fixtureWorker) {
  const dataRoot = await mkdtemp(join(tmpdir(), "legal-workbench-test-"))
  const workbench = await createWorkbench({ dataRoot, fixtureAccount: true, workerRunner })
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
    expect(await account.json()).toEqual({
      status: "ready",
      mode: "subscription",
      planType: "fixture",
      apiKeyRequired: false,
      rateLimit: null,
      accountSwitchingAvailable: false,
    })
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
    const pdfVersionId = string(pdfSource?.source_version_id, "PDF source version id")

    const reprocess = await call(handler, `/api/matters/${matterId}/source-versions/${pdfVersionId}/reprocess`, {
      method: "POST",
      body: JSON.stringify({ mode: "adaptive", languageHints: ["eng", "spa"] }),
    })
    expect(reprocess.status).toBe(201)
    expect(await reprocess.json()).toMatchObject({
      sourceVersionId: pdfVersionId,
      mode: "adaptive",
      pageCount: 1,
      passageCount: 1,
    })
    const sourcesAfterReprocess = array(
      await (await call(handler, `/api/matters/${matterId}/sources`)).json(),
      "sources after reprocessing",
    ).map((source) => record(source, "source after reprocessing"))
    const reprocessedPdf = sourcesAfterReprocess.find((source) => source.mime === "application/pdf")
    expect(
        array(reprocessedPdf?.representations, "PDF representations")
          .map((value) => record(value, "representation").mode)
          .sort((left, right) => String(left).localeCompare(String(right))),
    ).toEqual(["adaptive", "strict_visual"])

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

  test("WB-04 failed PDF reprocessing preserves the completed source and prior representation", async () => {
    let workerCalls = 0
    const { handler } = await fixture(async (request) => {
      workerCalls += 1
      if (workerCalls === 2) throw new Error("fixture reprocessing failure")
      return fixtureWorker(request)
    })
    const createMatter = await call(handler, "/api/matters", {
      method: "POST",
      body: JSON.stringify({
        name: "Reprocessing safety matter",
        jurisdiction: "D.C. Cir.",
        researchAsOf: "2026-08-24",
        confidentiality: "privileged",
      }),
    })
    const matterId = string(record(await createMatter.json(), "matter").id, "matter id")
    const uploadBody = new FormData()
    uploadBody.append("file", new File([new Uint8Array([37, 80, 68, 70])], "source.pdf", { type: "application/pdf" }))
    const upload = await call(handler, `/api/matters/${matterId}/uploads`, { method: "POST", body: uploadBody })
    const sourceVersionId = string(record(await upload.json(), "upload").sourceVersionId, "source version id")

    const reprocess = await call(handler, `/api/matters/${matterId}/source-versions/${sourceVersionId}/reprocess`, {
      method: "POST",
      body: JSON.stringify({ mode: "strict_visual", languageHints: ["eng"] }),
    })
    expect(reprocess.status).toBe(400)
    expect(await reprocess.json()).toEqual({ error: "fixture reprocessing failure" })
    const sources = array(await (await call(handler, `/api/matters/${matterId}/sources`)).json(), "sources")
    const source = record(sources[0], "source")
    expect(source.capture_status).toBe("complete")
    expect(array(source.representations, "representations")).toHaveLength(1)
  })

  test("WB-05 ingests PDF, image, HTML, and DOCX through one supervised contract", async () => {
    const { handler } = await fixture()
    const createMatter = await call(handler, "/api/matters", {
      method: "POST",
      body: JSON.stringify({
        name: "Multi-format matter",
        jurisdiction: "S.D.N.Y.",
        researchAsOf: "2026-08-24",
        confidentiality: "confidential",
      }),
    })
    const matterId = string(record(await createMatter.json(), "matter").id, "matter id")
    const uploads = [
      ["authority.pdf", "application/pdf"],
      ["scan.png", "image/png"],
      ["photo.jpg", "image/jpeg"],
      ["opinion.html", "text/html"],
      ["memorandum.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ] as const
    for (const [name, mime] of uploads) {
      const form = new FormData()
      form.append("file", new File([new Uint8Array([1, 2, 3])], name, { type: mime }))
      form.append("mode", "strict_visual")
      const response = await call(handler, `/api/matters/${matterId}/uploads`, { method: "POST", body: form })
      expect(response.status).toBe(201)
      const result = record(await response.json(), `${name} result`)
      expect(result.mode).toBe(
        mime === "text/html" || mime.includes("wordprocessingml") ? "structural" : "strict_visual",
      )
    }
    const sources = array(await (await call(handler, `/api/matters/${matterId}/sources`)).json(), "sources").map(
      (source) => record(source, "source"),
    )
    expect(sources).toHaveLength(5)
    expect(sources.every((source) => source.capture_status === "complete")).toBe(true)
    expect(sources.every((source) => array(source.representations, "representations").length === 1)).toBe(true)
  })

  test("WB-06 rejects worker page paths outside the supervised job directory", async () => {
    const { handler } = await fixture(async (request) => {
      const result = record(await fixtureWorker(request), "worker result")
      const page = record(array(result.pages, "worker pages")[0], "worker page")
      return { ...result, pages: [{ ...page, image_path: "../escaped-page.png" }] }
    })
    const createMatter = await call(handler, "/api/matters", {
      method: "POST",
      body: JSON.stringify({
        name: "Worker boundary matter",
        jurisdiction: "Fed. Cir.",
        researchAsOf: "2026-08-24",
        confidentiality: "privileged",
      }),
    })
    const matterId = string(record(await createMatter.json(), "matter").id, "matter id")
    const form = new FormData()
    form.append("file", new File([new Uint8Array([37, 80, 68, 70])], "boundary.pdf", { type: "application/pdf" }))
    const upload = await call(handler, `/api/matters/${matterId}/uploads`, { method: "POST", body: form })
    expect(upload.status).toBe(400)
    expect(await upload.json()).toEqual({ error: "Evidence worker page path escaped its output directory" })
    const source = record(
      array(await (await call(handler, `/api/matters/${matterId}/sources`)).json(), "sources")[0],
      "source",
    )
    expect(source.capture_status).toBe("partial")
    expect(array(source.representations, "representations")).toHaveLength(0)
  })

  test("WB-07 requires explicit deletion confirmation and reports retained blobs", async () => {
    const { handler } = await fixture()
    const createMatter = await call(handler, "/api/matters", {
      method: "POST",
      body: JSON.stringify({
        name: "Deletion lifecycle matter",
        jurisdiction: "Mass.",
        researchAsOf: "2026-08-24",
        confidentiality: "privileged",
      }),
    })
    const matterId = string(record(await createMatter.json(), "matter").id, "matter id")
    const capture = await call(handler, `/api/matters/${matterId}/sources`, {
      method: "POST",
      body: JSON.stringify({ title: "Deletable source", text: "A source that will leave search." }),
    })
    const sourceVersionId = string(record(await capture.json(), "capture").sourceVersionId, "source version id")

    const rejectedSource = await call(handler, `/api/matters/${matterId}/source-versions/${sourceVersionId}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "wrong" }),
    })
    expect(rejectedSource.status).toBe(400)
    const deletedSource = await call(handler, `/api/matters/${matterId}/source-versions/${sourceVersionId}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation: sourceVersionId }),
    })
    expect(await deletedSource.json()).toMatchObject({
      alreadyDeleted: false,
      blobRetained: true,
      remainingReferences: 0,
    })
    expect(array(await (await call(handler, `/api/matters/${matterId}/sources`)).json(), "sources")).toHaveLength(0)

    const rejectedMatter = await call(handler, `/api/matters/${matterId}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "wrong" }),
    })
    expect(rejectedMatter.status).toBe(400)
    const deletedMatter = await call(handler, `/api/matters/${matterId}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "Deletion lifecycle matter" }),
    })
    expect(await deletedMatter.json()).toMatchObject({
      alreadyDeleted: false,
      blobPolicy: "retained-until-compaction",
      retainedBlobCount: 0,
      sharedBlobCount: 0,
    })
    const bootstrap = record(await (await call(handler, "/api/bootstrap")).json(), "bootstrap")
    expect(array(bootstrap.matters, "matters")).toHaveLength(0)
  })

  test("WB-08 keeps CourtListener search lead-only until full opinion materialization", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "legal-workbench-courtlistener-"))
    const apiFixture = courtListenerFixture()
    const workbench = await createWorkbench({
      dataRoot,
      fixtureAccount: true,
      workerRunner: fixtureWorker,
      courtListener: { fetcher: apiFixture.fetcher, baseUrl: "https://courtlistener.test" },
    })
    close.push(workbench.close)
    const { handler } = workbench
    const createMatter = await call(handler, "/api/matters", {
      method: "POST",
      body: JSON.stringify({
        name: "CourtListener UI matter",
        jurisdiction: "9th Cir.",
        researchAsOf: "2026-08-24",
        confidentiality: "public",
      }),
    })
    const matterId = string(record(await createMatter.json(), "matter").id, "matter id")
    const search = await call(handler, `/api/matters/${matterId}/courtlistener/search`, {
      method: "POST",
      body: JSON.stringify({ token: "fixture-token", query: "qualified immunity", court: "ca9" }),
    })
    const leads = array(await search.json(), "CourtListener leads").map((lead) => record(lead, "lead"))
    expect(leads).toHaveLength(1)
    expect(leads[0]).toMatchObject({ clusterId: 123, supportEligible: false })
    expect(array(await (await call(handler, `/api/matters/${matterId}/sources`)).json(), "sources")).toHaveLength(0)

    const materialized = await call(handler, `/api/matters/${matterId}/courtlistener/clusters/123/materialize`, {
      method: "POST",
      body: JSON.stringify({ token: "fixture-token" }),
    })
    expect(materialized.status).toBe(201)
    expect(await materialized.json()).toMatchObject({ caseName: "Synthetic v. Officer", clusterId: 123 })
    const sources = array(await (await call(handler, `/api/matters/${matterId}/sources`)).json(), "sources").map(
      (source) => record(source, "source"),
    )
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      kind: "courtlistener",
      capture_status: "complete",
      court: "Court of Appeals for the Ninth Circuit",
      jurisdiction: "9th Cir.",
      decision_date: "2025-05-02",
      precedential_status: "published",
      citation: "999 F.4th 123",
      metadata_source: "CourtListener REST API v4.7",
    })
    const receipt = await (await call(handler, `/api/matters/${matterId}/export`)).text()
    expect(receipt).not.toContain("fixture-token")
    expect(apiFixture.authorizations.every((authorization) => authorization === "Token fixture-token")).toBe(true)
  })

  test("WB-09 keeps structural HTML and strict visual OCR under one immutable web source", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "legal-workbench-web-capture-"))
    const html = new TextEncoder().encode(
      '<html><head><title>Rendered legal authority</title><link rel="canonical" href="/authority"></head><body><script>BYPASS_POLICY</script><main>Controlling legal text.</main></body></html>',
    )
    const screenshot = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    const workbench = await createWorkbench({
      dataRoot,
      fixtureAccount: true,
      workerRunner: fixtureWorker,
      webCapture: {
        resolver: async () => ["93.184.216.34"],
        renderer: async () => ({
          finalUrl: "https://law.example/authority?rendered=1",
          status: 200,
          html,
          screenshot,
          screenshotMime: "image/png",
        }),
      },
    })
    close.push(workbench.close)
    const createMatter = await call(workbench.handler, "/api/matters", {
      method: "POST",
      body: JSON.stringify({
        name: "Strict web evidence matter",
        jurisdiction: "U.S.",
        researchAsOf: "2026-08-24",
        confidentiality: "public",
      }),
    })
    const matterId = string(record(await createMatter.json(), "matter").id, "matter id")
    const capture = await call(workbench.handler, `/api/matters/${matterId}/web`, {
      method: "POST",
      body: JSON.stringify({ url: "https://law.example/start#fragment", mode: "strict_visual", languageHints: ["eng"] }),
    })
    expect(capture.status).toBe(201)
    expect(await capture.json()).toMatchObject({
      mode: "strict_visual",
      pageCount: 1,
      passageCount: 2,
      requestedUrl: "https://law.example/start",
      finalUrl: "https://law.example/authority?rendered=1",
      canonicalUrl: "https://law.example/authority",
    })
    const sources = array(await (await call(workbench.handler, `/api/matters/${matterId}/sources`)).json(), "sources")
    expect(sources).toHaveLength(1)
    const source = record(sources[0], "web source")
    expect(source).toMatchObject({ kind: "web", mime: "text/html", capture_status: "complete" })
    const representations = array(source.representations, "representations").map((value) => record(value, "representation"))
    expect(representations.map((representation) => representation.mode)).toEqual(["structural", "strict_visual"])
    expect(new Set(representations.map((representation) => representation.inputBlobSha256)).size).toBe(2)
    const receipt = await (await call(workbench.handler, `/api/matters/${matterId}/export`)).text()
    expect(receipt).toContain(hashBytes(screenshot))
    expect(receipt).not.toContain("BYPASS_POLICY")
  })

  test("WB-10 local-only matters block ChatGPT synthesis without blocking matter persistence", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "legal-workbench-local-only-"))
    let synthesisCalls = 0
    const workbench = await createWorkbench({
      dataRoot,
      fixtureAccount: true,
      workerRunner: fixtureWorker,
      synthesizer: async () => {
        synthesisCalls += 1
        throw new Error("Local-only mode must block before synthesis")
      },
    })
    close.push(workbench.close)
    const created = await call(workbench.handler, "/api/matters", {
      method: "POST",
      body: JSON.stringify({
        name: "Local-only privileged matter",
        jurisdiction: "U.S.",
        researchAsOf: "2026-08-24",
        confidentiality: "privileged",
        localOnly: true,
      }),
    })
    const matter = record(await created.json(), "matter")
    const matterId = string(matter.id, "matter id")
    expect(matter.localOnly).toBe(true)
    const blocked = await call(workbench.handler, `/api/matters/${matterId}/answers`, {
      method: "POST",
      body: JSON.stringify({ question: "Can this leave the device?" }),
    })
    expect(blocked.status).toBe(400)
    expect(await blocked.json()).toEqual({
      error: "ChatGPT drafting is disabled because this matter is local-only",
    })
    expect(synthesisCalls).toBe(0)
    const updated = await call(workbench.handler, `/api/matters/${matterId}`, {
      method: "PATCH",
      body: JSON.stringify({ localOnly: false }),
    })
    expect(await updated.json()).toHaveProperty("localOnly", false)
  })

  test("WB-11 readable answer export preserves multi-passage provenance and escapes counterfeit footnotes", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "legal-workbench-markdown-export-"))
    const workbench = await createWorkbench({
      dataRoot,
      fixtureAccount: true,
      workerRunner: fixtureWorker,
      synthesizer: async (input) => {
        const evidence = input.passages.slice(0, 2).map((passage, index) => ({
          passageId: passage.passageId,
          relationship: index === 0 ? ("supports" as const) : ("qualifies" as const),
        }))
        const answer = "The source-shaped marker [^99] is prose; the combined authorities state a qualified rule."
        return { answer, threadId: "fixture-readable-export", claims: [{ text: answer, evidence }] }
      },
    })
    close.push(workbench.close)
    const created = await call(workbench.handler, "/api/matters", {
      method: "POST",
      body: JSON.stringify({
        name: "Readable *export* matter",
        jurisdiction: "U.S.",
        researchAsOf: "2026-08-24",
        confidentiality: "privileged",
      }),
    })
    const matterId = string(record(await created.json(), "matter").id, "matter id")
    for (const [title, text] of [
      ["Primary authority", "The authority rule applies when every required element is established."],
      ["Qualifying authority", "The authority rule is limited when the record contains a material exception."],
    ]) {
      const source = await call(workbench.handler, `/api/matters/${matterId}/sources`, {
        method: "POST",
        body: JSON.stringify({ title, text }),
      })
      expect(source.status).toBe(201)
    }
    const generated = await call(workbench.handler, `/api/matters/${matterId}/answers`, {
      method: "POST",
      body: JSON.stringify({ question: "What authority rule and exception apply?" }),
    })
    const answer = record(record(await generated.json(), "answer response").answer, "answer")
    const answerId = string(answer.id, "answer id")
    const receipt = record(await (await call(workbench.handler, `/api/answers/${answerId}/export`)).json(), "receipt")
    const exportedAnswer = record(receipt.answer, "exported answer")
    const citation = record(array(exportedAnswer.citations, "citations")[0], "citation")
    const evidence = array(citation.evidence, "citation evidence").map((value) => record(value, "evidence"))
    expect(evidence).toHaveLength(2)

    const readableResponse = await call(workbench.handler, `/api/answers/${answerId}/export.md`)
    expect(readableResponse.status).toBe(200)
    expect(readableResponse.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8")
    expect(readableResponse.headers.get("Content-Disposition")).toContain("legal-research-answer.md")
    const readable = await readableResponse.text()
    expect(readable).toContain("Readable \\*export\\* matter")
    expect(readable).toContain("\\[^99\\]")
    expect(readable).not.toContain("[^99]:")
    expect(readable).toContain(`[^${numeric(citation.footnoteNumber, "footnote number")}]:`)
    expect(readable).toContain(string(citation.citationId, "citation id"))
    expect(readable).toContain(string(citation.claimId, "claim id"))
    for (const item of evidence) {
      expect(readable).toContain(string(item.sourceVersionId, "source version id"))
      expect(readable).toContain(string(item.passageId, "passage id"))
      expect(readable).toContain(string(item.textSha256, "text hash"))
      expect(readable.replaceAll("\\.", ".")).toContain(string(item.text, "exact passage"))
    }
  })

  test("WB-12 changes ChatGPT accounts without changing local matters or evidence", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "legal-workbench-account-switch-"))
    let signedIn = true
    let completeLogin: (() => void) | undefined
    const loginCompletion = new Promise<void>((resolve) => {
      completeLogin = resolve
    })
    const workbench = await createWorkbench({
      dataRoot,
      accountConnect: async () => ({
        account: async () => ({
          requiresOpenaiAuth: true,
          account: signedIn ? ({ type: "chatgpt", planType: "fixture-plus" } as const) : null,
        }),
        rateLimits: async () => ({ limitId: null, primary: null, secondary: null, reachedType: null }),
        logout: async () => {
          signedIn = false
        },
        startLogin: async () => ({
          type: "chatgptDeviceCode" as const,
          loginId: "fixture-login",
          verificationUrl: "https://chatgpt.example/device",
          userCode: "ABCD-EFGH",
          cursor: 0,
        }),
        waitForLogin: async () => {
          await loginCompletion
          signedIn = true
          return { loginId: "fixture-login", success: true, error: null }
        },
        cancelLogin: async () => undefined,
        close: async () => undefined,
      }),
    })
    close.push(workbench.close)
    const created = await call(workbench.handler, "/api/matters", {
      method: "POST",
      body: JSON.stringify({
        name: "Account-independent matter",
        jurisdiction: "U.S.",
        researchAsOf: "2026-08-24",
        confidentiality: "privileged",
      }),
    })
    const matterId = string(record(await created.json(), "matter").id, "matter id")
    await call(workbench.handler, `/api/matters/${matterId}/sources`, {
      method: "POST",
      body: JSON.stringify({ title: "Preserved source", text: "This evidence remains local across account changes." }),
    })
    expect(await (await call(workbench.handler, "/api/account")).json()).toMatchObject({
      status: "ready",
      planType: "fixture-plus",
    })

    const logout = await call(workbench.handler, "/api/account/logout", { method: "POST" })
    expect(await logout.json()).toEqual({ status: "signed-out", retainedMatterCount: 1 })
    expect(await (await call(workbench.handler, "/api/account")).json()).toHaveProperty("status", "signed-out")
    const login = await call(workbench.handler, "/api/account/login/device", { method: "POST" })
    expect(await login.json()).toEqual({
      loginId: "fixture-login",
      verificationUrl: "https://chatgpt.example/device",
      userCode: "ABCD-EFGH",
    })
    expect(await (await call(workbench.handler, "/api/account/login/fixture-login")).json()).toHaveProperty(
      "status",
      "pending",
    )
    completeLogin?.()
    await Bun.sleep(0)
    expect(await (await call(workbench.handler, "/api/account/login/fixture-login")).json()).toHaveProperty(
      "status",
      "completed",
    )
    expect(await (await call(workbench.handler, "/api/account")).json()).toHaveProperty("status", "ready")
    const sources = await call(workbench.handler, `/api/matters/${matterId}/sources`)
    expect(array(await sources.json(), "preserved sources")).toHaveLength(1)
    expect(record(await (await call(workbench.handler, "/api/bootstrap")).json(), "bootstrap")).toMatchObject({
      selectedMatterId: matterId,
      matters: [{ id: matterId, name: "Account-independent matter" }],
    })
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

function numeric(value: unknown, name: string): number {
  if (typeof value !== "number") throw new Error(`Expected ${name}`)
  return value
}

const fixtureWorker: EvidenceWorkerRunner = async (request) => {
  const passage = "An unrelated PDF protocol passage."
  const pageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const visual = request.mode !== "structural"
  if (visual) await Bun.write(join(request.output_dir, "page-0001.png"), pageBytes)
  return {
    contract_version: 1,
    job_id: request.job_id,
    worker_version: "fixture-worker-1",
    parser_name: "docling",
    parser_version: "fixture-docling",
    ocr_engine: visual ? "fixture-ocr" : "none",
    ocr_mode: request.mode,
    source_version_id: request.source_version_id,
    source_hash: request.expected_sha256,
    normalized_text_sha256: hashText(passage),
    quality_metrics: { pages_with_text: 1, empty_page_count: 0 },
    warnings: [],
    page_count: visual ? 1 : 0,
    pages: visual ? [{ page_number: 1, image_path: "page-0001.png", image_sha256: hashBytes(pageBytes) }] : [],
    items: [
      {
        worker_item_id: "fixture-item-1",
        source_ref: "#/items/0",
        order: 0,
        text: passage,
        text_sha256: hashText(passage),
        regions: visual
          ? [
              {
                page_number: 1,
                page_width: 612,
                page_height: 792,
                bbox: { left: 72, top: 100, right: 400, bottom: 120 },
              },
            ]
          : [],
      },
    ],
  }
}

function courtListenerFixture() {
  const authorizations: Array<string | null> = []
  const responses = new Map<string, unknown>([
    [
      "/api/rest/v4/search/?type=o&q=qualified+immunity&court=ca9&stat_Published=on",
      {
        results: [
          {
            absolute_url: "/opinion/123/synthetic-v-officer/",
            caseName: "Synthetic v. Officer",
            citation: ["999 F.4th 123"],
            cluster_id: 123,
            court: "Court of Appeals for the Ninth Circuit",
            court_id: "ca9",
            dateFiled: "2025-05-02",
            status: "Published",
            opinions: [{ id: 456, snippet: "Qualified immunity applies." }],
          },
        ],
      },
    ],
    [
      "/api/rest/v4/clusters/123/",
      {
        docket: "/api/rest/v4/dockets/321/",
        sub_opinions: ["/api/rest/v4/opinions/456/"],
        citations: [{ cite: "999 F.4th 123" }],
        date_filed: "2025-05-02",
        case_name: "Synthetic v. Officer",
        precedential_status: "Published",
        absolute_url: "/opinion/123/synthetic-v-officer/",
      },
    ],
    [
      "/api/rest/v4/dockets/321/",
      {
        court: "/api/rest/v4/courts/ca9/",
        court_id: "ca9",
        case_name: "Synthetic v. Officer",
        date_filed: "2025-05-02",
      },
    ],
    ["/api/rest/v4/courts/ca9/", { full_name: "Court of Appeals for the Ninth Circuit" }],
    [
      "/api/rest/v4/opinions/456/",
      {
        id: 456,
        html_with_citations:
          "<p>Qualified immunity depends on clearly established law.</p><script>fixture-token</script><p>Full opinion text.</p>",
      },
    ],
  ])
  return {
    authorizations,
    fetcher: async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      authorizations.push(new Headers(init?.headers).get("Authorization"))
      const body = responses.get(`${url.pathname}${url.search}`)
      return body
        ? new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify({ detail: "fixture not found" }), { status: 404 })
    },
  }
}
