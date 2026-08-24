import { Database } from "bun:sqlite"
import { randomUUID } from "node:crypto"
import { BlobStore, hashText } from "./blob-store"

export type MatterStatus = "active" | "archived" | "deleted"
export type CaptureStatus = "complete" | "partial" | "blocked" | "paywalled" | "license-limited"

export interface MatterInput {
  name: string
  jurisdiction: string
  researchAsOf: string
  confidentiality: "public" | "confidential" | "privileged"
  clientLabel?: string
}

export interface MaterializeInput {
  matterId: string
  sourceId?: string
  title: string
  kind: "upload" | "web" | "courtlistener" | "tool"
  mime: string
  bytes: Uint8Array
  origin: string
  finalUrl?: string
  canonicalUrl?: string
  status?: CaptureStatus
  accessNotes?: string
  retrievedAt?: string
}

export interface PassageInput {
  sourceRef: string
  order: number
  text: string
  startOffset?: number
  endOffset?: number
  sectionPath?: string
  regions?: Array<{
    pageNumber: number
    pageWidth: number
    pageHeight: number
    left: number
    top: number
    right: number
    bottom: number
    imageBlobHash?: string
  }>
}

export interface RepresentationInput {
  sourceVersionId: string
  parserName: string
  parserVersion: string
  ocrEngine?: string
  ocrVersion?: string
  mode: string
  normalizedTextSha256: string
  qualityMetrics?: unknown
  warnings?: unknown
  passages: PassageInput[]
}

export interface LegalMetadataInput {
  sourceVersionId: string
  jurisdiction?: string
  court?: string
  decisionDate?: string
  authorityType: "case" | "statute" | "regulation" | "secondary" | "matter-document" | "web"
  precedentialStatus?: "published" | "unpublished" | "unknown"
  citation?: string
  fullSource?: boolean
}

interface MatterRow {
  id: string
  name: string
  jurisdiction: string
  research_as_of: string
  confidentiality: string
  client_label: string | null
  status: MatterStatus
}

interface SourceVersionRow {
  id: string
  source_id: string
  matter_id: string
  content_sha256: string
  blob_sha256: string
  mime: string
  size: number
  capture_status: CaptureStatus
  deleted_at: string | null
}

export class LegalResearchStore {
  readonly db: Database
  readonly blobs: BlobStore

  constructor(input: { databasePath?: string; blobRoot: string }) {
    this.db = new Database(input.databasePath ?? ":memory:", { create: true, strict: true })
    this.blobs = new BlobStore(input.blobRoot)
    this.db.exec("PRAGMA foreign_keys = ON")
    this.db.exec("PRAGMA journal_mode = WAL")
    this.migrate()
  }

  close() {
    this.db.close()
  }

  createMatter(input: MatterInput, id = `mat_${randomUUID()}`) {
    validateDate(input.researchAsOf)
    const now = new Date().toISOString()
    this.db
      .query(
        `INSERT INTO matter
          (id, name, jurisdiction, research_as_of, confidentiality, client_label, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        id,
        requiredText(input.name, "matter name"),
        requiredText(input.jurisdiction, "jurisdiction"),
        input.researchAsOf,
        input.confidentiality,
        input.clientLabel?.trim() || null,
        now,
        now,
      )
    return this.matter(id)
  }

  matter(id: string) {
    const row = this.db
      .query<MatterRow, [string]>(
        `SELECT id, name, jurisdiction, research_as_of, confidentiality, client_label, status
        FROM matter WHERE id = ?`,
      )
      .get(id)
    if (!row) throw new Error(`Unknown matter: ${id}`)
    return {
      id: row.id,
      name: row.name,
      jurisdiction: row.jurisdiction,
      researchAsOf: row.research_as_of,
      confidentiality: row.confidentiality,
      clientLabel: row.client_label,
      status: row.status,
    }
  }

  updateMatter(id: string, input: Partial<MatterInput>) {
    const current = this.matter(id)
    if (current.status === "deleted") throw new Error("Deleted matter cannot be edited")
    const next = {
      name: input.name ?? current.name,
      jurisdiction: input.jurisdiction ?? current.jurisdiction,
      researchAsOf: input.researchAsOf ?? current.researchAsOf,
      confidentiality: input.confidentiality ?? current.confidentiality,
      clientLabel: input.clientLabel === undefined ? current.clientLabel : input.clientLabel,
    }
    validateDate(next.researchAsOf)
    this.db
      .query(
        `UPDATE matter SET name = ?, jurisdiction = ?, research_as_of = ?, confidentiality = ?,
          client_label = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        requiredText(next.name, "matter name"),
        requiredText(next.jurisdiction, "jurisdiction"),
        next.researchAsOf,
        next.confidentiality,
        next.clientLabel?.trim() || null,
        new Date().toISOString(),
        id,
      )
    return this.matter(id)
  }

