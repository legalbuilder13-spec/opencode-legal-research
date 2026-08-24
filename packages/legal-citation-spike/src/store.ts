import { Database } from "bun:sqlite"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join, resolve } from "node:path"

export type EvidenceRelationship = "supports" | "qualifies" | "contradicts"
export type ClaimStatus = "supported" | "qualified" | "contradicted" | "unverified"

export interface ClaimSelection {
  start: number
  end: number
  material?: boolean
  evidence: Array<{ passageId: string; relationship: EvidenceRelationship }>
}

export interface FinalizeRequest {
  messageId: string
  claims: ClaimSelection[]
}

export interface CitationEvidence {
  passageId: string
  relationship: EvidenceRelationship
  sourceTitle: string
  sourceVersionId: string
  text: string | null
  textSha256: string
  available: boolean
  verificationState: "verified" | "ocr-normalized" | "unavailable"
  locationMode: "coordinates" | "structural-fallback"
  pageNumber: number | null
  pageWidth: number | null
  pageHeight: number | null
  bbox: { left: number; top: number; right: number; bottom: number } | null
  imageUrl: string | null
}

export interface CitationView {
  citationId: string
  footnoteNumber: number
  claimId: string
  claimText: string
  claimStart: number
  claimEnd: number
  status: ClaimStatus
  evidence: CitationEvidence[]
}

interface MessageRow {
  id: string
  text: string
  status: "provisional" | "finalized" | "interrupted"
  source_complete: number
}

interface PassageRow {
  id: string
  source_version_id: string
  source_title: string
  text: string
  text_sha256: string
  deleted_at: string | null
}

interface AnchorRow {
  id: string
  footnote_number: number
  claim_id: string
  claim_text: string
  start_offset: number
  end_offset: number
  claim_status: ClaimStatus
}

interface EvidenceRow {
  passage_id: string
  relationship: EvidenceRelationship
  source_title: string
  source_version_id: string
  text: string
  text_sha256: string
  deleted_at: string | null
  quote_state: "verified" | "ocr-normalized"
  page_number: number | null
  page_width: number | null
  page_height: number | null
  left: number | null
  top: number | null
  right: number | null
  bottom: number | null
}

interface RegionAssetRow {
  image_path: string
}

export class CitationStore {
  readonly db: Database

  constructor(filename = ":memory:") {
    this.db = new Database(filename, { create: true, strict: true })
    this.db.exec("PRAGMA foreign_keys = ON")
    this.db.exec("PRAGMA journal_mode = WAL")
    this.migrate()
  }

