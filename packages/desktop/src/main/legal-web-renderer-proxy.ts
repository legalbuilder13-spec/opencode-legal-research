import { publicHttpTarget, type PublicAddressResolver } from "@legalbuilder/legal-research-core/public-network"
import {
  createServer,
  request as createHttpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { connect as connectSocket, isIP, type Socket } from "node:net"
import type { Duplex } from "node:stream"

import type { SidecarListener } from "./server"

const MAX_TOTAL_BYTES = 128 * 1024 * 1024
const MAX_TUNNEL_BYTES = 128 * 1024 * 1024
const MAX_HTTP_RESPONSE_BYTES = 25 * 1024 * 1024
const SOCKET_TIMEOUT_MS = 30_000

export interface PinnedProxyDialTarget {
  hostname: string
  address: string
  port: number
  family: 4 | 6
}

export type PinnedProxyDialer = (target: PinnedProxyDialTarget) => Socket

export async function startPinnedWebProxy(
  options: {
    resolver?: PublicAddressResolver
    dialer?: PinnedProxyDialer
    port?: number
  } = {},
): Promise<{ url: string; listener: SidecarListener }> {
  const resolver = options.resolver
  const dialer = options.dialer ?? defaultDialer
  const sockets = new Set<Duplex>()
  let totalBytes = 0
  let stopped = false

  const server = createServer((request, response) => {
    void handleHttpRequest(request, response).catch((error: unknown) => {
      failHttp(response, error)
    })
  })
  server.maxHeadersCount = 100
  server.headersTimeout = 5_000
  server.requestTimeout = SOCKET_TIMEOUT_MS
  server.keepAliveTimeout = 1_000
  server.on("connection", trackSocket)
  server.on("connect", (request, client, head) => {
    void handleTunnel(request, client, head).catch((error: unknown) => {
      failSocket(client, error)
    })
  })
  server.on("upgrade", (_request, socket) => failSocket(socket, new Error("Proxy upgrades are not allowed"), 405))

  async function handleHttpRequest(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== "GET" && request.method !== "HEAD") throw new Error("Proxy permits only GET and HEAD")
    if (request.headers["transfer-encoding"] || Number(request.headers["content-length"] ?? 0) > 0)
      throw new Error("Proxy request bodies are not allowed")
    const target = await publicHttpTarget(request.url ?? "", resolver)
    if (target.url.protocol !== "http:") throw new Error("HTTPS must use a pinned CONNECT tunnel")
    const address = selectedAddress(target.addresses)
    const port = 80
    const outbound = createHttpRequest({
      method: request.method,
      hostname: address,
      family: isIP(address),
      port,
      path: `${target.url.pathname}${target.url.search}`,
      headers: forwardedHeaders(request.headers, target.url.host),
      agent: false,
    })
    outbound.setTimeout(SOCKET_TIMEOUT_MS, () => outbound.destroy(new Error("Pinned proxy request timed out")))
    request.once("aborted", () => outbound.destroy())
    response.once("close", () => outbound.destroy())
    outbound.once("response", (upstream) => {
      response.writeHead(upstream.statusCode ?? 502, upstream.statusMessage, responseHeaders(upstream.headers))
      let responseBytes = 0
      upstream.on("data", (chunk: Buffer) => {
        responseBytes += chunk.byteLength
        if (!consume(chunk.byteLength) || responseBytes > MAX_HTTP_RESPONSE_BYTES)
          upstream.destroy(new Error("Pinned proxy response exceeded its limit"))
      })
      upstream.once("error", (error) => response.destroy(error))
      upstream.pipe(response)
    })
    outbound.once("error", (error) => failHttp(response, error))
    outbound.end()
  }

  async function handleTunnel(request: IncomingMessage, client: Duplex, head: Buffer) {
    const target = await connectTarget(request.url ?? "", resolver)
    const address = selectedAddress(target.addresses)
    const upstream = trackedDial(target.url.hostname, address, 443)
    upstream.setTimeout(SOCKET_TIMEOUT_MS, () => upstream.destroy(new Error("Pinned proxy tunnel timed out")))
    await connected(upstream)
    client.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: LegalBuilderPinnedProxy/1\r\n\r\n")
    let tunnelBytes = head.byteLength
    if (head.byteLength) {
      if (!consume(head.byteLength)) throw new Error("Pinned proxy capture exceeded its aggregate byte limit")
      upstream.write(head)
    }
    const count = (chunk: Buffer) => {
      tunnelBytes += chunk.byteLength
      if (!consume(chunk.byteLength) || tunnelBytes > MAX_TUNNEL_BYTES) {
        upstream.destroy(new Error("Pinned proxy tunnel exceeded its limit"))
        client.destroy()
      }
    }
    client.on("data", count)
    upstream.on("data", count)
    client.once("error", () => upstream.destroy())
    upstream.once("error", () => client.destroy())
    client.pipe(upstream)
    upstream.pipe(client)
  }

  function selectedAddress(addresses: string[]) {
    const address = addresses.find((value) => isIP(value) === 4) ?? addresses[0]
    if (!address || !isIP(address)) throw new Error("Public target did not resolve to a usable IP address")
    return address
  }

  function trackedDial(hostname: string, address: string, port: number) {
    const family = isIP(address)
    if (family !== 4 && family !== 6) throw new Error("Pinned proxy selected an invalid IP address")
    const socket = dialer({ hostname, address, port, family })
    trackSocket(socket)
    return socket
  }

  function trackSocket(socket: Duplex) {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
  }

  function consume(bytes: number) {
    totalBytes += bytes
    if (totalBytes > MAX_TOTAL_BYTES) {
      for (const socket of sockets) socket.destroy()
      return false
    }
    return true
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port ?? 0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("Pinned proxy did not bind an isolated loopback port")
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    listener: {
      stop: async () => {
        if (stopped) return
        stopped = true
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve, reject) =>
          server.close((error) => {
            if (error) reject(error)
            else resolve()
          }),
        )
      },
    },
  }
}

