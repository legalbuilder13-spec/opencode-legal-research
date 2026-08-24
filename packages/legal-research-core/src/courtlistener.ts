import { hashText } from "./blob-store"
import { LegalResearchStore } from "./store"

export interface CourtListenerSearchOptions {
  query: string
  court?: string
  includeStatuses?: Array<"Published" | "Unpublished" | "Unknown">
}

export interface CourtListenerSearchResult {
  clusterId: number
  caseName: string
  citations: string[]
  court: string
  courtId: string
  dateFiled: string | null
  status: string
  absoluteUrl: string
  opinionIds: number[]
  snippets: string[]
  supportEligible: false
}

export type CourtListenerFetcher = (input: string, init?: RequestInit) => Promise<Response>

export class CourtListenerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message)
    this.name = "CourtListenerError"
  }
}

export class CourtListenerClient {
  readonly baseUrl: string
  readonly searchDisclosure = "The legal search query is sent to CourtListener. Search snippets are leads only."

  constructor(
    private options: {
      token: string
      fetcher?: CourtListenerFetcher
      baseUrl?: string
    },
  ) {
    if (!options.token.trim()) throw new Error("CourtListener API token is required")
    this.baseUrl = (options.baseUrl ?? "https://www.courtlistener.com").replace(/\/$/, "")
  }

  async search(options: CourtListenerSearchOptions) {
    const query = options.query.trim()
    if (!query) throw new Error("CourtListener query is required")
    const url = new URL("/api/rest/v4/search/", this.baseUrl)
    url.searchParams.set("type", "o")
    url.searchParams.set("q", query)
    if (options.court) url.searchParams.set("court", options.court)
    for (const status of options.includeStatuses ?? ["Published"]) {
      url.searchParams.set(`stat_${status}`, "on")
    }
    const root = object(await this.get(url.toString()), "search response")
    return array(root.results, "search results").map(parseSearchResult)
  }

  async materializeOpinion(input: { matterId: string; clusterId: number; store: LegalResearchStore }) {
    if (!Number.isInteger(input.clusterId) || input.clusterId <= 0) throw new Error("Invalid CourtListener cluster ID")
    const clusterUrl = `${this.baseUrl}/api/rest/v4/clusters/${input.clusterId}/`
    const cluster = object(await this.get(clusterUrl), "cluster")
    const docketUrl = absoluteApiUrl(string(cluster.docket, "cluster.docket"), this.baseUrl)
    const docket = object(await this.get(docketUrl), "docket")
    const courtUrl = absoluteApiUrl(string(docket.court, "docket.court"), this.baseUrl)
    const court = object(await this.get(courtUrl), "court")
    const opinionUrls = array(cluster.sub_opinions, "cluster.sub_opinions").map((value, index) =>
      absoluteApiUrl(string(value, `cluster.sub_opinions[${index}]`), this.baseUrl),
    )
    if (!opinionUrls.length) throw new CourtListenerError("Cluster has no full opinions", 422)
    const opinions = await Promise.all(opinionUrls.map(async (url) => object(await this.get(url), "opinion")))
    const fullText = opinions
      .map((opinion) => opinionText(opinion))
      .filter(Boolean)
      .join("\n\n")
      .trim()
    if (!fullText) throw new CourtListenerError("CourtListener returned no full opinion text", 422)

    const caseName =
      firstString(cluster.case_name, cluster.case_name_full, docket.case_name) ?? `Cluster ${input.clusterId}`
    const absoluteUrl = firstString(cluster.absolute_url) ?? `/opinion/${input.clusterId}/`
    const publicUrl = new URL(absoluteUrl, this.baseUrl).toString()
    const rawEnvelope = {
      contractVersion: 1,
      provider: "CourtListener",
      retrievedAt: new Date().toISOString(),
      cluster,
      docket,
      court,
      opinions,
    }
    const bytes = new TextEncoder().encode(`${JSON.stringify(rawEnvelope)}\n`)
    const source = await input.store.materialize({
      matterId: input.matterId,
      title: caseName,
      kind: "courtlistener",
      mime: "application/json",
      bytes,
      origin: clusterUrl,
      finalUrl: publicUrl,
      canonicalUrl: publicUrl,
      status: "complete",
    })
    const paragraphs = splitParagraphs(fullText)
    input.store.addRepresentation({
      sourceVersionId: source.sourceVersionId,
      parserName: "courtlistener-html-with-citations",
      parserVersion: "v4.7",
      mode: "structural",
      normalizedTextSha256: hashText(paragraphs.join("\n\n")),
      qualityMetrics: { paragraphCount: paragraphs.length, opinionCount: opinions.length },
      passages: paragraphs.map((text, index) => ({
        sourceRef: `#/opinions/text/${index}`,
        order: index,
        text,
        sectionPath: `${caseName} / paragraph ${index + 1}`,
      })),
    })
    const dateFiled = optionalString(cluster.date_filed) ?? optionalString(docket.date_filed)
    const courtId = optionalString(docket.court_id) ?? apiId(courtUrl)
    const precedential = publicationStatus(optionalString(cluster.precedential_status))
    input.store.setLegalMetadata({
      sourceVersionId: source.sourceVersionId,
      jurisdiction: courtJurisdiction(courtId),
      court: firstString(court.full_name, court.short_name, court.citation_string) ?? courtId,
      decisionDate: dateFiled ?? undefined,
      authorityType: "case",
      precedentialStatus: precedential,
      citation: citations(cluster.citations)[0],
      fullSource: true,
    })
    const opinionIds = opinions.map((opinion) => integer(opinion.id, "opinion.id"))
    input.store.db
      .query(
        `INSERT INTO courtlistener_record
          (source_version_id, cluster_id, opinion_ids_json, cluster_url, opinion_url,
           court_id, metadata_source, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        source.sourceVersionId,
        input.clusterId,
        JSON.stringify(opinionIds),
        clusterUrl,
        publicUrl,
        courtId,
        "CourtListener REST API v4.7",
        new Date().toISOString(),
      )
    return {
      sourceId: source.sourceId,
      sourceVersionId: source.sourceVersionId,
      clusterId: input.clusterId,
      opinionIds,
      caseName,
      citations: citations(cluster.citations),
      courtId,
      dateFiled,
      publicUrl,
      passageIds: input.store
        .passagesForMatter(input.matterId)
        .filter((passage) => passage.source_version_id === source.sourceVersionId)
        .map((passage) => passage.id),
    }
  }

  async citingOpinions(opinionId: number) {
    if (!Number.isInteger(opinionId) || opinionId <= 0) throw new Error("Invalid CourtListener opinion ID")
    const url = new URL("/api/rest/v4/opinions-cited/", this.baseUrl)
    url.searchParams.set("cited_opinion", String(opinionId))
    const root = object(await this.get(url.toString()), "citation graph response")
    const edges = array(root.results, "citation graph results").map((value, index) => {
      const edge = object(value, `citation graph results[${index}]`)
      return {
        id: integer(edge.id, "citation edge id"),
        citingOpinionId: apiNumericId(string(edge.citing_opinion, "citing_opinion")),
        citedOpinionId: apiNumericId(string(edge.cited_opinion, "cited_opinion")),
        depth: integer(edge.depth, "citation depth"),
      }
    })
    return {
      dataSource: "CourtListener citation graph (Eyecite-derived)",
      derived: true as const,
      legalTreatment: "not-evaluated" as const,
      limitations:
        "Citation edges and depth do not establish positive or negative treatment; parallel-citation coverage is incomplete.",
      edges,
    }
  }

  private async get(url: string) {
    const response = await (this.options.fetcher ?? fetch)(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Token ${this.options.token}`,
        "User-Agent": "LegalBuilder-OpenCode/0.0.1",
      },
    })
    if (!response.ok) {
      const retry = response.headers.get("Retry-After")
      const retryAfterSeconds = retry && /^\d+$/.test(retry) ? Number(retry) : null
      let detail = response.statusText || "request failed"
      try {
        const body = object(await response.json(), "CourtListener error")
        detail = optionalString(body.detail) ?? detail
      } catch {
        // The HTTP status remains authoritative when an upstream error is not JSON.
      }
      throw new CourtListenerError(`CourtListener ${response.status}: ${detail}`, response.status, retryAfterSeconds)
    }
    return response.json()
  }
}

