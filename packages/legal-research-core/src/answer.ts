import { randomUUID } from "node:crypto"
import { hashText } from "./blob-store"
import { LegalResearchStore } from "./store"

export type AnswerRelationship = "supports" | "qualifies" | "contradicts"
export type AnswerClaimStatus = "supported" | "qualified" | "contradicted" | "unverified"

export interface AnswerClaimSelection {
  start: number
  end: number
  material?: boolean
  evidence: Array<{ passageId: string; relationship: AnswerRelationship }>
}

interface MessageRow {
  id: string
  matter_id: string
  question: string
  text: string
  status: "provisional" | "finalized" | "interrupted"
  source_complete: number
  thread_id: string | null
  retrieval_run_ids_json: string
}

interface AnchorRow {
  id: string
  footnote_number: number
  claim_id: string
  claim_text: string
  start_offset: number
  end_offset: number
  claim_status: AnswerClaimStatus
}

interface EvidenceRow {
  passage_id: string
  relationship: AnswerRelationship
  source_title: string
  source_version_id: string
  text: string
  text_sha256: string
  deleted_at: string | null
  capture_status: string
  page_number: number | null
  page_width: number | null
  page_height: number | null
  left: number | null
  top: number | null
  right: number | null
  bottom: number | null
  image_blob_sha256: string | null
}

export class AnswerFinalizer {
  constructor(readonly store: LegalResearchStore) {
    this.migrate()
  }

  create(input: {
    matterId: string
    question: string
    text: string
    retrievalRunIds: string[]
    threadId?: string
    id?: string
  }) {
    const matter = this.store.matter(input.matterId)
    if (matter.status !== "active") throw new Error(`Matter is not active: ${matter.status}`)
    const runIds = [...new Set(input.retrievalRunIds)]
    if (!runIds.length) throw new Error("An answer requires at least one retrieval run")
    for (const runId of runIds) {
      const run = this.store.db
        .query<{ matter_id: string }, [string]>("SELECT matter_id FROM retrieval_run WHERE id = ?")
        .get(runId)
      if (!run || run.matter_id !== input.matterId) throw new Error(`Retrieval run is unavailable for matter: ${runId}`)
    }
    const id = input.id ?? `ans_${randomUUID()}`
    const now = new Date().toISOString()
    const write = this.store.db.transaction(() => {
      this.store.db
        .query(
          `INSERT INTO answer_message
            (id, matter_id, question, text, status, source_complete, thread_id, retrieval_run_ids_json, created_at)
          VALUES (?, ?, ?, ?, 'provisional', 0, ?, ?, ?)`,
        )
        .run(
          id,
          input.matterId,
          required(input.question, "question"),
          input.text,
          input.threadId ?? null,
          JSON.stringify(runIds),
          now,
        )
      for (const runId of runIds) {
        const passages = this.store.db
          .query<
            { passage_id: string },
            [string]
          >("SELECT passage_id FROM retrieval_candidate WHERE retrieval_run_id = ? AND sent_to_model = 1 ORDER BY rerank_score DESC, passage_id")
          .all(runId)
        for (const passage of passages) {
          this.store.db
            .query(
              `INSERT OR IGNORE INTO answer_ledger
                (id, message_id, passage_id, retrieval_run_id, disposition, created_at)
              VALUES (?, ?, ?, ?, 'read', ?)`,
            )
            .run(`aled_${randomUUID()}`, id, passage.passage_id, runId, now)
        }
      }
    })
    write()
    return id
  }

  interrupt(messageId: string) {
    this.store.db
      .query(
        "UPDATE answer_message SET status = 'interrupted', source_complete = 0 WHERE id = ? AND status = 'provisional'",
      )
      .run(messageId)
  }

