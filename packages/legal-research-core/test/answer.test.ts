import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AnswerFinalizer, LegalResearchStore, RetrievalEngine, SourceMaterializer } from "../src"

const stores: LegalResearchStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

async function fixture(databasePath?: string) {
  const root = await mkdtemp(join(tmpdir(), "legal-answer-"))
  const store = new LegalResearchStore({ databasePath, blobRoot: join(root, "blobs") })
  stores.push(store)
  const matter = store.createMatter(
    { name: "Unified answer", jurisdiction: "9th Cir.", researchAsOf: "2026-08-23", confidentiality: "privileged" },
    "mat_answer",
  )
  const passage = await new SourceMaterializer(store).captureText({
    matterId: matter.id,
    title: "Synthetic authority",
    text: "Qualified immunity is denied when controlling precedent clearly establishes the asserted right.",
    origin: "fixture:answer",
    kind: "upload",
  })
  const retrieval = new RetrievalEngine(store).search({
    matterId: matter.id,
    query: "qualified immunity controlling precedent",
  })
  return { store, matter, passage, retrieval, finalizer: new AnswerFinalizer(store) }
}

describe("matter-owned answer finalization", () => {
  test("ANS-01 links retrieval, claim, citation, ledger, and export in one database", async () => {
    const { matter, passage, retrieval, finalizer } = await fixture()
    const text = "Qualified immunity may be denied when controlling precedent clearly establishes the asserted right."
    const messageId = finalizer.create({
      matterId: matter.id,
      question: "When is qualified immunity denied?",
      text,
      retrievalRunIds: [retrieval.retrievalRunId],
      threadId: "thr_subscription",
    })
    const result = finalizer.finalize(messageId, [
      { start: 0, end: text.length, evidence: [{ passageId: passage.passageId, relationship: "supports" }] },
    ])
    expect(result.sourceComplete).toBe(true)
    expect(finalizer.view(messageId)).toMatchObject({
      matterId: matter.id,
      threadId: "thr_subscription",
      sourceComplete: true,
      citations: [{ status: "supported", evidence: [{ passageId: passage.passageId, available: true }] }],
    })
    const receipt = finalizer.receipt(messageId)
    expect(receipt.ledger.map((entry) => entry.disposition).sort()).toEqual(["cited", "read"])
    expect(receipt.matter.retrievalRuns).toHaveLength(1)
  })

  test("ANS-02 fails closed for evidence outside model context or another matter", async () => {
    const { store, matter, retrieval, finalizer } = await fixture()
    const other = store.createMatter(
      { name: "Other", jurisdiction: "2d Cir.", researchAsOf: "2026-08-23", confidentiality: "confidential" },
      "mat_other_answer",
    )
    const outside = await new SourceMaterializer(store).captureText({
      matterId: other.id,
      title: "Other matter authority",
      text: "This passage must not cross matters.",
      origin: "fixture:other",
    })
    const text = "A proposition."
    const messageId = finalizer.create({
      matterId: matter.id,
      question: "Question",
      text,
      retrievalRunIds: [retrieval.retrievalRunId],
    })
    const result = finalizer.finalize(messageId, [
      { start: 0, end: text.length, evidence: [{ passageId: outside.passageId, relationship: "supports" }] },
    ])
    expect(result).toMatchObject({ anchorIds: [], sourceComplete: false })
    expect(finalizer.view(messageId).citations).toEqual([])
  })

  test("ANS-03 application anchors survive restart and model footnote text cannot mint one", async () => {
    const root = await mkdtemp(join(tmpdir(), "legal-answer-restart-"))
    const databasePath = join(root, "research.sqlite")
    const first = await fixture(databasePath)
    const text = "The rule applies.[1]"
    const messageId = first.finalizer.create({
      matterId: first.matter.id,
      question: "Question",
      text,
      retrievalRunIds: [first.retrieval.retrievalRunId],
    })
    first.finalizer.finalize(messageId, [])
    const before = first.finalizer.view(messageId)
    first.store.close()
    stores.splice(stores.indexOf(first.store), 1)

    const reopened = new LegalResearchStore({ databasePath, blobRoot: join(root, "blobs-reopened") })
    stores.push(reopened)
    expect(new AnswerFinalizer(reopened).view(messageId)).toEqual(before)
    expect(before.citations).toEqual([])
  })
})