function parseSearchResult(value: unknown, index: number): CourtListenerSearchResult {
  const result = object(value, `search.results[${index}]`)
  return {
    clusterId: integer(result.cluster_id, "cluster_id"),
    caseName: string(result.caseName, "caseName"),
    citations: stringArray(result.citation, "citation"),
    court: string(result.court, "court"),
    courtId: string(result.court_id, "court_id"),
    dateFiled: nullableString(result.dateFiled, "dateFiled"),
    status: string(result.status, "status"),
    absoluteUrl: string(result.absolute_url, "absolute_url"),
    opinionIds: array(result.opinions, "opinions").map((opinion, opinionIndex) =>
      integer(object(opinion, `opinions[${opinionIndex}]`).id, "opinion.id"),
    ),
    snippets: array(result.opinions, "opinions").map(
      (opinion, opinionIndex) => optionalString(object(opinion, `opinions[${opinionIndex}]`).snippet) ?? "",
    ),
    supportEligible: false,
  }
}

function opinionText(opinion: Record<string, unknown>) {
  const html = firstString(opinion.html_with_citations, opinion.html, opinion.html_lawbox, opinion.html_columbia)
  if (html) return htmlToText(html)
  return optionalString(opinion.plain_text)?.trim() ?? ""
}

function htmlToText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function splitParagraphs(text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
  return paragraphs.length ? paragraphs : [text]
}

function citations(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === "string") return [item]
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const record = Object.fromEntries(Object.entries(item))
    return [record.cite, record.citation].filter((candidate): candidate is string => typeof candidate === "string")
  })
}

function courtJurisdiction(courtId: string) {
  if (courtId === "scotus") return "U.S. Supreme Court"
  if (/^ca\d+$/.test(courtId)) return `${courtId.slice(2)}th Cir.`
  return courtId
}

function publicationStatus(value: string | undefined): "published" | "unpublished" | "unknown" {
  if (!value) return "unknown"
  if (/unpublished/i.test(value)) return "unpublished"
  if (/published/i.test(value)) return "published"
  return "unknown"
}

function apiId(url: string) {
  return url.replace(/\/$/, "").split("/").pop() ?? "unknown"
}

function apiNumericId(url: string) {
  const value = Number(apiId(url))
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid numeric API resource ID: ${url}`)
  return value
}

function absoluteApiUrl(value: string, baseUrl: string) {
  const url = new URL(value, baseUrl)
  if (url.origin !== new URL(baseUrl).origin) throw new Error("CourtListener API returned a cross-origin resource URL")
  return url.toString()
}

function object(value: unknown, name: string): Record<string, unknown> {
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

function stringArray(value: unknown, name: string) {
  return array(value, name).map((item, index) => string(item, `${name}[${index}]`))
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function nullableString(value: unknown, name: string) {
  if (value === null) return null
  return string(value, name)
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))
}