  finalize(messageId: string, claims: AnswerClaimSelection[]) {
    const message = this.message(messageId)
    if (message.status !== "provisional") throw new Error(`Answer is not provisional: ${message.status}`)
    validateClaims(message.text, claims)
    const statuses: AnswerClaimStatus[] = []
    const anchorIds: string[] = []
    const write = this.store.db.transaction(() => {
      for (const [index, selection] of claims.entries()) {
        const claimId = `aclm_${hashText(`${message.id}\0${index}\0${selection.start}\0${selection.end}`).slice(0, 24)}`
        const claimText = message.text.slice(selection.start, selection.end)
        this.store.db
          .query(
            `INSERT INTO answer_claim
              (id, message_id, matter_id, start_offset, end_offset, text, material, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'unverified')`,
          )
          .run(
            claimId,
            message.id,
            message.matter_id,
            selection.start,
            selection.end,
            claimText,
            selection.material === false ? 0 : 1,
          )

        const relationships: AnswerRelationship[] = []
        for (const evidence of selection.evidence) {
          const passage = this.evidencePassage(message.matter_id, evidence.passageId)
          if (!passage) {
            this.verify(
              claimId,
              null,
              "identity",
              "unverified",
              `Passage is unavailable for matter: ${evidence.passageId}`,
            )
            continue
          }
          const wasRead = this.store.db
            .query<
              { present: number },
              [string, string]
            >("SELECT 1 AS present FROM answer_ledger WHERE message_id = ? AND passage_id = ? AND disposition = 'read'")
            .get(message.id, passage.passage_id)
          if (!wasRead) {
            this.verify(
              claimId,
              passage.passage_id,
              "context",
              "unverified",
              "Passage was not admitted to model context",
            )
            continue
          }
          if (passage.deleted_at || passage.capture_status !== "complete") {
            this.verify(
              claimId,
              passage.passage_id,
              "availability",
              "unverified",
              "Source is unavailable or incomplete",
            )
            continue
          }
          if (hashText(passage.text) !== passage.text_sha256) {
            this.verify(claimId, passage.passage_id, "integrity", "unverified", "Passage text hash mismatch")
            continue
          }
          this.store.db
            .query("INSERT INTO answer_claim_evidence (id, claim_id, passage_id, relationship) VALUES (?, ?, ?, ?)")
            .run(`acev_${randomUUID()}`, claimId, passage.passage_id, evidence.relationship)
          this.verify(claimId, passage.passage_id, "integrity", "passed", "Passage ownership and text hash verified")
          this.store.db
            .query(
              `INSERT OR IGNORE INTO answer_ledger
                (id, message_id, passage_id, retrieval_run_id, disposition, created_at)
              VALUES (?, ?, ?, NULL, 'cited', ?)`,
            )
            .run(`aled_${randomUUID()}`, message.id, passage.passage_id, new Date().toISOString())
          relationships.push(evidence.relationship)
        }
        const status = claimStatus(relationships)
        statuses.push(status)
        this.store.db.query("UPDATE answer_claim SET status = ? WHERE id = ?").run(status, claimId)
        if (relationships.length) {
          const anchorId = `acite_${hashText(claimId).slice(0, 24)}`
          this.store.db
            .query("INSERT INTO answer_citation (id, claim_id, footnote_number) VALUES (?, ?, ?)")
            .run(anchorId, claimId, anchorIds.length + 1)
          anchorIds.push(anchorId)
        }
      }
      const sourceComplete =
        claims.length > 0 && statuses.every((status) => status === "supported" || status === "qualified")
      this.store.db
        .query("UPDATE answer_message SET status = 'finalized', source_complete = ? WHERE id = ?")
        .run(sourceComplete ? 1 : 0, message.id)
    })
    write()
    return { messageId, anchorIds, sourceComplete: this.message(messageId).source_complete === 1 }
  }

  view(messageId: string) {
    const message = this.message(messageId)
    const citations = this.store.db
      .query<AnchorRow, [string]>(
        `SELECT answer_citation.id, answer_citation.footnote_number, answer_claim.id AS claim_id,
          answer_claim.text AS claim_text, answer_claim.start_offset, answer_claim.end_offset,
          answer_claim.status AS claim_status
        FROM answer_citation JOIN answer_claim ON answer_claim.id = answer_citation.claim_id
        WHERE answer_claim.message_id = ? ORDER BY answer_claim.start_offset`,
      )
      .all(messageId)
      .map((row) => this.citation(row))
    const ledger = this.store.db
      .query<
        { passage_id: string; retrieval_run_id: string | null; disposition: string },
        [string]
      >("SELECT passage_id, retrieval_run_id, disposition FROM answer_ledger WHERE message_id = ? ORDER BY created_at, disposition")
      .all(messageId)
    return {
      id: message.id,
      matterId: message.matter_id,
      question: message.question,
      text: message.text,
      status: message.status,
      sourceComplete: Boolean(message.source_complete),
      threadId: message.thread_id,
      retrievalRunIds: jsonStrings(message.retrieval_run_ids_json),
      citations,
      ledger,
    }
  }

