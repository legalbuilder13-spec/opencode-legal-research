import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"

import { createLegalReleaseSbom, releaseArtifactPaths } from "./legal-release-sbom"

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe("legal release SPDX SBOM", () => {
  test("binds exact release hashes to the audited desktop, Python, and model closure", () => {
    const document = createLegalReleaseSbom({
      subjects: [{ path: "/release/app.dmg", name: "app.dmg", sha256: sha256("signed installer") }],
      created: "2026-08-24T12:00:00.000Z",
      repository: "https://github.com/legalbuilder13-spec/opencode-legal-research",
      commit: "a".repeat(40),
      desktop: {
        reviewStatus: "pending-counsel-review",
        firstParty: [{ name: "@legalbuilder/legal-workbench", version: "1.0.0" }],
        thirdParty: [
          {
            name: "@actions/core",
            version: "1.11.1",
            license: ["MIT"],
            repository: "https://github.com/actions/toolkit",
          },
        ],
      },
      worker: {
        reviewStatus: "pending-counsel-review",
        managedPython: {
          distribution: "astral-python-build-standalone",
          declaredLicense: "Python-2.0",
          source: "https://github.com/astral-sh/python-build-standalone",
          licenseFiles: [{ path: "python/LICENSE.txt", sha256: sha256("python license") }],
        },
        pythonDistributions: [
          {
            name: "docling",
            version: "2.74.0",
            licenseExpression: "MIT",
            licenseFiles: [{ path: "python/docling/LICENSE", sha256: sha256("docling license") }],
          },
        ],
        models: [
          {
            id: "layout-model",
            source: "https://huggingface.co/example/layout",
            revision: "b".repeat(40),
            declaredLicense: "Apache-2.0",
            artifacts: [{ path: "models/layout/model.safetensors", sha256: sha256("model") }],
          },
        ],
      },
    })

    expect(document.spdxVersion).toBe("SPDX-2.3")
    expect(document.documentNamespace).toMatch(
      /^https:\/\/github\.com\/legalbuilder13-spec\/opencode-legal-research\/sbom\/[a-f0-9]{64}$/,
    )
    expect(document.packages.find((item) => item.name === "app.dmg")?.checksums).toEqual([
      { algorithm: "SHA256", checksumValue: sha256("signed installer") },
    ])
    expect(document.packages.find((item) => item.name === "@actions/core")?.externalRefs?.[0]?.referenceLocator).toBe(
      "pkg:npm/%40actions/core@1.11.1",
    )
    expect(document.packages.find((item) => item.name === "docling")?.externalRefs?.[0]?.referenceLocator).toBe(
      "pkg:pypi/docling@2.74.0",
    )
    expect(document.files.map((item) => item.fileName)).toEqual([
      "./models/layout/model.safetensors",
      "./python/docling/LICENSE",
      "./python/LICENSE.txt",
    ])
    expect(document.relationships.filter((item) => item.relationshipType === "DEPENDS_ON")).toHaveLength(5)
    expect(document.comment).toContain("pending-counsel-review")
  })

  test("fails when the two release license receipts have different policy states", () => {
    expect(() =>
      createLegalReleaseSbom({
        subjects: [{ path: "app.exe", name: "app.exe", sha256: sha256("installer") }],
        created: "2026-08-24T12:00:00Z",
        repository: "https://github.com/legalbuilder13-spec/opencode-legal-research",
        commit: "a".repeat(40),
        desktop: { reviewStatus: "approved", firstParty: [], thirdParty: [] },
        worker: {
          reviewStatus: "pending-counsel-review",
          managedPython: {
            distribution: "python",
            declaredLicense: "Python-2.0",
            source: "https://python.org",
            licenseFiles: [],
          },
          pythonDistributions: [],
          models: [],
        },
      }),
    ).toThrow("license review states differ")
  })

  test("selects only top-level distributable formats from Electron Builder output", async () => {
    const root = await mkdtemp(join(tmpdir(), "legal-release-sbom-"))
    roots.push(root)
    await mkdir(join(root, "mac-arm64"))
    for (const name of [
      "opencode-desktop-mac-arm64.dmg",
      "opencode-desktop-mac-arm64.zip",
      "opencode-desktop-mac-arm64.dmg.blockmap",
      "latest-mac.yml",
      "legal-release.spdx.json",
    ])
      await Bun.write(join(root, name), name)

    expect((await releaseArtifactPaths(root)).map((path) => path.slice(root.length + 1))).toEqual([
      "opencode-desktop-mac-arm64.dmg",
      "opencode-desktop-mac-arm64.zip",
    ])
  })
})
