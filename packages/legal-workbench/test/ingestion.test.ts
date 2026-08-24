import { describe, expect, test } from "bun:test"
import { workerEnvironment } from "../src/ingestion"
import type { EvidenceWorkerRuntime } from "../src/worker-runtime"

describe("evidence worker process boundary", () => {
  test("SEC-02 forwards runtime paths but excludes credentials and application secrets", () => {
    const environment = workerEnvironment({
      PATH: "/usr/bin",
      HOME: "/tmp/legal-worker-home",
      LANG: "en_US.UTF-8",
      OPENAI_API_KEY: "must-not-cross",
      COURTLISTENER_TOKEN: "must-not-cross",
      AWS_SECRET_ACCESS_KEY: "must-not-cross",
      DATABASE_URL: "must-not-cross",
    })
    expect(environment).toEqual({
      PYTHONPATH: ".",
      PYTHONNOUSERSITE: "1",
      PATH: "/usr/bin",
      HOME: "/tmp/legal-worker-home",
      LANG: "en_US.UTF-8",
    })
    expect(JSON.stringify(environment)).not.toContain("must-not-cross")
  })

  test("pins packaged inference to its local models without forwarding credentials", () => {
    const runtime: EvidenceWorkerRuntime = {
      kind: "packaged",
      root: "/opt/legal-worker",
      python: "/opt/legal-worker/python/bin/python3",
      packageRoot: "/opt/legal-worker",
      artifactsPath: "/opt/legal-worker/models",
      ocrEngine: "rapidocr",
      ocrLanguages: ["latin"],
    }
    const environment = workerEnvironment({ OPENAI_API_KEY: "must-not-cross" }, runtime)
    expect(environment).toMatchObject({
      PYTHONPATH: "/opt/legal-worker",
      DOCLING_ARTIFACTS_PATH: "/opt/legal-worker/models",
      LEGAL_EVIDENCE_OCR_ENGINE: "rapidocr",
      LEGAL_EVIDENCE_OCR_LANGUAGES: "latin",
      HF_HUB_OFFLINE: "1",
      HF_HUB_DISABLE_TELEMETRY: "1",
      TRANSFORMERS_OFFLINE: "1",
    })
    expect(JSON.stringify(environment)).not.toContain("must-not-cross")
  })
})