  resolve(citationId: string) {
    const anchor = this.store.db
      .query<AnchorRow, [string]>(
        `SELECT answer_citation.id, answer_citation.footnote_number, answer_claim.id AS claim_id,
          answer_claim.text AS claim_text, answer_claim.start_offset, answer_claim.end_offset,
          answer_claim.status AS claim_status
        FROM answer_citation JOIN answer_claim ON answer_claim.id = answer_citation.claim_id
        WHERE answer_citation.id = ?`,
      )
      .get(citationId)
    return anchor ? this.citation(anchor) : null
  }

  list(matterId: string) {
    this.store.matter(matterId)
    return this.store.db
      .query<{ id: string }, [string]>("SELECT id FROM answer_message WHERE matter_id = ? ORDER BY created_at DESC")
      .all(matterId)
      .map((row) => this.view(row.id))
  }

  receipt(messageId: string) {
    const answer = this.view(messageId)
    const matter = this.store.exportMatter(answer.matterId)
    const verification = this.store.db
      .query<{ passage_id: string | null; check_kind: string; status: string; detail: string }, [string]>(
        `SELECT answer_verification.passage_id, answer_verification.check_kind,
          answer_verification.status, answer_verification.detail
        FROM answer_verification JOIN answer_claim ON answer_claim.id = answer_verification.claim_id
        WHERE answer_claim.message_id = ? ORDER BY answer_verification.rowid`,
      )
      .all(messageId)
    return {
      contractVersion: 1,
      exportedAt: new Date().toISOString(),
      answer,
      verification,
      ledger: answer.ledger,
      matter,
    }
  }

  pageAsset(passageId: string) {
    const row = this.store.db
      .query<
        { image_blob_sha256: string | null },
        [string]
      >("SELECT image_blob_sha256 FROM passage_region WHERE passage_id = ? ORDER BY page_number LIMIT 1")
      .get(passageId)
    return row?.image_blob_sha256 ? this.store.blobs.path(row.image_blob_sha256) : null
  }

  private citation(anchor: AnchorRow) {
    const evidence = this.store.db
      .query<EvidenceRow, [string]>(
        `SELECT passage.id AS passage_id, answer_claim_evidence.relationship, source.title AS source_title,
          source_version.id AS source_version_id, passage.text, passage.text_sha256,
          source_version.deleted_at, source_version.capture_status,
          passage_region.page_number, passage_region.page_width, passage_region.page_height,
          passage_region.left, passage_region.top, passage_region.right, passage_region.bottom,
          passage_region.image_blob_sha256
        FROM answer_claim_evidence
        JOIN passage ON passage.id = answer_claim_evidence.passage_id
        JOIN source_version ON source_version.id = passage.source_version_id
        JOIN source ON source.id = source_version.source_id
        LEFT JOIN passage_region ON passage_region.passage_id = passage.id
        WHERE answer_claim_evidence.claim_id = ? ORDER BY answer_claim_evidence.rowid, passage_region.page_number`,
      )
      .all(anchor.claim_id)
      .map((row) => {
        const available = !row.deleted_at && row.capture_status === "complete" && hashText(row.text) === row.text_sha256
        const hasCoordinates =
          row.page_number !== null &&
          row.page_width !== null &&
          row.page_height !== null &&
          row.left !== null &&
          row.top !== null &&
          row.right !== null &&
          row.bottom !== null
        return {
          passageId: row.passage_id,
          relationship: row.relationship,
          sourceTitle: row.source_title,
          sourceVersionId: row.source_version_id,
          text: available ? row.text : null,
          textSha256: row.text_sha256,
          available,
          verificationState: available ? "verified" : "unavailable",
          locationMode: hasCoordinates ? "coordinates" : "structural-fallback",
          pageNumber: row.page_number,
          pageWidth: row.page_width,
          pageHeight: row.page_height,
          bbox: hasCoordinates ? { left: row.left, top: row.top, right: row.right, bottom: row.bottom } : null,
          imageUrl:
            available && hasCoordinates && row.image_blob_sha256 ? `/assets/matter-page/${row.passage_id}` : null,
        }
      })
    return {
      citationId: anchor.id,
      footnoteNumber: anchor.footnote_number,
      claimId: anchor.claim_id,
      claimText: anchor.claim_text,
      claimStart: anchor.start_offset,
      claimEnd: anchor.end_offset,
      status: anchor.claim_status,
      evidence,
    }
  }

