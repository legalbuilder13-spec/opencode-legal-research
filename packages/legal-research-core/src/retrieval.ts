import { randomUUID } from "node:crypto"
import { LegalResearchStore } from "./store"

export interface LegalFilters {
  jurisdiction?: string
  court?: string
  dateFrom?: string
  dateTo?: string
  authorityTypes?: Array<"case" | "statute" | "regulation" | "secondary" | "matter-document" | "web">
  precedentialStatuses?: Array<"published" | "unpublished" | "unknown">
}

export interface RetrievalOptions {
  matterId: string
  query: string
  filters?: LegalFilters
  limit?: number
  maxPerSource?: number
  neighborRadius?: number
  lane?: "ordinary" | "adverse"
}

interface PassageCandidateRow {
  passage_id: string
  source_version_id: string
  source_id: string
  source_title: string
  representation_id: string
  order_index: number
  text: string
  text_sha256: string
  capture_status: string
  jurisdiction: string | null
  court: string | null
  decision_date: string | null
  authority_type: string | null
  precedential_status: string | null
  citation: string | null
  full_source: number | null
}

interface ScoredCandidate {
  row: PassageCandidateRow
  lexicalRank: number | null
  semanticRank: number | null
  fusedScore: number
  rerankScore: number
}

export interface RetrievalResult {
  retrievalRunId: string
  query: string
  lane: "ordinary" | "adverse"
  results: Array<{
    passageId: string
    sourceVersionId: string
    sourceTitle: string
    text: string
    textSha256: string
    authorityType: string | null
    citation: string | null
    supportEligible: boolean
    scores: {
      lexicalRank: number | null
      semanticRank: number | null
      fused: number
      rerank: number
    }
  }>
  context: Array<{
    passageId: string
    sourceVersionId: string
    text: string
    textSha256: string
    selected: boolean
    untrustedSourceData: true
  }>
}

export class RetrievalEngine {
  constructor(readonly store: LegalResearchStore) {}

