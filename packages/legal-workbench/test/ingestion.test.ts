import { describe, expect, test } from "bun:test"
import { workerEnvironment } from "../src/ingestion"

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
})