  private evidencePassage(matterId: string, passageId: string) {
    return (
      this.store.db
        .query<
          {
            passage_id: string
            text: string
            text_sha256: string
            deleted_at: string | null
            capture_status: string
          },
          [string, string]
        >(
          `SELECT passage.id AS passage_id, passage.text, passage.text_sha256,
            source_version.deleted_at, source_version.capture_status
          FROM passage JOIN source_version ON source_version.id = passage.source_version_id
          WHERE passage.id = ? AND passage.matter_id = ?`,
        )
        .get(passageId, matterId) ?? null
    )
  }

  private message(id: string) {
    const row = this.store.db
      .query<MessageRow, [string]>(
        `SELECT id, matter_id, question, text, status, source_complete, thread_id, retrieval_run_ids_json
        FROM answer_message WHERE id = ?`,
      )
      .get(id)
    if (!row) throw new Error(`Unknown answer: ${id}`)
    return row
  }

  private verify(claimId: string, passageId: string | null, kind: string, status: string, detail: string) {
    this.store.db
      .query(
        "INSERT INTO answer_verification (id, claim_id, passage_id, check_kind, status, detail) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(`aver_${randomUUID()}`, claimId, passageId, kind, status, detail)
  }

  private migrate() {
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS answer_message (
        id TEXT PRIMARY KEY,
        matter_id TEXT NOT NULL REFERENCES matter(id),
        question TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL,
        source_complete INTEGER NOT NULL DEFAULT 0,
        thread_id TEXT,
        retrieval_run_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS answer_claim (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES answer_message(id),
        matter_id TEXT NOT NULL REFERENCES matter(id),
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        text TEXT NOT NULL,
        material INTEGER NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS answer_claim_evidence (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL REFERENCES answer_claim(id),
        passage_id TEXT NOT NULL REFERENCES passage(id),
        relationship TEXT NOT NULL,
        UNIQUE(claim_id, passage_id, relationship)
      );
      CREATE TABLE IF NOT EXISTS answer_citation (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL UNIQUE REFERENCES answer_claim(id),
        footnote_number INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS answer_verification (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL REFERENCES answer_claim(id),
        passage_id TEXT,
        check_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS answer_ledger (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES answer_message(id),
        passage_id TEXT NOT NULL REFERENCES passage(id),
        retrieval_run_id TEXT REFERENCES retrieval_run(id),
        disposition TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(message_id, passage_id, disposition)
      );
    `)
  }
}

function validateClaims(text: string, claims: AnswerClaimSelection[]) {
  const ordered = [...claims].sort((left, right) => left.start - right.start)
  for (const [index, claim] of ordered.entries()) {
    if (!Number.isInteger(claim.start) || !Number.isInteger(claim.end))
      throw new Error("Claim offsets must be integers")
    if (claim.start < 0 || claim.end <= claim.start || claim.end > text.length) throw new Error("Invalid claim offsets")
    const previous = ordered[index - 1]
    if (previous && previous.end > claim.start) throw new Error("Claim offsets overlap")
  }
}

function claimStatus(relationships: AnswerRelationship[]): AnswerClaimStatus {
  if (relationships.includes("contradicts")) return "contradicted"
  if (relationships.includes("qualifies")) return "qualified"
  if (relationships.includes("supports")) return "supported"
  return "unverified"
}

function required(value: string, name: string) {
  if (!value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

function jsonStrings(value: string) {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string"))
    throw new Error("Invalid retrieval run IDs")
  return parsed
}
