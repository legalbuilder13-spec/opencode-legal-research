import {
  publicHttpUrl as publicUrl,
  resolvePublicAddresses,
  type PublicAddressResolver as WebAddressResolver,
} from "@legalbuilder/legal-research-core/public-network"

export { publicUrl }
export type { WebAddressResolver }

const MAX_REDIRECTS = 5
const MAX_HTML_BYTES = 20 * 1024 * 1024
const MAX_SCREENSHOT_BYTES = 40 * 1024 * 1024
const MAX_RENDERER_RESPONSE_BYTES = 84 * 1024 * 1024

export type WebCaptureMode = "structural" | "strict_visual"
export type WebCaptureFetcher = (url: string, init: RequestInit) => Promise<Response>

export interface RenderedWebCapture {
  finalUrl: string
  status: number
  html: Uint8Array
  screenshot: Uint8Array
  screenshotMime: "image/png" | "image/jpeg"
}

export type WebCaptureRenderer = (url: string) => Promise<RenderedWebCapture>

export function httpWebCaptureRenderer(options: {
  endpoint: string
  token: string
  fetcher?: WebCaptureFetcher
}): WebCaptureRenderer {
  const endpoint = rendererEndpoint(options.endpoint)
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init))
  if (options.token.length < 32) throw new Error("Supervised renderer token is invalid")
  return async (url) => {
    const response = await fetcher(new URL("/render", endpoint).toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(45_000),
    })
    const body = JSON.parse(new TextDecoder().decode(await responseBytes(response, MAX_RENDERER_RESPONSE_BYTES)))
    if (!response.ok) throw new Error(requiredString(body?.error, "renderer error"))
    if (body?.contractVersion !== 1 || body?.screenshotMime !== "image/png")
      throw new Error("Supervised renderer returned an unsupported contract")
    return {
      finalUrl: requiredString(body.finalUrl, "final URL"),
      status: requiredInteger(body.status, "HTTP status"),
      html: base64Bytes(body.htmlBase64, "rendered HTML"),
      screenshot: base64Bytes(body.screenshotBase64, "rendered screenshot"),
      screenshotMime: "image/png",
    }
  }
}

export async function rendererHealth(options: { endpoint: string; fetcher?: WebCaptureFetcher }) {
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init))
  try {
    const endpoint = rendererEndpoint(options.endpoint)
    const response = await fetcher(new URL("/health", endpoint).toString(), {
      method: "GET",
      signal: AbortSignal.timeout(1_000),
    })
    if (!response.ok) return false
    const value: unknown = await response.json()
    return (
      isRecord(value) &&
      value.service === "legalbuilder-web-renderer" &&
      value.contractVersion === 1 &&
      value.status === "ok"
    )
  } catch {
    return false
  }
}

export interface CapturedWebSource {
  title: string
  requestedUrl: string
  finalUrl: string
  canonicalUrl?: string
  html: Uint8Array
  screenshot?: { bytes: Uint8Array; mime: "image/png" | "image/jpeg" }
}

export class WebCaptureUnavailableError extends Error {
  readonly status = 503
}

export class WebCaptureService {
  private readonly fetcher: WebCaptureFetcher
  private readonly resolver: WebAddressResolver

