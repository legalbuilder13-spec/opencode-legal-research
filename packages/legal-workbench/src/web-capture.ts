import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

const MAX_REDIRECTS = 5
const MAX_HTML_BYTES = 20 * 1024 * 1024
const MAX_SCREENSHOT_BYTES = 40 * 1024 * 1024

export type WebCaptureMode = "structural" | "strict_visual"
export type WebCaptureFetcher = (url: string, init: RequestInit) => Promise<Response>
export type WebAddressResolver = (hostname: string) => Promise<string[]>

export interface RenderedWebCapture {
  finalUrl: string
  status: number
  html: Uint8Array
  screenshot: Uint8Array
  screenshotMime: "image/png" | "image/jpeg"
}

export type WebCaptureRenderer = (url: string) => Promise<RenderedWebCapture>

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
    this.resolver = options.resolver ?? resolveAddresses
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

async function resolveAddresses(hostname: string) {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address)
}

export async function publicUrl(value: string, resolver: WebAddressResolver = resolveAddresses) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Enter a valid public HTTP(S) URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only public HTTP(S) URLs are allowed")
  if (url.username || url.password) throw new Error("URL credentials are not allowed")
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Only standard HTTP(S) ports are allowed")
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost"))
    throw new Error("Local and private URLs are not allowed")
  const addresses = isIP(hostname) ? [hostname] : await resolver(hostname)
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address)))
    throw new Error("Local, private, and reserved network addresses are not allowed")
  url.hash = ""
  return url
}

function isPublicAddress(value: string): boolean {
  if (value.includes(":")) {
    const address = value.toLowerCase()
    if (address === "::" || address === "::1" || address.startsWith("fc") || address.startsWith("fd")) return false
    if (/^fe[89ab]/.test(address) || address.startsWith("ff") || address.startsWith("2001:db8:")) return false
    const mapped = mappedIpv4(address)
    return mapped ? isPublicAddress(mapped) : true
  }
  const parts = value.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a = 0, b = 0, c = 0] = parts
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0) return false
  if (a === 192 && b === 0 && c === 2) return false
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function mappedIpv4(address: string) {
  const suffix = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : undefined
  if (!suffix) return undefined
  if (/^\d+\.\d+\.\d+\.\d+$/.test(suffix)) return suffix
  const groups = suffix.split(":")
  if (groups.length !== 2 || groups.some((group) => !/^[a-f0-9]{1,4}$/.test(group))) return undefined
  const high = Number.parseInt(groups[0] ?? "", 16)
  const low = Number.parseInt(groups[1] ?? "", 16)
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
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
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
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
