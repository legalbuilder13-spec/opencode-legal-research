import { createHash } from "node:crypto"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import {
  auditEvidenceWorkerLicenses,
  isManagedPythonLicensePath,
  verifyEvidenceWorkerLicenseReceipt,
} from "./evidence-worker-license-audit"

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe("packaged evidence-worker license audit", () => {
  test("pins the packaged OCR runtime to the explicit CPU-only PyTorch index", async () => {
    const workerRoot = resolve(import.meta.dir, "../../legal-evidence-worker")
    const project = await Bun.file(join(workerRoot, "pyproject.toml")).text()
    const lock = await Bun.file(join(workerRoot, "uv.lock")).text()

    expect(project).toContain('url = "https://download.pytorch.org/whl/cpu"')
    expect(project).toContain('explicit = true')
    expect(lock).toContain('source = { registry = "https://download.pytorch.org/whl/cpu" }')
    for (const name of ["cuda-bindings", "cuda-toolkit", "triton", "nvidia-cudnn-cu13"])
      expect(lock).not.toContain(`name = "${name}"`)
  })

  test("recognizes managed CPython license layouts on every packaged platform", () => {
    expect(isManagedPythonLicensePath("cpython-3.14.2-macos-aarch64-none/lib/python3.14/LICENSE.txt")).toBe(true)
    expect(isManagedPythonLicensePath("cpython-3.14.2-linux-x86_64-gnu/install/lib/python3.14/LICENSE.txt")).toBe(
      true,
    )
    expect(isManagedPythonLicensePath("cpython-3.14.2-windows-x86_64-none/install/LICENSE.txt")).toBe(true)
    expect(isManagedPythonLicensePath("cpython-3.14.2-windows-x86_64-none\\LICENSE")).toBe(true)
    expect(isManagedPythonLicensePath("cpython/lib/python3.14/site-packages/demo/LICENSE.txt")).toBe(false)
  })

  test("writes and verifies a complete deterministic receipt", async () => {
    const root = await fixture()
    const report = await auditEvidenceWorkerLicenses(root, { write: true })

    expect(report.pythonDistributions).toHaveLength(1)
    expect(report.models).toHaveLength(2)
    expect((await verifyEvidenceWorkerLicenseReceipt(root)).reviewStatus).toBe("pending-counsel-review")
    await expect(verifyEvidenceWorkerLicenseReceipt(root, { requireApproved: true })).rejects.toThrow(
      "require counsel approval",
    )
  })

  test("rejects a changed packaged model artifact", async () => {
    const root = await fixture()
    await Bun.write(join(root, "models", "RapidOcr", "model.bin"), "changed")
    await expect(auditEvidenceWorkerLicenses(root)).rejects.toThrow("artifact hash changed")
  })

  test("rejects a distribution with no declared license", async () => {
    const root = await fixture()
    const metadata = join(
      root,
      "python",
      "cpython",
      "lib",
      "python3.14",
      "site-packages",
      "demo-1.0.dist-info",
      "METADATA",
    )
    await Bun.write(metadata, "Metadata-Version: 2.4\nName: demo\nVersion: 1.0\n\n")
    await expect(auditEvidenceWorkerLicenses(root)).rejects.toThrow("has no declared license metadata")
  })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "legal-license-audit-"))
  roots.push(root)
  const distInfo = join(root, "python", "cpython", "lib", "python3.14", "site-packages", "demo-1.0.dist-info")
  const hfRoot = join(root, "models", "example-model")
  const rapidRoot = join(root, "models", "RapidOcr")
  await Promise.all([
    mkdir(join(distInfo, "licenses"), { recursive: true }),
    mkdir(join(hfRoot, ".cache", "huggingface", "download"), { recursive: true }),
    mkdir(rapidRoot, { recursive: true }),
  ])

  await Bun.write(join(root, "python", "cpython", "lib", "python3.14", "LICENSE.txt"), "Python license")
  await Bun.write(
    join(distInfo, "METADATA"),
    "Metadata-Version: 2.4\nName: demo\nVersion: 1.0\nLicense-Expression: MIT\nLicense-File: LICENSE\n\n",
  )
  await Bun.write(join(distInfo, "licenses", "LICENSE"), "Demo license")
  await Bun.write(join(hfRoot, "README.md"), "---\nlicense: apache-2.0\n---\n\n# Example\n")
  await Bun.write(join(hfRoot, "model.bin"), "model")
  await Bun.write(join(hfRoot, ".cache", "huggingface", "download", "README.md.metadata"), `${"a".repeat(40)}\netag\n`)
  await Bun.write(join(rapidRoot, "model.bin"), "rapid")
  await Bun.write(
    join(root, "packaged-model-policy.json"),
    `${JSON.stringify(
      {
        contractVersion: 1,
        reviewStatus: "pending-counsel-review",
        models: [
          {
            id: "example",
            directory: "example-model",
            source: "https://example.test/model",
            revision: "a".repeat(40),
            declaredLicense: "apache-2.0",
            licenseEvidence: "https://example.test/model/license",
          },
        ],
        rapidOcr: {
          id: "rapid",
          directory: "RapidOcr",
          source: "https://example.test/rapid",
          revision: "v1",
          declaredLicense: "Apache-2.0",
          licenseEvidence: "https://example.test/rapid/license",
          copyrightNote: "Example",
          files: { "model.bin": sha256("rapid") },
        },
      },
      null,
      2,
    )}\n`,
  )
  return root
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
