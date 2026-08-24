import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWorkbench } from "../src/app"

const close: Array<() => void> = []

afterEach(() => {
  for (const stop of close.splice(0)) stop()
})

async function fixture() {
  const dataRoot = await mkdtemp(join(tmpdir(), "legal-workbench-test-"))
  const workbench = await createWorkbench({ dataRoot, fixtureAccount: true })
  close.push(workbench.close)
  return workbench
}

async function call(handler: (request: Request) => Promise<Response>, path: string, init?: RequestInit) {
  return handler(
    new Request(`http://workbench.test${path}`, {
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    }),
  )
}

describe("legal workbench integration", () => {
  test("WB-01 serves the usable shell and subscription fixture", async () => {
    const { handler } = await fixture()
    const shell = await call(handler, "/")
    expect(shell.status).toBe(200)
    expect(await shell.text()).toContain("Review exact evidence")

    const account = await call(handler, "/api/account")
    expect(await account.json()).toEqual({ mode: "subscription", planType: "fixture", apiKeyRequired: false })
  })

  test("WB-02 completes matter, evidence, research, citation, and export workflow", async () => {
    const { handler } = await fixture()
    const createMatter = await call(handler, "/api/matters", {
      method: "POST",
      body: JSON.stringify({
        name: "Synthetic immunity matter",
        jurisdiction: "9th Cir.",
        researchAsOf: "2026-08-23",
        confidentiality: "privileged",
      }),
    })
    expect(createMatter.status).toBe(201)
    const matter = record(await createMatter.json(), "matter")
    const matterId = string(matter.id, "matter id")

    const capture = await call(handler, `/api/matters/${matterId}/sources`, {
      method: "POST",
      body: JSON.stringify({
        title: "Synthetic qualified-immunity authority",
        text: "Qualified immunity is denied when controlling precedent clearly establishes the asserted right. A narrow exception applies to obvious constitutional violations.",
      }),
    })
    expect(capture.status).toBe(201)
    expect(await capture.json()).toHaveProperty("untrustedSourceData", true)

    const sources = await call(handler, `/api/matters/${matterId}/sources`)
    const sourceList = array(await sources.json(), "source list").map((source) => record(source, "source"))
    expect(sourceList).toHaveLength(1)
    expect(sourceList[0]?.capture_status).toBe("complete")
    expect(sourceList[0]?.content_sha256).toHaveLength(64)

    const plan = await call(handler, `/api/matters/${matterId}/plan`, {
      method: "POST",
      body: JSON.stringify({ question: "When is qualified immunity denied?", proceduralPosture: "summary judgment" }),
    })
    expect(await plan.json()).toHaveProperty("lanes.1.kind", "adverse")

    const research = await call(handler, `/api/matters/${matterId}/research`, {
      method: "POST",
      body: JSON.stringify({ question: "qualified immunity controlling precedent exception" }),
    })
    const ranked = record(await research.json(), "research result")
    const ordinary = record(ranked.ordinary, "ordinary result")
    const firstResult = record(array(ordinary.results, "ranked results")[0], "first ranked result")
    expect(firstResult.sourceTitle).toBe("Synthetic qualified-immunity authority")
    expect(firstResult.supportEligible).toBe(true)

    const bootstrap = await call(handler, "/api/bootstrap")
    const state = record(await bootstrap.json(), "bootstrap")
    expect(state.selectedMatterId).toBe(matterId)
    const citationDemo = record(state.citationDemo, "citation demo")
    const firstCitation = record(array(citationDemo.citations, "citations")[0], "first citation")
    const citationId = string(firstCitation.citationId, "citation id")
    const citation = await call(handler, `/api/citations/${citationId}`)
    expect(await citation.json()).toHaveProperty("evidence.length", 2)

    const receipt = await call(handler, `/api/matters/${matterId}/export`)
    expect(receipt.headers.get("Content-Disposition")).toContain("provenance.json")
    const exported = record(await receipt.json(), "export receipt")
    expect(record(exported.matter, "exported matter").id).toBe(matterId)
    expect(array(exported.sources, "exported sources")).toHaveLength(1)
    expect(array(exported.retrievalRuns, "exported retrieval runs").length).toBeGreaterThanOrEqual(2)
  })

  test("WB-03 rejects cross-matter source access", async () => {
    const { handler } = await fixture()
    const response = await call(handler, "/api/matters/mat_missing/sources")
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Unknown matter: mat_missing" })
  })
})

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected ${name}`)
  return Object.fromEntries(Object.entries(value))
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${name}`)
  return value
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`Expected ${name}`)
  return value
}
