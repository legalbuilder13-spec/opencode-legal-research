import { publicHttpUrl, type PublicAddressResolver } from "@legalbuilder/legal-research-core/public-network"

const BLOCKED_RESOURCE_TYPES = new Set(["cspReport", "media", "object", "ping", "subFrame", "webSocket", "xhr"])

export interface RendererRequest {
  url: string
  method: string
  resourceType: string
}

export type RendererRequestDecision = { allow: true } | { allow: false; reason: string }

export async function rendererRequestDecision(
  request: RendererRequest,
  resolver?: PublicAddressResolver,
): Promise<RendererRequestDecision> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return { allow: false, reason: `blocked method: ${request.method}` }
  if (BLOCKED_RESOURCE_TYPES.has(request.resourceType))
    return { allow: false, reason: `blocked resource type: ${request.resourceType}` }
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return { allow: false, reason: "invalid request URL" }
  }
  if ((url.protocol === "data:" || url.protocol === "blob:") && request.resourceType !== "mainFrame")
    return { allow: true }
  try {
    await publicHttpUrl(request.url, resolver)
    return { allow: true }
  } catch (error) {
    return { allow: false, reason: error instanceof Error ? error.message : "blocked network target" }
  }
}
