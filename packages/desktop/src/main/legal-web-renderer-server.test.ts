import { afterEach, describe, expect, test } from "bun:test"
import { startLegalWebRendererServer } from "./legal-web-renderer-server"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe("strict visual renderer loopback service", () => {
  test("requires its memory-only bearer token and returns the bounded capture contract", async () => {
    const token = "a".repeat(64)
    const service = await startLegalWebRendererServer(
      async (url) => ({
        finalUrl: url,
        status: 200,
        html: new TextEncoder().encode("<html><body>Authority</body></html>"),
        screenshot: new Uint8Array([137, 80, 78, 71]),
        screenshotMime: "image/png",
      }),
      { token },
    )
    cleanups.push(service.listener.stop)

    const health = await fetch(`${service.url}/health`)
    expect(await health.json()).toEqual({
      service: "legalbuilder-web-renderer",
      contractVersion: 1,
      status: "ok",
    })

    const unauthorized = await fetch(`${service.url}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://authority.example/" }),
    })
    expect(unauthorized.status).toBe(401)

    const rendered = await fetch(`${service.url}/render`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: "https://authority.example/" }),
    })
    expect(rendered.status).toBe(200)
    expect(await rendered.json()).toMatchObject({
      contractVersion: 1,
      finalUrl: "https://authority.example/",
      status: 200,
      screenshotMime: "image/png",
    })
  })
})