  setMatterStatus(id: string, status: Exclude<MatterStatus, "deleted">) {
    const matter = this.matter(id)
    if (matter.status === "deleted") throw new Error("Deleted matter cannot change status")
    this.db.query("UPDATE matter SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), id)
    return this.matter(id)
  }

  async materialize(input: MaterializeInput) {
    const matter = this.requireActiveMatter(input.matterId)
    validateMime(input.mime)
    const blob = await this.blobs.put(input.bytes)
    const now = input.retrievedAt ?? new Date().toISOString()
    const sourceId = input.sourceId ?? `src_${randomUUID()}`
    const versionId = `srcv_${randomUUID()}`
    const write = this.db.transaction(() => {
      if (input.sourceId) {
        const existing = this.db
          .query<{ matter_id: string }, [string]>("SELECT matter_id FROM source WHERE id = ? AND deleted_at IS NULL")
          .get(input.sourceId)
        if (!existing) throw new Error(`Unknown source: ${input.sourceId}`)
        if (existing.matter_id !== matter.id) throw new Error("Source belongs to a different matter")
      } else {
        this.db
          .query("INSERT INTO source (id, matter_id, title, kind, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(sourceId, matter.id, requiredText(input.title, "source title"), input.kind, now)
      }
      const prior = this.db
        .query<
          { id: string },
          [string, string]
        >("SELECT id FROM source_version WHERE source_id = ? AND content_sha256 = ? AND deleted_at IS NULL")
        .get(sourceId, blob.sha256)
      if (prior) return { sourceId, sourceVersionId: prior.id, blob, reusedVersion: true }
      this.db
        .query(
          `INSERT INTO source_version
            (id, source_id, matter_id, content_sha256, blob_sha256, mime, size, origin, final_url,
             canonical_url, retrieved_at, capture_status, access_notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          sourceId,
          matter.id,
          blob.sha256,
          blob.sha256,
          input.mime,
          blob.size,
          input.origin,
          input.finalUrl ?? null,
          input.canonicalUrl ?? null,
          now,
          input.status ?? "complete",
          input.accessNotes ?? null,
        )
      this.db
        .query(
          "INSERT INTO acquisition_event (id, matter_id, source_version_id, origin, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(`acq_${randomUUID()}`, matter.id, versionId, input.origin, input.status ?? "complete", now)
      return { sourceId, sourceVersionId: versionId, blob, reusedVersion: false }
    })
    return write()
  }

  addRepresentation(input: RepresentationInput) {
    const version = this.sourceVersion(input.sourceVersionId)
    if (version.deleted_at) throw new Error("Cannot represent a deleted source version")
    if (version.capture_status !== "complete")
      throw new Error(`Source capture is not complete: ${version.capture_status}`)
    const representationId = `rep_${randomUUID()}`
    const write = this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO representation
            (id, source_version_id, matter_id, parser_name, parser_version, ocr_engine, ocr_version,
             mode, normalized_text_sha256, quality_metrics_json, warnings_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          representationId,
          version.id,
          version.matter_id,
          input.parserName,
          input.parserVersion,
          input.ocrEngine ?? null,
          input.ocrVersion ?? null,
          input.mode,
          input.normalizedTextSha256,
          JSON.stringify(input.qualityMetrics ?? {}),
          JSON.stringify(input.warnings ?? []),
          new Date().toISOString(),
        )
      for (const passage of input.passages) {
        const passageId = `psg_${randomUUID()}`
        const start = passage.startOffset ?? 0
        const end = passage.endOffset ?? passage.text.length
        if (start < 0 || end < start) throw new Error("Invalid passage offsets")
        this.db
          .query(
            `INSERT INTO passage
              (id, representation_id, source_version_id, matter_id, source_ref, order_index, text,
               text_sha256, start_offset, end_offset, section_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            passageId,
            representationId,
            version.id,
            version.matter_id,
            passage.sourceRef,
            passage.order,
            passage.text,
            hashText(passage.text),
            start,
            end,
            passage.sectionPath ?? null,
          )
        this.db
          .query("INSERT INTO passage_fts (passage_id, matter_id, text) VALUES (?, ?, ?)")
          .run(passageId, version.matter_id, passage.text)
        for (const region of passage.regions ?? []) {
          this.db
            .query(
              `INSERT INTO passage_region
                (id, passage_id, page_number, page_width, page_height, left, top, right, bottom, image_blob_sha256)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              `reg_${randomUUID()}`,
              passageId,
              region.pageNumber,
              region.pageWidth,
              region.pageHeight,
              region.left,
              region.top,
              region.right,
              region.bottom,
              region.imageBlobHash ?? null,
            )
        }
      }
    })
    write()
    return representationId
  }

  setLegalMetadata(input: LegalMetadataInput) {
    const version = this.sourceVersion(input.sourceVersionId)
    if (input.decisionDate) validateDate(input.decisionDate)
    this.db
      .query(
        `INSERT INTO legal_metadata
          (source_version_id, matter_id, jurisdiction, court, decision_date, authority_type,
           precedential_status, citation, full_source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_version_id) DO UPDATE SET
          jurisdiction = excluded.jurisdiction,
          court = excluded.court,
          decision_date = excluded.decision_date,
          authority_type = excluded.authority_type,
          precedential_status = excluded.precedential_status,
          citation = excluded.citation,
          full_source = excluded.full_source`,
      )
      .run(
        version.id,
        version.matter_id,
        input.jurisdiction ?? null,
        input.court ?? null,
        input.decisionDate ?? null,
        input.authorityType,
        input.precedentialStatus ?? "unknown",
        input.citation ?? null,
        input.fullSource === false ? 0 : 1,
      )
  }

  passagesForMatter(matterId: string) {
    this.requireReadableMatter(matterId)
    return this.db
      .query<
        { id: string; source_version_id: string; text: string; text_sha256: string; section_path: string | null },
        [string]
      >(
        `SELECT passage.id, passage.source_version_id, passage.text, passage.text_sha256, passage.section_path
        FROM passage
        JOIN source_version ON source_version.id = passage.source_version_id
        WHERE passage.matter_id = ? AND source_version.deleted_at IS NULL
        ORDER BY passage.rowid`,
      )
      .all(matterId)
  }

  passageForContext(matterId: string, passageId: string) {
    this.requireReadableMatter(matterId)
    const row = this.db
      .query<{ id: string; source_version_id: string; text: string; text_sha256: string }, [string, string]>(
        `SELECT passage.id, passage.source_version_id, passage.text, passage.text_sha256
        FROM passage JOIN source_version ON source_version.id = passage.source_version_id
        WHERE passage.id = ? AND passage.matter_id = ? AND source_version.deleted_at IS NULL`,
      )
      .get(passageId, matterId)
    if (!row) throw new Error("Passage is unavailable or belongs to a different matter")
    if (hashText(row.text) !== row.text_sha256) throw new Error("Passage integrity check failed")
    return {
      passageId: row.id,
      sourceVersionId: row.source_version_id,
      text: row.text,
      textSha256: row.text_sha256,
      untrustedSourceData: true as const,
    }
  }

  deleteSourceVersion(sourceVersionId: string) {
    const version = this.sourceVersion(sourceVersionId)
    if (version.deleted_at) return { sourceVersionId, alreadyDeleted: true, blobRetained: true }
    this.db
      .query("UPDATE source_version SET deleted_at = ? WHERE id = ?")
      .run(new Date().toISOString(), sourceVersionId)
    return { sourceVersionId, alreadyDeleted: false, blobRetained: true }
  }

  deleteMatter(matterId: string) {
    const matter = this.matter(matterId)
    if (matter.status === "deleted") return { matterId, alreadyDeleted: true, blobPolicy: "retained-until-compaction" }
    const now = new Date().toISOString()
    const write = this.db.transaction(() => {
      this.db
        .query("UPDATE matter SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, matterId)
      this.db.query("UPDATE source SET deleted_at = ? WHERE matter_id = ? AND deleted_at IS NULL").run(now, matterId)
      this.db
        .query("UPDATE source_version SET deleted_at = ? WHERE matter_id = ? AND deleted_at IS NULL")
        .run(now, matterId)
    })
    write()
    return { matterId, alreadyDeleted: false, blobPolicy: "retained-until-compaction" }
  }

  exportMatter(matterId: string) {
    const matter = this.requireReadableMatter(matterId)
    const sources = this.db
      .query<
        {
          source_id: string
          title: string
          kind: string
          source_version_id: string
          content_sha256: string
          mime: string
          retrieved_at: string
          capture_status: CaptureStatus
        },
        [string]
      >(
        `SELECT source.id AS source_id, source.title, source.kind, source_version.id AS source_version_id,
          source_version.content_sha256, source_version.mime, source_version.retrieved_at,
          source_version.capture_status
        FROM source JOIN source_version ON source_version.source_id = source.id
        WHERE source.matter_id = ? AND source.deleted_at IS NULL AND source_version.deleted_at IS NULL
        ORDER BY source.created_at, source_version.retrieved_at`,
      )
      .all(matterId)
    return {
      contractVersion: 1,
      exportedAt: new Date().toISOString(),
      matter,
      sources,
      passages: this.passagesForMatter(matterId).map((passage) => ({
        id: passage.id,
        sourceVersionId: passage.source_version_id,
        textSha256: passage.text_sha256,
        sectionPath: passage.section_path,
      })),
      blobPolicy: "content-addressed blobs are retained until explicit compaction",
    }
  }

  sourceVersion(id: string) {
    const row = this.db
      .query<SourceVersionRow, [string]>(
        `SELECT id, source_id, matter_id, content_sha256, blob_sha256, mime, size, capture_status, deleted_at
        FROM source_version WHERE id = ?`,
      )
      .get(id)
    if (!row) throw new Error(`Unknown source version: ${id}`)
    return row
  }

  private requireActiveMatter(id: string) {
    const matter = this.matter(id)
    if (matter.status !== "active") throw new Error(`Matter is not active: ${matter.status}`)
    return matter
  }

  private requireReadableMatter(id: string) {
    const matter = this.matter(id)
    if (matter.status === "deleted") throw new Error("Matter is deleted")
    return matter
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matter (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        jurisdiction TEXT NOT NULL,
        research_as_of TEXT NOT NULL,
        confidentiality TEXT NOT NULL,
        client_label TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS source (
        id TEXT PRIMARY KEY,
        matter_id TEXT NOT NULL REFERENCES matter(id),
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS source_version (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES source(id),
        matter_id TEXT NOT NULL REFERENCES matter(id),
        content_sha256 TEXT NOT NULL,
        blob_sha256 TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        origin TEXT NOT NULL,
        final_url TEXT,
        canonical_url TEXT,
        retrieved_at TEXT NOT NULL,
        capture_status TEXT NOT NULL,
        access_notes TEXT,
        deleted_at TEXT,
        UNIQUE(source_id, content_sha256)
      );
      CREATE TABLE IF NOT EXISTS acquisition_event (
        id TEXT PRIMARY KEY,
        matter_id TEXT NOT NULL REFERENCES matter(id),
        source_version_id TEXT NOT NULL REFERENCES source_version(id),
        origin TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS representation (
        id TEXT PRIMARY KEY,
        source_version_id TEXT NOT NULL REFERENCES source_version(id),
        matter_id TEXT NOT NULL REFERENCES matter(id),
        parser_name TEXT NOT NULL,
        parser_version TEXT NOT NULL,
        ocr_engine TEXT,
        ocr_version TEXT,
        mode TEXT NOT NULL,
        normalized_text_sha256 TEXT NOT NULL,
        quality_metrics_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS passage (
        id TEXT PRIMARY KEY,
        representation_id TEXT NOT NULL REFERENCES representation(id),
        source_version_id TEXT NOT NULL REFERENCES source_version(id),
        matter_id TEXT NOT NULL REFERENCES matter(id),
        source_ref TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        text_sha256 TEXT NOT NULL,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        section_path TEXT
      );
      CREATE INDEX IF NOT EXISTS passage_matter ON passage(matter_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS passage_fts USING fts5(
        passage_id UNINDEXED,
        matter_id UNINDEXED,
        text,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS passage_region (
        id TEXT PRIMARY KEY,
        passage_id TEXT NOT NULL REFERENCES passage(id),
        page_number INTEGER NOT NULL,
        page_width REAL NOT NULL,
        page_height REAL NOT NULL,
        left REAL NOT NULL,
        top REAL NOT NULL,
        right REAL NOT NULL,
        bottom REAL NOT NULL,
        image_blob_sha256 TEXT
      );
      CREATE TABLE IF NOT EXISTS legal_metadata (
        source_version_id TEXT PRIMARY KEY REFERENCES source_version(id),
        matter_id TEXT NOT NULL REFERENCES matter(id),
        jurisdiction TEXT,
        court TEXT,
        decision_date TEXT,
        authority_type TEXT NOT NULL,
        precedential_status TEXT NOT NULL,
        citation TEXT,
        full_source INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS retrieval_run (
        id TEXT PRIMARY KEY,
        matter_id TEXT NOT NULL REFERENCES matter(id),
        query TEXT NOT NULL,
        filters_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS retrieval_candidate (
        retrieval_run_id TEXT NOT NULL REFERENCES retrieval_run(id),
        passage_id TEXT NOT NULL REFERENCES passage(id),
        lexical_rank INTEGER,
        semantic_rank INTEGER,
        fused_score REAL NOT NULL,
        rerank_score REAL NOT NULL,
        selected INTEGER NOT NULL,
        sent_to_model INTEGER NOT NULL,
        PRIMARY KEY(retrieval_run_id, passage_id)
      );
      CREATE TABLE IF NOT EXISTS authority_lead (
        id TEXT PRIMARY KEY,
        matter_id TEXT NOT NULL REFERENCES matter(id),
        from_source_version_id TEXT NOT NULL REFERENCES source_version(id),
        to_source_version_id TEXT NOT NULL REFERENCES source_version(id),
        relationship TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS excluded_content (
        id TEXT PRIMARY KEY,
        matter_id TEXT NOT NULL REFERENCES matter(id),
        connector TEXT NOT NULL,
        reason TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
  }
}

function requiredText(value: string, name: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

function validateDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error("researchAsOf must be YYYY-MM-DD")
  }
}

function validateMime(value: string) {
  const supported = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/html",
    "text/plain",
    "image/png",
    "image/jpeg",
    "application/json",
  ])
  if (!supported.has(value)) throw new Error(`Unsupported source MIME type: ${value}`)
}
