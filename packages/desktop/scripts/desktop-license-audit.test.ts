import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import { auditDesktopLicenses } from "./desktop-license-audit"

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe("desktop dependency license audit", () => {
  test("records the reachable dependency closure and included notice text", async () => {
    const root = await fixture(true)
    const report = await auditDesktopLicenses(root)
    expect(report.thirdParty).toHaveLength(2)
    expect(report.thirdParty.find((item) => item.name === "runtime-dependency")).toMatchObject({
      version: "1.0.0",
      license: ["MIT"],
      licenseFiles: [{ path: "LICENSE", text: "Runtime license" }],
    })
  })

  test("rejects a reachable package with no license evidence", async () => {
    const root = await fixture(false)
    await expect(auditDesktopLicenses(root)).rejects.toThrow("runtime-dependency@1.0.0 has no license declaration")
  })
})

async function fixture(licensed: boolean) {
  const root = await mkdtemp(join(tmpdir(), "desktop-license-audit-"))
  roots.push(root)
  const desktop = join(root, "packages", "desktop")
  const modules = join(desktop, "node_modules")
  await Promise.all([
    mkdir(join(modules, "@opencode-ai", "app"), { recursive: true }),
    mkdir(join(modules, "@opencode-ai", "ui"), { recursive: true }),
    mkdir(join(modules, "electron"), { recursive: true }),
    mkdir(join(modules, "runtime-dependency"), { recursive: true }),
    mkdir(join(root, "packages", "opencode"), { recursive: true }),
    mkdir(join(root, "packages", "legal-workbench"), { recursive: true }),
  ])
  await writePackage(desktop, {
    name: "desktop",
    version: "1.0.0",
    private: true,
    dependencies: { "runtime-dependency": "1.0.0" },
  })
  await writePackage(join(root, "packages", "opencode"), { name: "opencode", version: "1.0.0", private: true })
  await writePackage(join(root, "packages", "legal-workbench"), { name: "workbench", version: "1.0.0", private: true })
  await writePackage(join(modules, "@opencode-ai", "app"), {
    name: "@opencode-ai/app",
    version: "1.0.0",
    private: true,
  })
  await writePackage(join(modules, "@opencode-ai", "ui"), { name: "@opencode-ai/ui", version: "1.0.0", private: true })
  await writePackage(join(modules, "electron"), { name: "electron", version: "1.0.0", license: "MIT" })
  await writePackage(join(modules, "runtime-dependency"), {
    name: "runtime-dependency",
    version: "1.0.0",
    ...(licensed ? { license: "MIT" } : {}),
  })
  if (licensed) await Bun.write(join(modules, "runtime-dependency", "LICENSE"), "Runtime license")
  await Bun.write(join(desktop, "dependency-license-overrides.json"), '{"contractVersion":1,"overrides":{}}\n')
  return root
}

async function writePackage(root: string, value: Record<string, unknown>) {
  await mkdir(root, { recursive: true })
  await Bun.write(join(root, "package.json"), `${JSON.stringify(value)}\n`)
}
