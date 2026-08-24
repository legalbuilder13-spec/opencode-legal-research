import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { seedFixtures } from "../src/demo"
import { CitationStore, type EvidenceRelationship } from "../src/store"

async function fixtureStore() {
  const store = new CitationStore()
  return { store, passages: await seedFixtures(store) }
}

function oneClaim(
  store: CitationStore,
  text: string,
  evidence: Array<{ passageId: string; relationship: EvidenceRelationship }>,
) {
  const messageId = store.createMessage(text)
  store.recordRetrieval(
    messageId,
    "deterministic fixture query",
    evidence.map((item) => item.passageId),
  )
  return {
    messageId,
    result: store.finalize({ messageId, claims: [{ start: 0, end: text.length, evidence }] }),
  }
}

describe("citation finalization protocol", () => {
  test("CT-01 mints one anchor that resolves to persisted text and coordinates", async () => {
    const { store, passages } = await fixtureStore()
    const { messageId, result } = oneClaim(store, "The movant must establish every element.", [
      { passageId: passages.rule, relationship: "supports" },
    ])

    expect(result.anchors).toHaveLength(1)
    const citation = store.messageView(messageId).citations[0]
    expect(citation.status).toBe("supported")
    expect(citation.evidence[0]).toMatchObject({
      passageId: passages.rule,
      locationMode: "coordinates",
      verificationState: "verified",
    })
    expect(citation.evidence[0].text).toContain("each required element")
    expect(citation.evidence[0].bbox).not.toBeNull()
    store.close()
  })

  test("CT-02 preserves multiple sources for one claim", async () => {
    const { store, passages } = await fixtureStore()
    const { messageId } = oneClaim(store, "The complete record controls the inquiry.", [
      { passageId: passages.rule, relationship: "supports" },
      { passageId: passages.qualification, relationship: "supports" },
    ])

    const evidence = store.messageView(messageId).citations[0].evidence
    expect(evidence).toHaveLength(2)
    expect(new Set(evidence.map((item) => item.sourceTitle)).size).toBe(2)
    store.close()
  })

  test("CT-03 qualification is distinct and controls aggregate status", async () => {
    const { store, passages } = await fixtureStore()
    const { messageId } = oneClaim(store, "Relief requires every element after review of the whole record.", [
      { passageId: passages.rule, relationship: "supports" },
      { passageId: passages.qualification, relationship: "qualifies" },
    ])

    const citation = store.messageView(messageId).citations[0]
    expect(citation.status).toBe("qualified")
    expect(citation.evidence.map((item) => item.relationship)).toEqual(["supports", "qualifies"])
    store.close()
  })

  test("CT-04 contradiction prevents ordinary verified status", async () => {
    const { store, passages } = await fixtureStore()
    const { messageId, result } = oneClaim(store, "The record need not include contrary authority.", [
      { passageId: passages.qualification, relationship: "contradicts" },
    ])

    expect(result.sourceComplete).toBe(false)
    expect(store.messageView(messageId).citations[0].status).toBe("contradicted")
    store.close()
  })

  test("CT-05 model-written Markdown cannot mint a citation", async () => {
    const { store } = await fixtureStore()
    const messageId = store.createMessage("A fabricated proposition.[^999]")
    const result = store.finalize({ messageId, claims: [] })

    expect(result.anchors).toEqual([])
    expect(result.sourceComplete).toBe(false)
    expect(store.messageView(messageId).text).toContain("[^999]")
    store.close()
  })

  test("CT-06 unknown passage fails closed and records verification", async () => {
    const { store } = await fixtureStore()
    const text = "An unsupported proposition."
    const messageId = store.createMessage(text)
    const result = store.finalize({
      messageId,
      claims: [
        {
          start: 0,
          end: text.length,
          evidence: [{ passageId: "psg_model_invented", relationship: "supports" }],
        },
      ],
    })

    expect(result.anchors).toEqual([])
    expect(store.claims(messageId)[0].status).toBe("unverified")
    expect(store.verificationResults(messageId)[0]).toMatchObject({
      passage_id: null,
      check_kind: "identity",
      status: "unverified",
    })
    store.close()
  })

  test("CT-07 changed passage hash cannot silently retarget citation", async () => {
    const { store, passages } = await fixtureStore()
    store.corruptPassageForTest(passages.rule, "mutated text")
    const { messageId, result } = oneClaim(store, "The rule applies.", [
      { passageId: passages.rule, relationship: "supports" },
    ])

    expect(result.anchors).toEqual([])
    expect(store.verificationResults(messageId)[0]).toMatchObject({ check_kind: "integrity", status: "unverified" })
    store.close()
  })

  test("CT-08 invalid and overlapping answer offsets fail closed", async () => {
    const { store, passages } = await fixtureStore()
    const messageId = store.createMessage("First claim. Second claim.")
    const finalize = () =>
      store.finalize({
        messageId,
        claims: [
          { start: 0, end: 14, evidence: [{ passageId: passages.rule, relationship: "supports" }] },
          { start: 10, end: 25, evidence: [{ passageId: passages.rule, relationship: "supports" }] },
        ],
      })

    expect(finalize).toThrow("Claim offsets overlap")
    expect(store.messageView(messageId).status).toBe("provisional")
    store.close()
  })

  test("CT-09 interrupted streams never finalize citations", async () => {
    const { store, passages } = await fixtureStore()
    const messageId = store.createMessage("Provisional answer [1]")
    store.interruptMessage(messageId)

    expect(() =>
      store.finalize({
        messageId,
        claims: [
          {
            start: 0,
            end: 18,
            evidence: [{ passageId: passages.rule, relationship: "supports" }],
          },
        ],
      }),
    ).toThrow("Message is not provisional")
    expect(store.messageView(messageId)).toMatchObject({ status: "interrupted", citations: [] })
    store.close()
  })

  test("CT-10 duplicate visible text navigates by passage-region identity", async () => {
    const { store, passages } = await fixtureStore()
    const original = store.db
      .query<
        { representation_id: string; text: string; text_sha256: string },
        [string]
      >("SELECT representation_id, text, text_sha256 FROM passage WHERE id = ?")
      .get(passages.rule)!
    const duplicateId = "psg_duplicate_page_two"
    store.db
      .query(
        "INSERT INTO passage (id, representation_id, source_ref, order_index, text, text_sha256) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(duplicateId, original.representation_id, "#/duplicate", 999, original.text, original.text_sha256)
    store.db
      .query(
        "INSERT INTO passage_region (id, passage_id, page_number, page_width, page_height, origin, left, top, right, bottom, image_path) SELECT ?, ?, 2, page_width, page_height, origin, left, top, right, bottom, image_path FROM passage_region WHERE passage_id = ? LIMIT 1",
      )
      .run("reg_duplicate_page_two", duplicateId, passages.rule)

    const { messageId } = oneClaim(store, "The duplicated rule applies here.", [
      { passageId: duplicateId, relationship: "supports" },
    ])
    expect(store.messageView(messageId).citations[0].evidence[0]).toMatchObject({
      passageId: duplicateId,
      pageNumber: 2,
    })
    store.close()
  })

  test("CT-11 OCR-normalized text is explicitly labeled and remains navigable", async () => {
    const { store, passages } = await fixtureStore()
    const { messageId } = oneClaim(store, "The whole record must be considered.", [
      { passageId: passages.qualification, relationship: "supports" },
    ])
    expect(store.messageView(messageId).citations[0].evidence[0]).toMatchObject({
      verificationState: "ocr-normalized",
      locationMode: "coordinates",
    })
    store.close()
  })

  test("CT-12 coordinate-free sources retain a visible structural fallback", async () => {
    const { store, passages } = await fixtureStore()
    store.db.query("DELETE FROM passage_region WHERE passage_id = ?").run(passages.rule)
    const { messageId } = oneClaim(store, "The rule applies.", [{ passageId: passages.rule, relationship: "supports" }])
    expect(store.messageView(messageId).citations[0].evidence[0]).toMatchObject({
      locationMode: "structural-fallback",
      imageUrl: null,
      bbox: null,
    })
    store.close()
  })

  test("CT-13 finalized citation identity survives database restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "legal-citation-restart-"))
    const filename = join(directory, "citation.sqlite")
    const first = new CitationStore(filename)
    const passages = await seedFixtures(first)
    const { messageId } = oneClaim(first, "The rule applies after restart.", [
      { passageId: passages.rule, relationship: "supports" },
    ])
    const before = first.messageView(messageId)
    first.close()

    const reopened = new CitationStore(filename)
    expect(reopened.messageView(messageId)).toEqual(before)
    reopened.close()
  })

  test("CT-14 deleting a referenced source makes its citation unavailable", async () => {
    const { store, passages } = await fixtureStore()
    const { messageId } = oneClaim(store, "The rule applies.", [{ passageId: passages.rule, relationship: "supports" }])
    const citation = store.messageView(messageId).citations[0]
    store.deleteSourceVersion(citation.evidence[0].sourceVersionId)

    expect(store.resolveCitation(citation.citationId)?.evidence[0]).toMatchObject({
      available: false,
      verificationState: "unavailable",
      text: null,
      imageUrl: null,
    })
    store.close()
  })

  test("CT-15 uncited model context remains in the sources-read ledger", async () => {
    const { store, passages } = await fixtureStore()
    const messageId = store.createMessage("The rule applies.")
    store.recordRetrieval(messageId, "rule and possible exception", [passages.rule, passages.uncited])
    store.finalize({
      messageId,
      claims: [
        {
          start: 0,
          end: 17,
          evidence: [{ passageId: passages.rule, relationship: "supports" }],
        },
      ],
    })

    expect(store.ledger(messageId).filter((entry) => entry.passage_id === passages.uncited)).toEqual([
      { passage_id: passages.uncited, disposition: "read" },
    ])
    store.close()
  })

  test("CT-16 a material claim without evidence blocks source-complete", async () => {
    const { store } = await fixtureStore()
    const { messageId, result } = oneClaim(store, "This proposition lacks evidence.", [])

    expect(result.sourceComplete).toBe(false)
    expect(store.claims(messageId)[0]).toMatchObject({ material: 1, status: "unverified" })
    expect(store.messageView(messageId).citations).toEqual([])
    store.close()
  })
})
