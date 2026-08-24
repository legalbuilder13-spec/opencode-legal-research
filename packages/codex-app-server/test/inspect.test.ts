import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { inspect, verify } from "../src/inspect"

const fixture = fileURLToPath(new URL("./fixture/fake-app-server.ts", import.meta.url))
const command = [process.execPath, fixture]

describe("Codex app-server protocol compatibility", () => {
  test("fingerprints generated protocol schemas deterministically", async () => {
    const first = await inspect(command)
    const second = await inspect(command)
    expect(first).toEqual(second)
    expect(first).toMatchObject({ codexVersion: "codex-cli fake-1.0.0", schemaFileCount: 1 })
    expect(first.executableHash).toHaveLength(64)
    expect(first.schemaHash).toHaveLength(64)
  })

  test("rejects a changed schema manifest", async () => {
    const actual = await inspect(command)
    expect(() => verify(actual, actual)).not.toThrow()
    expect(() => verify(actual, { ...actual, schemaHash: "changed" })).toThrow("compatibility check failed")
  })
})