async function connectTarget(value: string, resolver?: PublicAddressResolver) {
  const match = value.match(/^\[([0-9a-f:.]+)\]:(\d+)$/i) ?? value.match(/^([^:[\]@/?#]+):(\d+)$/)
  if (!match || Number(match[2]) !== 443) throw new Error("Proxy permits CONNECT only to public HTTPS port 443")
  let authority: URL
  try {
    authority = new URL(`https://${value}/`)
  } catch {
    throw new Error("Proxy received an invalid CONNECT authority")
  }
  if (authority.username || authority.password || authority.pathname !== "/")
    throw new Error("Proxy permits CONNECT only to public HTTPS port 443")
  return publicHttpTarget(authority.toString(), resolver)
}

function defaultDialer(target: PinnedProxyDialTarget) {
  return connectSocket({ host: target.address, port: target.port, family: target.family })
}

function connected(socket: Socket) {
  if (socket.readyState === "open") return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  })
}

function forwardedHeaders(headers: IncomingHttpHeaders, host: string) {
  const result: Record<string, string | string[] | undefined> = { ...headers, host }
  for (const name of [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ])
    delete result[name]
  return result
}

function responseHeaders(headers: IncomingHttpHeaders) {
  const result: Record<string, string | string[] | undefined> = { ...headers }
  for (const name of [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-connection",
    "transfer-encoding",
    "upgrade",
  ])
    delete result[name]
  return result
}

function failHttp(response: ServerResponse, error: unknown) {
  if (response.destroyed || response.writableEnded) return
  const message = error instanceof Error ? error.message : "Pinned proxy request failed"
  if (response.headersSent) {
    response.destroy()
    return
  }
  response.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" })
  response.end(message)
}

function failSocket(socket: Duplex, error: unknown, status = 502) {
  if (socket.destroyed) return
  const message = error instanceof Error ? error.message : "Pinned proxy tunnel failed"
  socket.end(`HTTP/1.1 ${status} Proxy Error\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`)
}
