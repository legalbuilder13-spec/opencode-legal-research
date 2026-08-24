import { randomBytes, timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import type { SidecarListener } from "./server"

const MAX_REQUEST_BYTES = 4 * 1024

export interface LegalWebRenderResult {
  finalUrl: string
  status: number
  html: Uint8Array
  screenshot: Uint8Array
  screenshotMime: "image/png"
}

export type LegalWebRenderBackend = (url: string) => Promise<LegalWebRenderResult>

export async function startLegalWebRendererServer(
  render: LegalWebRenderBackend,
  options: { token?: string; port?: number } = {},
): Promise<{ url: string; token: string; listener: SidecarListener }> {
  const token = options.token ?? randomBytes(32).toString("hex")
  let active = false
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Strict visual rendering failed"
      json(response, 502, { error: message })
    })
  })

  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { service: "legalbuilder-web-renderer", contractVersion: 1, status: "ok" })
      return
    }
    if (request.method !== "POST" || request.url !== "/render") {
      json(response, 404, { error: "Not found" })
      return
    }
    if (request.headers.origin || !authorized(request.headers.authorization, token)) {
      json(response, 401, { error: "Unauthorized" })
      return
    }
    if (active) {
      json(response, 429, { error: "A strict visual capture is already running" })
      return
    }
    const body: unknown = JSON.parse((await requestBody(request)).toString("utf8"))
    if (!isRecord(body) || typeof body.url !== "string" || !body.url || body.url.length > 2_048) {
      json(response, 400, { error: "A bounded URL is required" })
      return
    }
    active = true
    try {
      const result = await render(body.url)
      json(response, 200, {
        contractVersion: 1,
        finalUrl: result.finalUrl,
        status: result.status,
        htmlBase64: Buffer.from(result.html).toString("base64"),
        screenshotBase64: Buffer.from(result.screenshot).toString("base64"),
        screenshotMime: result.screenshotMime,
      })
    } finally {
      active = false
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port ?? 0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("Strict visual renderer did not bind an isolated loopback port")
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    listener: {
      stop: () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => {
            if (error) reject(error)
            else resolve()
          }),
        ),
    },
  }
}

function authorized(value: string | undefined, token: string) {
  const expected = Buffer.from(`Bearer ${token}`)
  const received = Buffer.from(value ?? "")
  return expected.length === received.length && timingSafeEqual(expected, received)
}

function requestBody(request: IncomingMessage) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on("data", (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error(`Renderer request exceeds ${MAX_REQUEST_BYTES} bytes`))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => resolve(Buffer.concat(chunks)))
    request.on("error", reject)
  })
}

function json(response: ServerResponse, status: number, value: unknown) {
  if (response.headersSent) return
  const body = JSON.stringify(value)
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  })
  response.end(body)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
