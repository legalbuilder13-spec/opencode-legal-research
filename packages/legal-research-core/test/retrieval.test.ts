import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LegalResearchStore, ResearchPlanner, RetrievalEngine, hashText, type LegalMetadataInput } from "../src"

const stores: LegalResearchStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "legal-retrieval-"))
  const store = new LegalResearchStore({ blobRoot: join(root, "blobs") })
  stores.push(store)
  const matter = store.createMatter(
    {
      name: "Federal immunity research",
      jurisdiction: "9th Cir.",
      researchAsOf: "2026-08-23",
      confidentiality: "confidential",
    },
    "mat_retrieval",
  )
  return { store, matter, engine: new RetrievalEngine(store), planner: new ResearchPlanner(store) }
}

async function addSource(
  store: LegalResearchStore,
  matterId: string,
  title: string,
  passages: string[],
  metadata: Omit<LegalMetadataInput, "sourceVersionId">,
) {
  const text = passages.join("\n")
  const source = await store.materialize({
    matterId,
    title,
    kind: metadata.authorityType === "web" ? "web" : "courtlistener",
    mime: "text/plain",
    bytes: new TextEncoder().encode(text),
    origin: `fixture:${title}`,
  })
  store.addRepresentation({
    sourceVersionId: source.sourceVersionId,
    parserName: "retrieval-fixture",
    parserVersion: "1",
    mode: "structural",
    normalizedTextSha256: hashText(text),
    passages: passages.map((passage, index) => ({
      sourceRef: `#/paragraphs/${index}`,
      order: index,
      text: passage,
      sectionPath: `paragraph ${index + 1}`,
    })),
  })
  store.setLegalMetadata({ sourceVersionId: source.sourceVersionId, ...metadata })
  return {
    sourceVersionId: source.sourceVersionId,
    passageIds: store
      .passagesForMatter(matterId)
      .filter((passage) => passage.source_version_id === source.sourceVersionId)
      .map((passage) => passage.id),
  }
}

describe("local hybrid legal retrieval", () => {
  test("RET-01 combines FTS5 with local semantic scoring and no embedding credential", async () => {
    const { store, matter, engine } = await fixture()
    const authority = await addSource(
      store,
      matter.id,
      "Published immunity opinion",
      ["Qualified immunity protects government officials when the asserted right was not clearly established."],
      {
        authorityType: "case",
        jurisdiction: "9th Cir.",
        court: "9th Cir.",
        decisionDate: "2025-01-10",
        precedentialStatus: "published",
        citation: "999 F.4th 10",
      },
    )
    await addSource(store, matter.id, "Unrelated contract", ["A contract requires offer and acceptance."], {
      authorityType: "case",
      jurisdiction: "9th Cir.",
    })

    const previous = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      const result = engine.search({ matterId: matter.id, query: "protection for public officers", limit: 1 })
      expect(result.results[0]?.passageId).toBe(authority.passageIds[0])
      expect(result.results[0]?.scores.semanticRank).toBe(1)
    } finally {
      if (previous) process.env.OPENAI_API_KEY = previous
    }
  })

  test("RET-02 applies jurisdiction, court, date, type, and precedential filters deterministically", async () => {
    const { store, matter, engine } = await fixture()
    const ninth = await addSource(
      store,
      matter.id,
      "Ninth Circuit rule",
      ["The clearly established inquiry is specific."],
      {
        authorityType: "case",
        jurisdiction: "9th Cir.",
        court: "9th Cir.",
        decisionDate: "2024-05-01",
        precedentialStatus: "published",
      },
    )
    await addSource(store, matter.id, "Second Circuit rule", ["The clearly established inquiry is specific."], {
      authorityType: "case",
      jurisdiction: "2d Cir.",
      court: "2d Cir.",
      decisionDate: "2018-05-01",
      precedentialStatus: "unpublished",
    })

    const result = engine.search({
      matterId: matter.id,
      query: "clearly established inquiry",
      filters: {
        jurisdiction: "9th Cir.",
        court: "9th Cir.",
        dateFrom: "2020-01-01",
        dateTo: "2026-08-23",
        authorityTypes: ["case"],
        precedentialStatuses: ["published"],
      },
    })
    expect(result.results.map((item) => item.passageId)).toEqual(ninth.passageIds)
  })

  test("RET-03 logs candidates, ranks, selected passages, neighbors, and model context", async () => {
    const { store, matter, engine } = await fixture()
    const source = await addSource(
      store,
      matter.id,
      "Three-part opinion",
      [
        "Background facts describe a traffic stop.",
        "Qualified immunity turns on clearly established law.",
        "The court therefore affirms the judgment.",
      ],
      { authorityType: "case", jurisdiction: "9th Cir.", precedentialStatus: "published" },
    )
    const result = engine.search({
      matterId: matter.id,
      query: "qualified immunity clearly established",
      limit: 1,
      neighborRadius: 1,
    })
    const log = engine.log(result.retrievalRunId)

    expect(result.results[0]?.passageId).toBe(source.passageIds[1])
    expect(result.context.map((item) => item.passageId)).toEqual(source.passageIds)
    expect(log.filter((item) => item.sent_to_model)).toHaveLength(3)
    expect(log.filter((item) => item.selected)).toHaveLength(1)
    expect(log.some((item) => item.lexical_rank !== null && item.semantic_rank !== null)).toBe(true)
  })

  test("RET-04 diversity limits prevent one authority from occupying all results", async () => {
    const { store, matter, engine } = await fixture()
    await addSource(
      store,
      matter.id,
      "Long immunity opinion",
      [
        "Qualified immunity requires a clearly established right.",
        "Qualified immunity is evaluated at a specific level.",
        "Clearly established law requires controlling authority.",
      ],
      { authorityType: "case", jurisdiction: "9th Cir." },
    )
    await addSource(
      store,
      matter.id,
      "Second immunity opinion",
      ["Qualified immunity can be denied on clear precedent."],
      {
        authorityType: "case",
        jurisdiction: "9th Cir.",
      },
    )

    const result = engine.search({
      matterId: matter.id,
      query: "qualified immunity clearly established",
      limit: 2,
      maxPerSource: 1,
      neighborRadius: 0,
    })
    expect(new Set(result.results.map((item) => item.sourceVersionId)).size).toBe(2)
  })
})

