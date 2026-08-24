import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { discoverEvidenceWorkerRuntime } from "../src/worker-runtime"

const hash = "0".repeat(64)

describe("packaged evidence worker discovery", () => {
  test("accepts a contained, complete offline runtime", async () => {
    const root = await fixtureRuntime()
    const discovery = discoverEvidenceWorkerRuntime(root)
    expect(discovery.status).toBe("ready")
    if (discovery.status !== "ready") return
    expect(discovery.runtime).toMatchObject({
      kind: "packaged",
      ocrEngine: "rapidocr",
      ocrLanguages: ["latin"],
    })
    expect(discovery.runtime.python).toBe(join(root, "python", "bin", "python3"))
    expect(discovery.runtime.artifactsPath).toBe(join(root, "models"))
  })

  test("rejects an escaping executable path", async () => {
    const root = await fixtureRuntime({ executable: "../python" })
    expect(discoverEvidenceWorkerRuntime(root)).toMatchObject({
      status: "unavailable",
      detail: expect.stringContaining("escapes"),
    })
  })

  test("does not advertise a model-free package as ready", async () => {
    const root = await fixtureRuntime({ included: false })
    expect(discoverEvidenceWorkerRuntime(root)).toMatchObject({
      status: "unavailable",
      detail: expect.stringContaining("model artifacts"),
    })
  })
})

async function fixtureRuntime(overrides: { executable?: string; included?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "legal-evidence-runtime-test-"))
  await mkdir(join(root, "python", "bin"), { recursive: true })
  await mkdir(join(root, "legal_evidence_worker"), { recursive: true })
  await mkdir(join(root, "models"), { recursive: true })
  await Bun.write(join(root, "python", "bin", "python3"), "fixture")
  await Bun.write(join(root, "legal_evidence_worker", "cli.py"), "# fixture\n")
  await Bun.write(
    join(root, "runtime-manifest.json"),
    `${JSON.stringify(
      {
        contractVersion: 1,
        runtime: "legalbuilder-evidence-worker",
        python: { executable: overrides.executable ?? "python/bin/python3", version: "3.14.3" },
        packageRoot: ".",
        models: { path: "models", included: overrides.included ?? true, sha256: hash },
        ocr: { engine: "rapidocr", backend: "torch", languages: ["latin"] },
        lockSha256: hash,
      },
      null,
      2,
    )}\n`,
  )
  return root
}