  search(options: RetrievalOptions): RetrievalResult {
    const matter = this.store.matter(options.matterId)
    if (matter.status === "deleted") throw new Error("Matter is deleted")
    const query = options.query.trim()
    if (!query) throw new Error("Retrieval query is required")
    const filters = options.filters ?? {}
    validateFilters(filters)
    const rows = this.candidateRows(options.matterId).filter((row) => filterRow(row, filters))
    const rowById = new Map(rows.map((row) => [row.passage_id, row]))
    const lexicalIds = this.lexical(options.matterId, query).filter((id) => rowById.has(id))
    const queryVector = embedding(query)
    const semanticIds = [...rows]
      .map((row) => ({ id: row.passage_id, score: cosine(queryVector, embedding(row.text)) }))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .map((item) => item.id)
    const lexicalRanks = rankMap(lexicalIds)
    const semanticRanks = rankMap(semanticIds)
    const queryTerms = new Set(expandedTokens(query))
    const scored: ScoredCandidate[] = rows.map((row) => {
      const lexicalRank = lexicalRanks.get(row.passage_id) ?? null
      const semanticRank = semanticRanks.get(row.passage_id) ?? null
      const fusedScore = rrf(lexicalRank) + rrf(semanticRank)
      const passageTerms = new Set(expandedTokens(row.text))
      const coverage = [...queryTerms].filter((term) => passageTerms.has(term)).length / Math.max(queryTerms.size, 1)
      const primaryBoost =
        row.authority_type === "case" || row.authority_type === "statute" || row.authority_type === "regulation"
          ? 0.04
          : 0
      const adverseBoost = options.lane === "adverse" && adverseTerms.some((term) => passageTerms.has(term)) ? 0.08 : 0
      return {
        row,
        lexicalRank,
        semanticRank,
        fusedScore,
        rerankScore: fusedScore + coverage * 0.25 + primaryBoost + adverseBoost,
      }
    })
    scored.sort(
      (left, right) => right.rerankScore - left.rerankScore || left.row.passage_id.localeCompare(right.row.passage_id),
    )
    const selected = diverse(scored, options.limit ?? 8, options.maxPerSource ?? 2)
    const context = this.context(selected, options.neighborRadius ?? 1)
    const runId = `retr_${randomUUID()}`
    const write = this.store.db.transaction(() => {
      this.store.db
        .query("INSERT INTO retrieval_run (id, matter_id, query, filters_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(
          runId,
          options.matterId,
          query,
          JSON.stringify({ ...filters, lane: options.lane ?? "ordinary" }),
          new Date().toISOString(),
        )
      const selectedIds = new Set(selected.map((item) => item.row.passage_id))
      const contextIds = new Set(context.map((item) => item.passageId))
      const logged = new Map(scored.map((item) => [item.row.passage_id, item]))
      for (const item of context) {
        if (logged.has(item.passageId)) continue
        const row = this.row(item.passageId)
        logged.set(item.passageId, { row, lexicalRank: null, semanticRank: null, fusedScore: 0, rerankScore: 0 })
      }
      for (const candidate of logged.values()) {
        this.store.db
          .query(
            `INSERT INTO retrieval_candidate
              (retrieval_run_id, passage_id, lexical_rank, semantic_rank, fused_score,
               rerank_score, selected, sent_to_model)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            runId,
            candidate.row.passage_id,
            candidate.lexicalRank,
            candidate.semanticRank,
            candidate.fusedScore,
            candidate.rerankScore,
            selectedIds.has(candidate.row.passage_id) ? 1 : 0,
            contextIds.has(candidate.row.passage_id) ? 1 : 0,
          )
      }
    })
    write()

    return {
      retrievalRunId: runId,
      query,
      lane: options.lane ?? "ordinary",
      results: selected.map((candidate) => ({
        passageId: candidate.row.passage_id,
        sourceVersionId: candidate.row.source_version_id,
        sourceTitle: candidate.row.source_title,
        text: candidate.row.text,
        textSha256: candidate.row.text_sha256,
        authorityType: candidate.row.authority_type,
        citation: candidate.row.citation,
        supportEligible: candidate.row.capture_status === "complete" && candidate.row.full_source !== 0,
        scores: {
          lexicalRank: candidate.lexicalRank,
          semanticRank: candidate.semanticRank,
          fused: candidate.fusedScore,
          rerank: candidate.rerankScore,
        },
      })),
      context,
    }
  }

  adverseSearch(options: Omit<RetrievalOptions, "lane" | "query"> & { query: string }) {
    return this.search({
      ...options,
      lane: "adverse",
      query: `${options.query} exception limitation contrary distinguish overrule`,
    })
  }

  recordAuthorityLead(input: {
    matterId: string
    fromSourceVersionId: string
    toSourceVersionId: string
    relationship?: string
  }) {
    const from = this.store.sourceVersion(input.fromSourceVersionId)
    const to = this.store.sourceVersion(input.toSourceVersionId)
    if (from.matter_id !== input.matterId || to.matter_id !== input.matterId) {
      throw new Error("Authority lead crosses matter boundary")
    }
    const id = `lead_${randomUUID()}`
    this.store.db
      .query(
        "INSERT INTO authority_lead (id, matter_id, from_source_version_id, to_source_version_id, relationship, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.matterId,
        from.id,
        to.id,
        input.relationship ?? "secondary-led-to-primary",
        new Date().toISOString(),
      )
    return id
  }

  log(retrievalRunId: string) {
    return this.store.db
      .query<
        {
          passage_id: string
          lexical_rank: number | null
          semantic_rank: number | null
          selected: number
          sent_to_model: number
        },
        [string]
      >(
        `SELECT passage_id, lexical_rank, semantic_rank, selected, sent_to_model
        FROM retrieval_candidate WHERE retrieval_run_id = ? ORDER BY rerank_score DESC, passage_id`,
      )
      .all(retrievalRunId)
  }

  private lexical(matterId: string, query: string) {
    const terms = tokens(query)
    if (!terms.length) return []
    const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ")
    return this.store.db
      .query<{ passage_id: string }, [string, string]>(
        "SELECT passage_id FROM passage_fts WHERE passage_fts MATCH ? AND matter_id = ? ORDER BY bm25(passage_fts)",
      )
      .all(match, matterId)
      .map((row) => row.passage_id)
  }

  private candidateRows(matterId: string) {
    return this.store.db
      .query<PassageCandidateRow, [string]>(
        `SELECT passage.id AS passage_id, passage.source_version_id, source.id AS source_id,
          source.title AS source_title, passage.representation_id, passage.order_index,
          passage.text, passage.text_sha256, source_version.capture_status,
          legal_metadata.jurisdiction, legal_metadata.court, legal_metadata.decision_date,
          legal_metadata.authority_type, legal_metadata.precedential_status,
          legal_metadata.citation, legal_metadata.full_source
        FROM passage
        JOIN source_version ON source_version.id = passage.source_version_id
        JOIN source ON source.id = source_version.source_id
        LEFT JOIN legal_metadata ON legal_metadata.source_version_id = source_version.id
        WHERE passage.matter_id = ? AND source_version.deleted_at IS NULL AND source.deleted_at IS NULL`,
      )
      .all(matterId)
  }

  private row(passageId: string) {
    const row = this.store.db
      .query<PassageCandidateRow, [string]>(
        `SELECT passage.id AS passage_id, passage.source_version_id, source.id AS source_id,
          source.title AS source_title, passage.representation_id, passage.order_index,
          passage.text, passage.text_sha256, source_version.capture_status,
          legal_metadata.jurisdiction, legal_metadata.court, legal_metadata.decision_date,
          legal_metadata.authority_type, legal_metadata.precedential_status,
          legal_metadata.citation, legal_metadata.full_source
        FROM passage JOIN source_version ON source_version.id = passage.source_version_id
        JOIN source ON source.id = source_version.source_id
        LEFT JOIN legal_metadata ON legal_metadata.source_version_id = source_version.id
        WHERE passage.id = ?`,
      )
      .get(passageId)
    if (!row) throw new Error(`Unknown passage: ${passageId}`)
    return row
  }

  private context(selected: ScoredCandidate[], radius: number) {
    const passages = new Map<string, { row: PassageCandidateRow; selected: boolean }>()
    for (const candidate of selected) {
      passages.set(candidate.row.passage_id, { row: candidate.row, selected: true })
      if (radius <= 0) continue
      const neighbors = this.store.db
        .query<PassageCandidateRow, [string, number, number]>(
          `SELECT passage.id AS passage_id, passage.source_version_id, source.id AS source_id,
            source.title AS source_title, passage.representation_id, passage.order_index,
            passage.text, passage.text_sha256, source_version.capture_status,
            legal_metadata.jurisdiction, legal_metadata.court, legal_metadata.decision_date,
            legal_metadata.authority_type, legal_metadata.precedential_status,
            legal_metadata.citation, legal_metadata.full_source
          FROM passage JOIN source_version ON source_version.id = passage.source_version_id
          JOIN source ON source.id = source_version.source_id
          LEFT JOIN legal_metadata ON legal_metadata.source_version_id = source_version.id
          WHERE passage.representation_id = ? AND passage.order_index BETWEEN ? AND ?
          AND source_version.deleted_at IS NULL ORDER BY passage.order_index`,
        )
        .all(candidate.row.representation_id, candidate.row.order_index - radius, candidate.row.order_index + radius)
      for (const row of neighbors) {
        const current = passages.get(row.passage_id)
        passages.set(row.passage_id, { row, selected: current?.selected ?? false })
      }
    }
    return [...passages.values()]
      .sort(
        (left, right) =>
          left.row.source_version_id.localeCompare(right.row.source_version_id) ||
          left.row.order_index - right.row.order_index,
      )
      .map(({ row, selected }) => ({
        passageId: row.passage_id,
        sourceVersionId: row.source_version_id,
        text: row.text,
        textSha256: row.text_sha256,
        selected,
        untrustedSourceData: true as const,
      }))
  }
}

export class ResearchPlanner {
  constructor(readonly store: LegalResearchStore) {}

  plan(input: { matterId: string; question: string; proceduralPosture?: string }) {
    const matter = this.store.matter(input.matterId)
    const question = input.question.trim()
    if (!question) throw new Error("Research question is required")
    const issues = question
      .replace(/\?+$/, "")
      .split(/;|\band\b/i)
      .map((issue) => issue.trim())
      .filter(Boolean)
    return {
      matterId: matter.id,
      question,
      assumptions: {
        jurisdiction: matter.jurisdiction,
        researchAsOf: matter.researchAsOf,
        proceduralPosture: input.proceduralPosture ?? "not specified",
      },
      issues: issues.map((issue, index) => ({ id: `issue_${index + 1}`, issue })),
      sourcePriorities: [
        "binding primary authority",
        "persuasive primary authority",
        "matter documents",
        "secondary leads",
      ],
      lanes: [
        { kind: "primary", query: question },
        { kind: "adverse", query: `${question} exception limitation contrary distinguish overrule` },
      ],
    }
  }
}

const stopwords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "when",
])
const adverseTerms = ["exception", "limit", "limitation", "contrary", "distinguish", "overrule", "adverse"]
const semanticSynonyms: Record<string, string[]> = {
  attorney: ["lawyer", "counsel"],
  counsel: ["attorney", "lawyer"],
  government: ["public", "state"],
  immunity: ["protected", "protection"],
  official: ["officer", "employee"],
  prohibit: ["bar", "preclude"],
  relief: ["remedy"],
  require: ["element", "must"],
}

function tokens(value: string) {
  return (value.toLowerCase().match(/[\p{L}\p{N}§]+/gu) ?? []).filter((token) => !stopwords.has(token))
}

function expandedTokens(value: string) {
  return tokens(value).flatMap((token) => [token, ...(semanticSynonyms[token] ?? [])])
}

function embedding(value: string) {
  const vector = new Float64Array(256)
  for (const token of expandedTokens(value)) {
    let hash = 2166136261
    for (let index = 0; index < token.length; index++) hash = Math.imul(hash ^ token.charCodeAt(index), 16777619)
    const bucket = Math.abs(hash) % vector.length
    vector[bucket] = (vector[bucket] ?? 0) + 1
  }
  return vector
}

function cosine(left: Float64Array, right: Float64Array) {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index++) {
    dot += left[index]! * right[index]!
    leftNorm += left[index]! ** 2
    rightNorm += right[index]! ** 2
  }
  return dot / Math.max(Math.sqrt(leftNorm) * Math.sqrt(rightNorm), Number.EPSILON)
}

function rankMap(ids: string[]) {
  return new Map(ids.map((id, index) => [id, index + 1]))
}

function rrf(rank: number | null) {
  return rank === null ? 0 : 1 / (60 + rank)
}

function diverse(candidates: ScoredCandidate[], limit: number, maxPerSource: number) {
  const counts = new Map<string, number>()
  const selected: ScoredCandidate[] = []
  for (const candidate of candidates) {
    if (selected.length >= limit) break
    const count = counts.get(candidate.row.source_version_id) ?? 0
    if (count >= maxPerSource) continue
    counts.set(candidate.row.source_version_id, count + 1)
    selected.push(candidate)
  }
  return selected
}

function filterRow(row: PassageCandidateRow, filters: LegalFilters) {
  if (filters.jurisdiction && row.jurisdiction !== filters.jurisdiction) return false
  if (filters.court && row.court !== filters.court) return false
  if (filters.dateFrom && (!row.decision_date || row.decision_date < filters.dateFrom)) return false
  if (filters.dateTo && (!row.decision_date || row.decision_date > filters.dateTo)) return false
  if (
    filters.authorityTypes?.length &&
    (!row.authority_type || !filters.authorityTypes.includes(asAuthority(row.authority_type)))
  ) {
    return false
  }
  if (
    filters.precedentialStatuses?.length &&
    (!row.precedential_status || !filters.precedentialStatuses.includes(asPrecedential(row.precedential_status)))
  ) {
    return false
  }
  return true
}

function validateFilters(filters: LegalFilters) {
  if (filters.dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom)) throw new Error("Invalid dateFrom")
  if (filters.dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo)) throw new Error("Invalid dateTo")
}

function asAuthority(value: string): NonNullable<LegalFilters["authorityTypes"]>[number] {
  if (
    value === "case" ||
    value === "statute" ||
    value === "regulation" ||
    value === "secondary" ||
    value === "matter-document" ||
    value === "web"
  )
    return value
  throw new Error(`Invalid stored authority type: ${value}`)
}

function asPrecedential(value: string): NonNullable<LegalFilters["precedentialStatuses"]>[number] {
  if (value === "published" || value === "unpublished" || value === "unknown") return value
  throw new Error(`Invalid stored precedential status: ${value}`)
}
