import { describe, expect, test } from "bun:test"
import { legalWorkbenchUrl } from "./legal-workbench-url"

describe("legal workbench URL", () => {
  test("defaults to the local supervised workbench", () => {
    expect(legalWorkbenchUrl()).toBe("http://127.0.0.1:3212")
  })

  test("accepts explicit HTTP deployments and rejects active schemes", () => {
    expect(legalWorkbenchUrl("https://legal.example.test/research/")).toBe("https://legal.example.test/research")
    expect(legalWorkbenchUrl("javascript:alert(1)")).toBe("http://127.0.0.1:3212")
    expect(legalWorkbenchUrl("not a URL")).toBe("http://127.0.0.1:3212")
  })
})