  close() {
    this.db.close()
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS source (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS source_version (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES source(id),
        content_sha256 TEXT NOT NULL,
        blob_path TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS source_representation (
        id TEXT PRIMARY KEY,
        source_version_id TEXT NOT NULL REFERENCES source_version(id),
        normalized_text_sha256 TEXT NOT NULL,
        parser_name TEXT NOT NULL,
        parser_version TEXT NOT NULL,
        mode TEXT NOT NULL,
        quote_state TEXT NOT NULL DEFAULT 'verified'
      );
      CREATE TABLE IF NOT EXISTS passage (
        id TEXT PRIMARY KEY,
        representation_id TEXT NOT NULL REFERENCES source_representation(id),
        source_ref TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        text_sha256 TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS passage_region (
        id TEXT PRIMARY KEY,
        passage_id TEXT NOT NULL REFERENCES passage(id),
        page_number INTEGER NOT NULL,
        page_width REAL NOT NULL,
        page_height REAL NOT NULL,
        origin TEXT NOT NULL,
        left REAL NOT NULL,
        top REAL NOT NULL,
        right REAL NOT NULL,
        bottom REAL NOT NULL,
        image_path TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assistant_message (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        status TEXT NOT NULL,
        source_complete INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS claim (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES assistant_message(id),
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        text TEXT NOT NULL,
        material INTEGER NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS claim_evidence (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL REFERENCES claim(id),
        passage_id TEXT NOT NULL REFERENCES passage(id),
        relationship TEXT NOT NULL,
        UNIQUE(claim_id, passage_id, relationship)
      );
      CREATE TABLE IF NOT EXISTS verification_result (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL REFERENCES claim(id),
        passage_id TEXT,
        check_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS citation_anchor (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL UNIQUE REFERENCES claim(id),
        footnote_number INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS retrieval_event (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES assistant_message(id),
        query TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS retrieval_event_passage (
        retrieval_event_id TEXT NOT NULL REFERENCES retrieval_event(id),
        passage_id TEXT NOT NULL REFERENCES passage(id),
        rank INTEGER NOT NULL,
        PRIMARY KEY(retrieval_event_id, passage_id)
      );
      CREATE TABLE IF NOT EXISTS citation_ledger_entry (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES assistant_message(id),
        passage_id TEXT NOT NULL REFERENCES passage(id),
        retrieval_event_id TEXT REFERENCES retrieval_event(id),
        disposition TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(message_id, passage_id, disposition)
      );
    `)
  }

  async seedRepresentation(input: {
    slug: string
    title: string
    kind: string
    sourcePdf: string
    representationJson: string
    quoteState?: "verified" | "ocr-normalized"
  }) {
    const representationPath = resolve(input.representationJson)
    const representationRoot = dirname(representationPath)
    const result = parseRepresentation(await Bun.file(representationPath).json())
    const sourceId = `src_${input.slug}`
    const sourceVersionId = `srcv_${input.slug}`
    const representationId = `rep_${input.slug}_${result.ocr_mode}`
    const now = new Date().toISOString()
    const insert = this.db.transaction(() => {
      this.db
        .query("INSERT OR IGNORE INTO source (id, title, kind) VALUES (?, ?, ?)")
        .run(sourceId, input.title, input.kind)
      this.db
        .query(
          "INSERT OR IGNORE INTO source_version (id, source_id, content_sha256, blob_path, retrieved_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(sourceVersionId, sourceId, result.source_hash, resolve(input.sourcePdf), now)
      this.db
        .query(
          "INSERT OR IGNORE INTO source_representation (id, source_version_id, normalized_text_sha256, parser_name, parser_version, mode, quote_state) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          representationId,
          sourceVersionId,
          result.normalized_text_sha256,
          result.parser_name,
          result.parser_version,
          result.ocr_mode,
          input.quoteState ?? "verified",
        )

      for (const item of result.items) {
        const passageId = `psg_${hash(`${representationId}\0${item.worker_item_id}`).slice(0, 24)}`
        this.db
          .query(
            "INSERT OR IGNORE INTO passage (id, representation_id, source_ref, order_index, text, text_sha256) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(passageId, representationId, item.source_ref, item.order, item.text, item.text_sha256)
        for (const [index, region] of item.regions.entries()) {
          const page = result.pages.find((candidate) => candidate.page_number === region.page_number)
          if (!page) throw new Error(`Missing page record ${region.page_number}`)
          this.db
            .query(
              "INSERT OR IGNORE INTO passage_region (id, passage_id, page_number, page_width, page_height, origin, left, top, right, bottom, image_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              `reg_${hash(`${passageId}\0${index}`).slice(0, 24)}`,
              passageId,
              region.page_number,
              region.page_width,
              region.page_height,
              region.bbox.origin,
              region.bbox.left,
              region.bbox.top,
              region.bbox.right,
              region.bbox.bottom,
              join(representationRoot, page.image_path),
            )
        }
      }
    })
    insert()
    return { sourceId, sourceVersionId, representationId }
  }

  findPassageByText(text: string) {
    return this.db.query<{ id: string }, [string]>("SELECT id FROM passage WHERE text = ?").get(text)?.id ?? null
  }

  createMessage(text: string, id = `msg_${randomUUID()}`) {
    this.db
      .query("INSERT INTO assistant_message (id, text, status, created_at) VALUES (?, ?, 'provisional', ?)")
      .run(id, text, new Date().toISOString())
    return id
  }

  interruptMessage(messageId: string) {
    this.db
      .query(
        "UPDATE assistant_message SET status = 'interrupted', source_complete = 0 WHERE id = ? AND status = 'provisional'",
      )
      .run(messageId)
  }

  recordRetrieval(messageId: string, query: string, passageIds: string[]) {
    const id = `ret_${randomUUID()}`
    const write = this.db.transaction(() => {
      this.db
        .query("INSERT INTO retrieval_event (id, message_id, query, created_at) VALUES (?, ?, ?, ?)")
        .run(id, messageId, query, new Date().toISOString())
      passageIds.forEach((passageId, rank) => {
        this.db
          .query("INSERT INTO retrieval_event_passage (retrieval_event_id, passage_id, rank) VALUES (?, ?, ?)")
          .run(id, passageId, rank + 1)
        this.writeLedger(messageId, passageId, id, "read")
      })
    })
    write()
    return id
  }

  finalize(request: FinalizeRequest) {
    const message = this.message(request.messageId)
    if (message.status !== "provisional") throw new Error(`Message is not provisional: ${message.status}`)
    validateClaims(message.text, request.claims)
    const retrievalId = this.db
      .query<
        { id: string },
        [string]
      >("SELECT id FROM retrieval_event WHERE message_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(message.id)?.id
    const anchors: string[] = []
    const statuses: ClaimStatus[] = []

    const finalize = this.db.transaction(() => {
      for (const [claimIndex, selection] of request.claims.entries()) {
        const claimId = `clm_${hash(`${message.id}\0${claimIndex}\0${selection.start}\0${selection.end}`).slice(0, 24)}`
        const claimText = message.text.slice(selection.start, selection.end)
        this.db
          .query(
            "INSERT INTO claim (id, message_id, start_offset, end_offset, text, material, status) VALUES (?, ?, ?, ?, ?, ?, 'unverified')",
          )
          .run(claimId, message.id, selection.start, selection.end, claimText, selection.material === false ? 0 : 1)

        const validRelationships: EvidenceRelationship[] = []
        for (const evidence of selection.evidence) {
          const passage = this.passage(evidence.passageId)
          if (!passage) {
            this.writeVerification(claimId, null, "identity", "unverified", `Unknown passage: ${evidence.passageId}`)
            continue
          }
          if (passage.deleted_at) {
            this.writeVerification(claimId, passage.id, "availability", "unverified", "Source version is deleted")
            continue
          }
          if (hash(passage.text) !== passage.text_sha256) {
            this.writeVerification(claimId, passage.id, "integrity", "unverified", "Passage text hash mismatch")
            continue
          }
          this.db
            .query("INSERT INTO claim_evidence (id, claim_id, passage_id, relationship) VALUES (?, ?, ?, ?)")
            .run(`cev_${randomUUID()}`, claimId, passage.id, evidence.relationship)
          this.writeVerification(claimId, passage.id, "integrity", "passed", "Passage identity and text hash verified")
          validRelationships.push(evidence.relationship)
          this.writeLedger(message.id, passage.id, retrievalId ?? null, "cited")
        }

        const status = claimStatus(validRelationships)
        statuses.push(status)
        this.db.query("UPDATE claim SET status = ? WHERE id = ?").run(status, claimId)
        if (validRelationships.length) {
          const anchorId = `cite_${hash(claimId).slice(0, 24)}`
          this.db
            .query("INSERT INTO citation_anchor (id, claim_id, footnote_number) VALUES (?, ?, ?)")
            .run(anchorId, claimId, anchors.length + 1)
          anchors.push(anchorId)
        }
      }
      const sourceComplete =
        request.claims.length > 0 && statuses.every((status) => status === "supported" || status === "qualified")
      this.db
        .query("UPDATE assistant_message SET status = 'finalized', source_complete = ? WHERE id = ?")
        .run(sourceComplete ? 1 : 0, message.id)
    })
    finalize()
    return { messageId: message.id, anchors, sourceComplete: this.message(message.id).source_complete === 1 }
  }

  messageView(messageId: string) {
    const message = this.message(messageId)
    const anchors = this.db
      .query<AnchorRow, [string]>(
        `SELECT citation_anchor.id, citation_anchor.footnote_number, claim.id AS claim_id,
          claim.text AS claim_text, claim.start_offset, claim.end_offset, claim.status AS claim_status
        FROM citation_anchor JOIN claim ON claim.id = citation_anchor.claim_id
        WHERE claim.message_id = ? ORDER BY claim.start_offset`,
      )
      .all(messageId)
      .map((anchor) => this.resolveCitationRow(anchor))
    return {
      id: message.id,
      text: message.text,
      status: message.status,
      sourceComplete: message.source_complete === 1,
      citations: anchors,
    }
  }

  resolveCitation(citationId: string) {
    const anchor = this.db
      .query<AnchorRow, [string]>(
        `SELECT citation_anchor.id, citation_anchor.footnote_number, claim.id AS claim_id,
          claim.text AS claim_text, claim.start_offset, claim.end_offset, claim.status AS claim_status
        FROM citation_anchor JOIN claim ON claim.id = citation_anchor.claim_id
        WHERE citation_anchor.id = ?`,
      )
      .get(citationId)
    if (!anchor) return null
    return this.resolveCitationRow(anchor)
  }

  pageAsset(passageId: string) {
    return (
      this.db
        .query<
          RegionAssetRow,
          [string]
        >("SELECT image_path FROM passage_region WHERE passage_id = ? ORDER BY page_number LIMIT 1")
        .get(passageId)?.image_path ?? null
    )
  }

  deleteSourceVersion(sourceVersionId: string) {
    this.db
      .query("UPDATE source_version SET deleted_at = ? WHERE id = ?")
      .run(new Date().toISOString(), sourceVersionId)
  }

  corruptPassageForTest(passageId: string, text: string) {
    this.db.query("UPDATE passage SET text = ? WHERE id = ?").run(text, passageId)
  }

  ledger(messageId: string) {
    return this.db
      .query<
        { passage_id: string; disposition: string },
        [string]
      >("SELECT passage_id, disposition FROM citation_ledger_entry WHERE message_id = ? ORDER BY created_at, disposition")
      .all(messageId)
  }

  claims(messageId: string) {
    return this.db
      .query<
        { id: string; text: string; material: number; status: ClaimStatus },
        [string]
      >("SELECT id, text, material, status FROM claim WHERE message_id = ? ORDER BY start_offset")
      .all(messageId)
  }

  verificationResults(messageId: string) {
    return this.db
      .query<{ passage_id: string | null; check_kind: string; status: string; detail: string }, [string]>(
        `SELECT verification_result.passage_id, verification_result.check_kind,
          verification_result.status, verification_result.detail
        FROM verification_result
        JOIN claim ON claim.id = verification_result.claim_id
        WHERE claim.message_id = ? ORDER BY verification_result.rowid`,
      )
      .all(messageId)
  }

  exportReceipt(messageId: string, asOf: string) {
    const view = this.messageView(messageId)
    const sources = this.db
      .query<
        {
          passage_id: string
          passage_text_sha256: string
          source_title: string
          source_version_id: string
          source_content_sha256: string
          retrieved_at: string
          rank: number
          disposition: string
        },
        [string]
      >(
        `SELECT passage.id AS passage_id, passage.text_sha256 AS passage_text_sha256,
          source.title AS source_title, source_version.id AS source_version_id,
          source_version.content_sha256 AS source_content_sha256, source_version.retrieved_at,
          retrieval_event_passage.rank, citation_ledger_entry.disposition
        FROM citation_ledger_entry
        JOIN passage ON passage.id = citation_ledger_entry.passage_id
        JOIN source_representation ON source_representation.id = passage.representation_id
        JOIN source_version ON source_version.id = source_representation.source_version_id
        JOIN source ON source.id = source_version.source_id
        LEFT JOIN retrieval_event_passage
          ON retrieval_event_passage.retrieval_event_id = citation_ledger_entry.retrieval_event_id
          AND retrieval_event_passage.passage_id = citation_ledger_entry.passage_id
        WHERE citation_ledger_entry.message_id = ?
        ORDER BY retrieval_event_passage.rank, citation_ledger_entry.disposition`,
      )
      .all(messageId)
    const retrieval = this.db
      .query<
        { id: string; query: string; created_at: string },
        [string]
      >("SELECT id, query, created_at FROM retrieval_event WHERE message_id = ? ORDER BY created_at")
      .all(messageId)
    return {
      contractVersion: 1,
      exportedAt: new Date().toISOString(),
      researchAsOf: asOf,
      message: view,
      claims: this.claims(messageId),
      verificationResults: this.verificationResults(messageId),
      retrieval,
      sourcesRead: sources,
    }
  }

  private message(id: string) {
    const row = this.db
      .query<MessageRow, [string]>("SELECT id, text, status, source_complete FROM assistant_message WHERE id = ?")
      .get(id)
    if (!row) throw new Error(`Unknown message: ${id}`)
    return row
  }

  private passage(id: string) {
    return (
      this.db
        .query<PassageRow, [string]>(
          `SELECT passage.id, source_version.id AS source_version_id, source.title AS source_title,
            passage.text, passage.text_sha256, source_version.deleted_at
          FROM passage
          JOIN source_representation ON source_representation.id = passage.representation_id
          JOIN source_version ON source_version.id = source_representation.source_version_id
          JOIN source ON source.id = source_version.source_id
          WHERE passage.id = ?`,
        )
        .get(id) ?? null
    )
  }

  private resolveCitationRow(anchor: AnchorRow): CitationView {
    const evidence = this.db
      .query<EvidenceRow, [string]>(
        `SELECT passage.id AS passage_id, claim_evidence.relationship, source.title AS source_title,
          source_version.id AS source_version_id, passage.text, passage.text_sha256, source_version.deleted_at,
          source_representation.quote_state,
          passage_region.page_number, passage_region.page_width, passage_region.page_height,
          passage_region.left, passage_region.top, passage_region.right, passage_region.bottom
        FROM claim_evidence
        JOIN passage ON passage.id = claim_evidence.passage_id
        LEFT JOIN passage_region ON passage_region.passage_id = passage.id
        JOIN source_representation ON source_representation.id = passage.representation_id
        JOIN source_version ON source_version.id = source_representation.source_version_id
        JOIN source ON source.id = source_version.source_id
        WHERE claim_evidence.claim_id = ? ORDER BY claim_evidence.rowid, passage_region.page_number`,
      )
      .all(anchor.claim_id)
      .map((row): CitationEvidence => {
        const available = row.deleted_at === null
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
          verificationState: available ? row.quote_state : "unavailable",
          locationMode: hasCoordinates ? "coordinates" : "structural-fallback",
          pageNumber: row.page_number,
          pageWidth: row.page_width,
          pageHeight: row.page_height,
          bbox: hasCoordinates ? { left: row.left!, top: row.top!, right: row.right!, bottom: row.bottom! } : null,
          imageUrl: available && hasCoordinates ? `/assets/page/${encodeURIComponent(row.passage_id)}` : null,
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

  private writeVerification(
    claimId: string,
    passageId: string | null,
    checkKind: string,
    status: string,
    detail: string,
  ) {
    this.db
      .query(
        "INSERT INTO verification_result (id, claim_id, passage_id, check_kind, status, detail) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(`ver_${randomUUID()}`, claimId, passageId, checkKind, status, detail)
  }

  private writeLedger(
    messageId: string,
    passageId: string,
    retrievalEventId: string | null,
    disposition: "read" | "cited",
  ) {
    this.db
      .query(
        "INSERT OR IGNORE INTO citation_ledger_entry (id, message_id, passage_id, retrieval_event_id, disposition, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(`led_${randomUUID()}`, messageId, passageId, retrievalEventId, disposition, new Date().toISOString())
  }
}

function validateClaims(text: string, claims: ClaimSelection[]) {
  const ordered = [...claims].sort((left, right) => left.start - right.start)
  for (const [index, claim] of ordered.entries()) {
    if (!Number.isInteger(claim.start) || !Number.isInteger(claim.end))
      throw new Error("Claim offsets must be integers")
    if (claim.start < 0 || claim.end <= claim.start || claim.end > text.length) throw new Error("Invalid claim offsets")
    const previous = ordered[index - 1]
    if (previous && previous.end > claim.start) throw new Error("Claim offsets overlap")
  }
}

function claimStatus(relationships: EvidenceRelationship[]): ClaimStatus {
  if (relationships.includes("contradicts")) return "contradicted"
  if (relationships.includes("qualifies")) return "qualified"
  if (relationships.includes("supports")) return "supported"
  return "unverified"
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

interface WorkerRepresentation {
  source_hash: string
  normalized_text_sha256: string
  parser_name: string
  parser_version: string
  ocr_mode: string
  items: Array<{
    worker_item_id: string
    source_ref: string
    order: number
    text: string
    text_sha256: string
    regions: Array<{
      page_number: number
      page_width: number
      page_height: number
      bbox: { origin: string; left: number; top: number; right: number; bottom: number }
    }>
  }>
  pages: Array<{ page_number: number; image_path: string }>
}

function parseRepresentation(value: unknown): WorkerRepresentation {
  const root = objectValue(value, "worker representation")
  return {
    source_hash: stringValue(root.source_hash, "source_hash"),
    normalized_text_sha256: stringValue(root.normalized_text_sha256, "normalized_text_sha256"),
    parser_name: stringValue(root.parser_name, "parser_name"),
    parser_version: stringValue(root.parser_version, "parser_version"),
    ocr_mode: stringValue(root.ocr_mode, "ocr_mode"),
    items: arrayValue(root.items, "items").map((value, index) => {
      const item = objectValue(value, `items[${index}]`)
      return {
        worker_item_id: stringValue(item.worker_item_id, `items[${index}].worker_item_id`),
        source_ref: stringValue(item.source_ref, `items[${index}].source_ref`),
        order: numberValue(item.order, `items[${index}].order`),
        text: stringValue(item.text, `items[${index}].text`),
        text_sha256: stringValue(item.text_sha256, `items[${index}].text_sha256`),
        regions: arrayValue(item.regions, `items[${index}].regions`).map((value, regionIndex) => {
          const region = objectValue(value, `items[${index}].regions[${regionIndex}]`)
          const bbox = objectValue(region.bbox, `items[${index}].regions[${regionIndex}].bbox`)
          return {
            page_number: numberValue(region.page_number, "page_number"),
            page_width: numberValue(region.page_width, "page_width"),
            page_height: numberValue(region.page_height, "page_height"),
            bbox: {
              origin: stringValue(bbox.origin, "bbox.origin"),
              left: numberValue(bbox.left, "bbox.left"),
              top: numberValue(bbox.top, "bbox.top"),
              right: numberValue(bbox.right, "bbox.right"),
              bottom: numberValue(bbox.bottom, "bbox.bottom"),
            },
          }
        }),
      }
    }),
    pages: arrayValue(root.pages, "pages").map((value, index) => {
      const page = objectValue(value, `pages[${index}]`)
      return {
        page_number: numberValue(page.page_number, `pages[${index}].page_number`),
        image_path: stringValue(page.image_path, `pages[${index}].image_path`),
      }
    }),
  }
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${field}`)
  return Object.fromEntries(Object.entries(value))
}

function arrayValue(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${field}`)
  return value
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Invalid ${field}`)
  return value
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${field}`)
  return value
}