  constructor(
    options: {
      fetcher?: WebCaptureFetcher
      resolver?: WebAddressResolver
      renderer?: WebCaptureRenderer
    } = {},
  ) {
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init))
    this.resolver = options.resolver ?? resolvePublicAddresses
    this.renderer = options.renderer
  }

  private readonly renderer?: WebCaptureRenderer

  async capture(input: { url: string; mode: WebCaptureMode }): Promise<CapturedWebSource> {
    const requested = await publicUrl(input.url, this.resolver)
    if (input.mode === "strict_visual") {
      if (!this.renderer)
        throw new WebCaptureUnavailableError(
          "Strict visual URL capture needs the supervised browser renderer in this installation",
        )
      const rendered = await this.renderer(requested.toString())
      const final = await publicUrl(rendered.finalUrl, this.resolver)
      if (rendered.status < 200 || rendered.status >= 300)
        throw new Error(`Rendered URL returned HTTP ${rendered.status}`)
      bounded(rendered.html, MAX_HTML_BYTES, "Rendered HTML")
      bounded(rendered.screenshot, MAX_SCREENSHOT_BYTES, "Rendered screenshot")
      const html = new TextDecoder().decode(rendered.html)
      return {
        title: documentTitle(html, final),
        requestedUrl: requested.toString(),
        finalUrl: final.toString(),
        canonicalUrl: canonicalUrl(html, final),
        html: rendered.html,
        screenshot: { bytes: rendered.screenshot, mime: rendered.screenshotMime },
      }
    }

    const fetched = await this.fetchHtml(requested)
    const html = new TextDecoder().decode(fetched.body)
    return {
      title: documentTitle(html, fetched.finalUrl),
      requestedUrl: requested.toString(),
      finalUrl: fetched.finalUrl.toString(),
      canonicalUrl: canonicalUrl(html, fetched.finalUrl),
      html: fetched.body,
    }
  }

  private async fetchHtml(requested: URL) {
    let current = requested
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      const response = await this.fetcher(current.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5",
          "user-agent": "LegalBuilderResearch/0.1 source-capture",
        },
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status >= 300 && response.status < 400) {
        if (redirect === MAX_REDIRECTS) throw new Error(`URL exceeded ${MAX_REDIRECTS} redirects`)
        const location = response.headers.get("location")
        if (!location) throw new Error(`Redirect ${response.status} did not include a location`)
        current = await publicUrl(new URL(location, current).toString(), this.resolver)
        continue
      }
      if (!response.ok) throw new Error(`URL returned HTTP ${response.status}`)
      const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
      if (mime !== "text/html" && mime !== "application/xhtml+xml" && mime !== "text/plain")
        throw new Error(`URL returned unsupported content type: ${mime || "unknown"}`)
      const finalUrl = response.url ? await publicUrl(response.url, this.resolver) : current
      return { finalUrl, body: await responseBytes(response, MAX_HTML_BYTES) }
    }
    throw new Error("URL capture ended without a response")
  }
}

async function responseBytes(response: Response, limit: number) {
  const length = Number(response.headers.get("content-length"))
  if (Number.isFinite(length) && length > limit) throw new Error(`URL body exceeds the ${limit}-byte limit`)
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error(`URL body exceeds the ${limit}-byte limit`)
    }
    chunks.push(chunk.value)
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function bounded(value: Uint8Array, limit: number, label: string) {
  if (!value.byteLength) throw new Error(`${label} is empty`)
  if (value.byteLength > limit) throw new Error(`${label} exceeds the ${limit}-byte limit`)
}

function documentTitle(html: string, url: URL) {
  const title = html
    .match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return title || url.hostname
}

function canonicalUrl(html: string, base: URL): string | undefined {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? []
    if (!rel.includes("canonical")) continue
    const href = attribute(tag, "href")
    if (!href) continue
    try {
      const url = new URL(href, base)
      if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
      url.hash = ""
      return url.toString()
    } catch {
      return undefined
    }
  }
  return undefined
}

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

function rendererEndpoint(value: string) {
  const endpoint = new URL(value)
  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    !endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Supervised renderer endpoint must be an isolated IPv4 loopback origin")
  return endpoint
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`Supervised renderer returned no ${label}`)
  return value
}

function requiredInteger(value: unknown, label: string) {
  if (!Number.isInteger(value)) throw new Error(`Supervised renderer returned an invalid ${label}`)
  return Number(value)
}

function base64Bytes(value: unknown, label: string) {
  if (typeof value !== "string" || !value || !/^[a-zA-Z0-9+/]*={0,2}$/.test(value))
    throw new Error(`Supervised renderer returned invalid ${label}`)
  return new Uint8Array(Buffer.from(value, "base64"))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
