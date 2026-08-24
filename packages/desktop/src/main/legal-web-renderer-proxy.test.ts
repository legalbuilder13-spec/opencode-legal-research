import { afterEach, describe, expect, test } from "bun:test"
import { createServer, request as createRequest } from "node:http"
import { connect, createServer as createTcpServer, type Socket } from "node:net"

import { startPinnedWebProxy, type PinnedProxyDialTarget, type PinnedProxyDialer } from "./legal-web-renderer-proxy"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.allSettled(
    cleanups
      .splice(0)
      .reverse()
      .map((cleanup) => cleanup()),
  )
})

describe("strict visual renderer pinned proxy", () => {
  test("pins CONNECT traffic to the single public address returned by validation", async () => {
    const tunnelDestination = createTcpServer((socket) => socket.pipe(socket))
    const tunnelPort = await listen(tunnelDestination)
    cleanups.push(() => close(tunnelDestination))

    const dialed: PinnedProxyDialTarget[] = []
    const dialer: PinnedProxyDialer = (target) => {
      dialed.push(target)
      return connect(tunnelPort, "127.0.0.1")
    }
    const proxy = await startPinnedWebProxy({ resolver: async () => ["93.184.216.34"], dialer })
    cleanups.push(proxy.listener.stop)

    const tunnel = await openTunnel(proxy.url, "authority.test:443")
    expect(tunnel.headers).toContain("200 Connection Established")
    tunnel.socket.write("pinned-tunnel")
    expect(await readChunk(tunnel.socket)).toBe("pinned-tunnel")
    tunnel.socket.destroy()
    expect(dialed[0]).toEqual({ hostname: "authority.test", address: "93.184.216.34", port: 443, family: 4 })
  })

  test("fails closed when a later lookup rebinds to a private address", async () => {
    const destination = createTcpServer((socket) => socket.pipe(socket))
    const destinationPort = await listen(destination)
    cleanups.push(() => close(destination))
    let lookups = 0
    let connections = 0
    const proxy = await startPinnedWebProxy({
      resolver: async () => (++lookups === 1 ? ["93.184.216.34"] : ["127.0.0.1"]),
      dialer: () => {
        connections += 1
        return connect(destinationPort, "127.0.0.1")
      },
    })
    cleanups.push(proxy.listener.stop)

    const first = await openTunnel(proxy.url, "rebind.test:443")
    expect(first.headers).toContain("200 Connection Established")
    first.socket.destroy()
    const blocked = await openTunnel(proxy.url, "rebind.test:443")
    expect(blocked.headers).toContain("502 Proxy Error")
    blocked.socket.destroy()
    expect(connections).toBe(1)

    const privateHttp = await proxyRequest(proxy.url, "http://rebind.test/blocked")
    expect(privateHttp.status).toBe(502)
    expect(privateHttp.body).toContain("private")
  })
})

async function proxyRequest(proxy: string, target: string) {
  const endpoint = new URL(proxy)
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = createRequest({
      hostname: endpoint.hostname,
      port: endpoint.port,
      method: "GET",
      path: target,
      headers: { host: new URL(target).host },
      agent: false,
    })
    request.once("error", reject)
    request.once("response", (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk: Buffer) => chunks.push(chunk))
      response.once("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }))
      response.once("error", reject)
    })
    request.end()
  })
}

async function openTunnel(proxy: string, authority: string) {
  const endpoint = new URL(proxy)
  const socket = connect(Number(endpoint.port), endpoint.hostname)
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  })
  socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`)
  let headers = ""
  while (!headers.includes("\r\n\r\n")) headers += await readChunk(socket)
  return { socket, headers }
}

function readChunk(socket: Socket) {
  return new Promise<string>((resolve, reject) => {
    socket.once("data", (chunk) => resolve(chunk.toString()))
    socket.once("error", reject)
  })
}

function listen(server: ReturnType<typeof createServer> | ReturnType<typeof createTcpServer>) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") reject(new Error("Test server did not bind a port"))
      else resolve(address.port)
    })
  })
}

function close(server: ReturnType<typeof createServer> | ReturnType<typeof createTcpServer>) {
  return new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    }),
  )
}
