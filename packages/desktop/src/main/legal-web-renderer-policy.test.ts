import { describe, expect, test } from "bun:test"
import { rendererRequestDecision } from "./legal-web-renderer-policy"

const publicResolver = async () => ["93.184.216.34"]

describe("strict visual renderer network policy", () => {
  test("allows passive public assets and in-document data", async () => {
    await expect(
      rendererRequestDecision(
        { url: "https://authority.example/opinion.css", method: "GET", resourceType: "stylesheet" },
        publicResolver,
      ),
    ).resolves.toEqual({ allow: true })
    await expect(
      rendererRequestDecision({ url: "data:image/png;base64,AA==", method: "GET", resourceType: "image" }),
    ).resolves.toEqual({ allow: true })
  })

  test("blocks private targets, active exfiltration channels, frames, and writes", async () => {
    await expect(
      rendererRequestDecision(
        { url: "http://metadata.local/latest", method: "GET", resourceType: "image" },
        async () => ["169.254.169.254"],
      ),
    ).resolves.toMatchObject({ allow: false, reason: expect.stringContaining("private") })
    for (const resourceType of ["xhr", "webSocket", "ping", "subFrame"]) {
      await expect(
        rendererRequestDecision(
          { url: "https://authority.example/active", method: "GET", resourceType },
          publicResolver,
        ),
      ).resolves.toMatchObject({ allow: false })
    }
    await expect(
      rendererRequestDecision(
        { url: "https://authority.example/upload", method: "POST", resourceType: "other" },
        publicResolver,
      ),
    ).resolves.toMatchObject({ allow: false, reason: expect.stringContaining("method") })
  })
})
