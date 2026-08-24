import { hashText } from "./blob-store"
import { randomUUID } from "node:crypto"
import { LegalResearchStore, type CaptureStatus } from "./store"

export interface ToolContentBlock {
  type: "text" | "resource" | "excluded"
  text?: string
  data?: Uint8Array
  mime?: string
  name?: string
  reason?: string
  metadata?: Record<string, unknown>
}

export interface ContextPassage {
  passageId: string
  sourceVersionId: string
  text: string
  textSha256: string
  untrustedSourceData: true
}

export class SourceMaterializer {
  constructor(readonly store: LegalResearchStore) {}

  async captureText(input: {
    matterId: string
    title: string
    text: string
    origin: string
    kind?: "upload" | "web" | "courtlistener" | "tool"
    sourceId?: string
  }) {
    const bytes = new TextEncoder().encode(input.text)
    const source = await this.store.materialize({
      matterId: input.matterId,
      sourceId: input.sourceId,
      title: input.title,
      kind: input.kind ?? "tool",
      mime: "text/plain",
      bytes,
      origin: input.origin,
    })
    this.store.addRepresentation({
      sourceVersionId: source.sourceVersionId,
      parserName: "legalbuilder-plain-text",
      parserVersion: "1",
      mode: "structural",
      normalizedTextSha256: hashText(input.text),
      passages: [{ sourceRef: "#/content", order: 0, text: input.text, startOffset: 0, endOffset: input.text.length }],
    })
    const passage = this.store
      .passagesForMatter(input.matterId)
      .find((candidate) => candidate.source_version_id === source.sourceVersionId)
    if (!passage) throw new Error("Materialization did not persist a passage")
    return this.store.passageForContext(input.matterId, passage.id)
  }

  async captureWebResponse(input: {
    matterId: string
    title: string
    requestedUrl: string
    finalUrl: string
    canonicalUrl?: string
    mime: string
    body: Uint8Array
    status?: CaptureStatus
    accessNotes?: string
    sourceId?: string
  }) {
    return this.store.materialize({
      matterId: input.matterId,
      sourceId: input.sourceId,
      title: input.title,
      kind: "web",
      mime: input.mime,
      bytes: input.body,
      origin: input.requestedUrl,
      finalUrl: input.finalUrl,
      canonicalUrl: input.canonicalUrl,
      status: input.status,
      accessNotes: input.accessNotes,
    })
  }

  async interceptToolResult(input: {
    matterId: string
    connector: string
    title: string
    blocks: ToolContentBlock[]
  }): Promise<ContextPassage[]> {
    const admitted: ContextPassage[] = []
    for (const [index, block] of input.blocks.entries()) {
      if (block.type === "excluded") {
        this.store.db
          .query(
            "INSERT INTO excluded_content (id, matter_id, connector, reason, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            `exc_${randomUUID()}`,
            input.matterId,
            input.connector,
            block.reason ?? "connector content excluded",
            JSON.stringify(block.metadata ?? {}),
            new Date().toISOString(),
          )
        continue
      }
      if (block.type === "text") {
        if (typeof block.text !== "string") throw new Error(`Tool text block ${index} has no text`)
        admitted.push(
          await this.captureText({
            matterId: input.matterId,
            title: `${input.title} · block ${index + 1}`,
            text: block.text,
            origin: `tool:${input.connector}:${index}`,
          }),
        )
        continue
      }
      if (!(block.data instanceof Uint8Array) || !block.mime)
        throw new Error(`Tool resource block ${index} is incomplete`)
      const source = await this.store.materialize({
        matterId: input.matterId,
        title: block.name ?? `${input.title} · resource ${index + 1}`,
        kind: "tool",
        mime: block.mime,
        bytes: block.data,
        origin: `tool:${input.connector}:${index}`,
      })
      if (block.mime === "text/plain") {
        const text = new TextDecoder().decode(block.data)
        this.store.addRepresentation({
          sourceVersionId: source.sourceVersionId,
          parserName: "legalbuilder-plain-text",
          parserVersion: "1",
          mode: "structural",
          normalizedTextSha256: hashText(text),
          passages: [{ sourceRef: "#/content", order: 0, text }],
        })
        const passage = this.store
          .passagesForMatter(input.matterId)
          .find((candidate) => candidate.source_version_id === source.sourceVersionId)
        if (!passage) throw new Error("Tool resource did not persist a passage")
        admitted.push(this.store.passageForContext(input.matterId, passage.id))
      }
    }
    return admitted
  }
}