describe("research workflow controls", () => {
  test("RES-01 creates an inspectable issue plan with matter assumptions and adverse lane", async () => {
    const { matter, planner } = await fixture()
    const plan = planner.plan({
      matterId: matter.id,
      question: "Does qualified immunity apply and was the right clearly established?",
      proceduralPosture: "motion for summary judgment",
    })
    expect(plan.assumptions).toEqual({
      jurisdiction: "9th Cir.",
      researchAsOf: "2026-08-23",
      proceduralPosture: "motion for summary judgment",
    })
    expect(plan.issues).toHaveLength(2)
    expect(plan.lanes.map((lane) => lane.kind)).toEqual(["primary", "adverse"])
  })

  test("RES-02 records a secondary-to-primary research chain", async () => {
    const { store, matter, engine } = await fixture()
    const secondary = await addSource(store, matter.id, "Treatise", ["The leading case is Synthetic v. Officer."], {
      authorityType: "secondary",
    })
    const primary = await addSource(
      store,
      matter.id,
      "Synthetic v. Officer",
      ["The court states the governing rule."],
      {
        authorityType: "case",
        jurisdiction: "9th Cir.",
        precedentialStatus: "published",
      },
    )
    const id = engine.recordAuthorityLead({
      matterId: matter.id,
      fromSourceVersionId: secondary.sourceVersionId,
      toSourceVersionId: primary.sourceVersionId,
    })
    expect(
      store.db
        .query<{ relationship: string }, [string]>("SELECT relationship FROM authority_lead WHERE id = ?")
        .get(id),
    ).toEqual({ relationship: "secondary-led-to-primary" })
  })

  test("RES-03 adverse lane boosts limitations and contrary material", async () => {
    const { store, matter, engine } = await fixture()
    const adverse = await addSource(
      store,
      matter.id,
      "Limiting opinion",
      ["A narrow exception limits qualified immunity when controlling precedent clearly prohibits the conduct."],
      { authorityType: "case", jurisdiction: "9th Cir." },
    )
    await addSource(store, matter.id, "General opinion", ["Qualified immunity protects reasonable official conduct."], {
      authorityType: "case",
      jurisdiction: "9th Cir.",
    })

    const result = engine.adverseSearch({ matterId: matter.id, query: "qualified immunity", limit: 1 })
    expect(result.results[0]?.passageId).toBe(adverse.passageIds[0])
    expect(result.lane).toBe("adverse")
  })

  test("RES-04 search snippets remain ineligible to support verified claims", async () => {
    const { store, matter, engine } = await fixture()
    const snippet = await addSource(
      store,
      matter.id,
      "Search result snippet",
      ["A snippet mentions qualified immunity."],
      {
        authorityType: "web",
        fullSource: false,
      },
    )
    const result = engine.search({ matterId: matter.id, query: "qualified immunity", limit: 1 })
    expect(result.results[0]).toMatchObject({ passageId: snippet.passageIds[0], supportEligible: false })
  })

  test("retrieval remains strictly matter-scoped", async () => {
    const { store, matter, engine } = await fixture()
    await addSource(store, matter.id, "Visible authority", ["Qualified immunity visible passage."], {
      authorityType: "case",
    })
    const other = store.createMatter(
      {
        name: "Other",
        jurisdiction: "2d Cir.",
        researchAsOf: "2026-08-23",
        confidentiality: "confidential",
      },
      "mat_retrieval_other",
    )
    await addSource(store, other.id, "Hidden authority", ["Unique hidden phrase qualified immunity."], {
      authorityType: "case",
    })

    const result = engine.search({ matterId: matter.id, query: "unique hidden phrase", limit: 5 })
    expect(result.results.every((item) => !item.text.includes("Unique hidden"))).toBe(true)
  })
})
