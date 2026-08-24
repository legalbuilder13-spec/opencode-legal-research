import { resolve } from "node:path"
import { CitationStore } from "./store"

export const fixtureRoot = resolve(import.meta.dir, "../../legal-evidence-worker")

export async function seedFixtures(store: CitationStore) {
  await store.seedRepresentation({
    slug: "native-opinion",
    title: "Synthetic Court of Appeals Opinion",
    kind: "case",
    sourcePdf: resolve(fixtureRoot, "fixtures/generated/native_legal_opinion.pdf"),
    representationJson: resolve(fixtureRoot, "fixtures/results/native_legal_opinion/adaptive/representation.json"),
  })
  await store.seedRepresentation({
    slug: "scanned-opinion",
    title: "Scanned Synthetic Opinion",
    kind: "case",
    sourcePdf: resolve(fixtureRoot, "fixtures/generated/scanned_legal_opinion.pdf"),
    representationJson: resolve(fixtureRoot, "fixtures/results/scanned_legal_opinion/adaptive/representation.json"),
    quoteState: "ocr-normalized",
  })

  return {
    rule: requiredPassage(store, "A court may grant relief only when the movant establishes each required element."),
    qualification: requiredPassage(store, "The record must be reviewed as a whole, including contrary authority."),
    section1983: requiredPassage(
      store,
      "42 U.S.C. § 1983 supplies a cause of action; it does not create substantive rights.",
    ),
    uncited: requiredPassage(store, "A scanned source remains evidence only when its page location is preserved."),
  }
}

export async function seedDemo(store: CitationStore) {
  const { rule, qualification, section1983, uncited } = await seedFixtures(store)
  const text =
    "A court may grant relief only when the movant establishes each required element. " +
    "Section 1983 supplies a cause of action but does not itself create substantive rights."
  const messageId = store.createMessage(text, "msg_demo")
  store.recordRetrieval(messageId, "relief elements and section 1983", [rule, qualification, section1983, uncited])
  const firstEnd = text.indexOf(". ") + 1
  const secondStart = firstEnd + 1
  store.finalize({
    messageId,
    claims: [
      {
        start: 0,
        end: firstEnd,
        evidence: [
          { passageId: rule, relationship: "supports" },
          { passageId: qualification, relationship: "qualifies" },
        ],
      },
      {
        start: secondStart,
        end: text.length,
        evidence: [{ passageId: section1983, relationship: "supports" }],
      },
    ],
  })
  return { ...store.messageView(messageId), ledger: store.ledger(messageId) }
}

function requiredPassage(store: CitationStore, text: string) {
  const passage = store.findPassageByText(text)
  if (!passage) throw new Error(`Demo passage not found: ${text}`)
  return passage
}
