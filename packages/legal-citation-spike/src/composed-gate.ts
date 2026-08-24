import { connect } from "@legalbuilder/codex-app-server-spike"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { seedFixtures } from "./demo"
import { CitationStore, type ClaimSelection, type EvidenceRelationship } from "./store"

interface ModelEnvelope {
  answer: string
  claims: ClaimSelection[]
}

const mode = Bun.argv.includes("--live") ? "live" : "fixture"
const outputArgument = Bun.argv.indexOf("--output")
const outputDir = resolve(
  outputArgument >= 0 ? (Bun.argv[outputArgument + 1] ?? "fixtures/composed/results") : "fixtures/composed/results",
)
await mkdir(outputDir, { recursive: true })

const databasePath = resolve(outputDir, `composed-${mode}.sqlite`)
const store = new CitationStore(databasePath)
const passages = await seedFixtures(store)
const knownPassages = new Set(Object.values(passages))
const account =
  mode === "live" ? await liveEnvelope() : { planType: "deterministic-fixture", envelope: fixtureEnvelope() }

const messageId = store.createMessage(account.envelope.answer, `msg_composed_${mode}`)
store.recordRetrieval(messageId, "relief elements, limitations, and Section 1983", [
  passages.rule,
  passages.qualification,
  passages.section1983,
  passages.uncited,
])
const finalized = store.finalize({ messageId, claims: account.envelope.claims })
const beforeRestart = store.messageView(messageId)
store.close()

const reopened = new CitationStore(databasePath)
const afterRestart = reopened.messageView(messageId)
if (JSON.stringify(beforeRestart) !== JSON.stringify(afterRestart)) throw new Error("Restart changed the citation view")
const receipt = reopened.exportReceipt(messageId, "2026-08-23")
await Bun.write(resolve(outputDir, `receipt-${mode}.json`), `${JSON.stringify(receipt, null, 2)}\n`)
await Bun.write(
  resolve(outputDir, `summary-${mode}.json`),
  `${JSON.stringify(
    {
      mode,
      subscriptionPlan: account.planType,
      sourceComplete: finalized.sourceComplete,
      citationCount: beforeRestart.citations.length,
      evidenceCount: beforeRestart.citations.reduce((total, citation) => total + citation.evidence.length, 0),
      ledgerPassageCount: new Set(receipt.sourcesRead.map((entry) => entry.passage_id)).size,
      restartStable: true,
      receipt: `receipt-${mode}.json`,
    },
    null,
    2,
  )}\n`,
)
reopened.close()
console.log(JSON.stringify({ mode, planType: account.planType, finalized, receipt: `receipt-${mode}.json` }, null, 2))

async function liveEnvelope() {
  const client = await connect({ cwd: process.cwd(), notificationTimeoutMs: 180_000 })
  try {
    const state = await client.account()
    if (!state.account || state.account.type !== "chatgpt")
      throw new Error("Live gate requires ChatGPT subscription auth")
    const thread = await client.startThread({ cwd: process.cwd() })
    const turn = await client.runTurn(thread.threadId, prompt())
    if (turn.status !== "completed") throw new Error(`Live composed turn ended as ${turn.status}`)
    return { planType: state.account.planType, envelope: parseEnvelope(turn.text) }
  } finally {
    await client.close()
  }
}

function fixtureEnvelope(): ModelEnvelope {
  const answer =
    "A court may grant relief only when the movant establishes each required element. " +
    "Section 1983 supplies a cause of action but does not itself create substantive rights."
  const firstEnd = answer.indexOf(". ") + 1
  return {
    answer,
    claims: [
      {
        start: 0,
        end: firstEnd,
        evidence: [
          { passageId: passages.rule, relationship: "supports" },
          { passageId: passages.qualification, relationship: "qualifies" },
        ],
      },
      {
        start: firstEnd + 1,
        end: answer.length,
        evidence: [{ passageId: passages.section1983, relationship: "supports" }],
      },
    ],
  }
}

function prompt() {
  const expected = fixtureEnvelope()
  return `You are completing a deterministic legal evidence protocol test using synthetic, non-client sources.

Return only one JSON object. Do not use Markdown fences or footnote syntax. The object must have exactly this answer text and two claim objects with UTF-16 start/end offsets into that answer:

${expected.answer}

Available persisted evidence:
- ${passages.rule}: A court may grant relief only when the movant establishes each required element.
- ${passages.qualification}: The record must be reviewed as a whole, including contrary authority.
- ${passages.section1983}: 42 U.S.C. § 1983 supplies a cause of action; it does not create substantive rights.
- ${passages.uncited}: A scanned source remains evidence only when its page location is preserved.

Claim 1 must select ${passages.rule} as supports and ${passages.qualification} as qualifies. Claim 2 must select ${passages.section1983} as supports. Leave the fourth passage uncited. Use this shape:
{"answer":"...","claims":[{"start":0,"end":1,"evidence":[{"passageId":"psg_...","relationship":"supports"}]}]}`
}

function parseEnvelope(text: string): ModelEnvelope {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("Model did not return a JSON object")
  const root = record(JSON.parse(text.slice(start, end + 1)), "model envelope")
  const answer = string(root.answer, "answer")
  const claims = array(root.claims, "claims").map((value, index): ClaimSelection => {
    const claim = record(value, `claims[${index}]`)
    return {
      start: integer(claim.start, `claims[${index}].start`),
      end: integer(claim.end, `claims[${index}].end`),
      evidence: array(claim.evidence, `claims[${index}].evidence`).map((value, evidenceIndex) => {
        const evidence = record(value, `claims[${index}].evidence[${evidenceIndex}]`)
        const passageId = string(evidence.passageId, "passageId")
        if (!knownPassages.has(passageId)) throw new Error(`Model selected unknown passage: ${passageId}`)
        return { passageId, relationship: relationship(evidence.relationship) }
      }),
    }
  })
  const expected = fixtureEnvelope()
  if (answer !== expected.answer) throw new Error("Model changed the deterministic answer text")
  return { answer, claims }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${name}`)
  return Object.fromEntries(Object.entries(value))
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${name}`)
  return value
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`Invalid ${name}`)
  return value
}

function integer(value: unknown, name: string): number {
  if (!Number.isInteger(value)) throw new Error(`Invalid ${name}`)
  return Number(value)
}

function relationship(value: unknown): EvidenceRelationship {
  if (value === "supports" || value === "qualifies" || value === "contradicts") return value
  throw new Error("Invalid evidence relationship")
}
