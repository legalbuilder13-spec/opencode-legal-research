import { describe, expect, test } from "bun:test"
import {
  httpWebCaptureRenderer,
  publicUrl,
  rendererHealth,
  WebCaptureService,
  WebCaptureUnavailableError,
} from "../src/web-capture"

const publicResolver = async () => ["93.184.216.34"]

describe("public web capture boundary", () => {
  test("SRC-02 follows bounded public redirects and records canonical structural HTML", async () => {
    const requests: string[] = []
    const service = new WebCaptureService({
      resolver: publicResolver,
      fetcher: async (url) => {
        requests.push(url)
        if (url === "https://example.test/start")
          return new Response(null, { status: 302, headers: { location: "/final" } })
        return new Response(
          '<html><head><title>Public authority</title><link href="/canonical" rel="canonical"></head><body>Law</body></html>',
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        )
      },
    })
    const captured = await service.capture({ url: "https://example.test/start", mode: "structural" })
    expect(requests).toEqual(["https://example.test/start", "https://example.test/final"])
    expect(captured).toMatchObject({
      title: "Public authority",
      requestedUrl: "https://example.test/start",
      finalUrl: "https://example.test/final",
      canonicalUrl: "https://example.test/canonical",
    })
  })

  test("SEC-02 rejects local, private, credentialed, and nonstandard-port URLs before fetch", async () => {
    for (const url of [
      "http://127.0.0.1/admin",
      "http://[::1]/admin",
      "http://[::ffff:7f00:1]/admin",
      "http://10.0.0.8/source",
      "http://user:password@example.test/",
      "https://example.test:8443/",
      "file:///etc/passwd",
    ]) {
      await expect(publicUrl(url, publicResolver)).rejects.toThrow()
    }
    await expect(publicUrl("https://private.example/", async () => ["192.168.1.2"])).rejects.toThrow("private")
  })

  test("ING-04 fails visibly when strict visual capture has no supervised renderer", async () => {
    const service = new WebCaptureService({ resolver: publicResolver })
    await expect(service.capture({ url: "https://example.test/", mode: "strict_visual" })).rejects.toBeInstanceOf(
      WebCaptureUnavailableError,
    )
  })

  test("ING-04 consumes only the authenticated loopback renderer contract", async () => {
    const token = "b".repeat(64)
    const requests: Array<{ url: string; authorization?: string }> = []
    const fetcher = async (url: string, init: RequestInit) => {
      requests.push({ url, authorization: new Headers(init.headers).get("authorization") ?? undefined })
      if (url.endsWith("/health"))
        return Response.json({ service: "legalbuilder-web-renderer", contractVersion: 1, status: "ok" })
      return Response.json({
        contractVersion: 1,
        finalUrl: "https://authority.example/final",
        status: 200,
        htmlBase64: Buffer.from("<html><title>Rendered authority</title><body>Rule</body></html>").toString("base64"),
        screenshotBase64: Buffer.from([137, 80, 78, 71]).toString("base64"),
        screenshotMime: "image/png",
      })
    }
    expect(await rendererHealth({ endpoint: "http://127.0.0.1:4321", fetcher })).toBe(true)
    const renderer = httpWebCaptureRenderer({ endpoint: "http://127.0.0.1:4321", token, fetcher })
    const captured = await new WebCaptureService({ resolver: publicResolver, renderer }).capture({
      url: "https://authority.example/start",
      mode: "strict_visual",
    })
    expect(captured).toMatchObject({
      title: "Rendered authority",
      requestedUrl: "https://authority.example/start",
      finalUrl: "https://authority.example/final",
      screenshot: { mime: "image/png" },
    })
    expect(requests.at(-1)?.authorization).toBe(`Bearer ${token}`)
    expect(() => httpWebCaptureRenderer({ endpoint: "https://remote.example", token })).toThrow("loopback")
  })
})
