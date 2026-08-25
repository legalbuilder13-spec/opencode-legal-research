#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { readdir, realpath } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"

export const desktopLicenseReceiptName = "THIRD_PARTY_LICENSES.desktop.json"

type PackageJson = {
  name?: string
  version?: string
  private?: boolean
  license?: string | { type?: string; url?: string }
  licenses?: Array<string | { type?: string; url?: string }>
  homepage?: string
  repository?: string | { type?: string; url?: string }
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

type QueueItem = { root: string; includeDev: boolean; required: boolean; requestedAs?: string }
type LicenseOverrides = {
  contractVersion: 1
  overrides: Record<string, { license: string[]; evidence: string; note: string }>
}

type LicensePolicy = {
  contractVersion: 1
  reviewStatus: "pending-counsel-review" | "approved"
  reviewedBy: string | null
  reviewedAt: string | null
  reviewRecord: string | null
}

export async function auditDesktopLicenses(
  repositoryInput: string,
  options: { writeTo?: string; requireApproved?: boolean } = {},
) {
  const repository = resolve(repositoryInput)
  const policy = await readJson<LicensePolicy>(
    join(repository, "packages", "desktop", "dependency-license-policy.json"),
  )
  assert(policy.contractVersion === 1, "Unsupported desktop license policy contract")
  assert(
    policy.reviewStatus === "pending-counsel-review" || policy.reviewStatus === "approved",
    "Invalid desktop license review status",
  )
  if (policy.reviewStatus === "approved") {
    assert(policy.reviewedBy?.trim(), "Approved desktop license policy is missing reviewedBy")
    assert(
      policy.reviewedAt && validReviewTime(policy.reviewedAt),
      "Approved desktop license policy is missing reviewedAt",
    )
    assert(policy.reviewRecord?.trim(), "Approved desktop license policy is missing reviewRecord")
  } else {
    assert(
      policy.reviewedBy === null && policy.reviewedAt === null && policy.reviewRecord === null,
      "Pending desktop license policy cannot claim review metadata",
    )
  }
  if (options.requireApproved && policy.reviewStatus !== "approved")
    throw new Error("Desktop dependency licenses still require counsel approval")
  const overrides = await readJson<LicenseOverrides>(
    join(repository, "packages", "desktop", "dependency-license-overrides.json"),
  )
  assert(overrides.contractVersion === 1, "Unsupported desktop license override contract")
  const usedOverrides = new Set<string>()
  const issues: string[] = []

  const queue: QueueItem[] = [
    { root: join(repository, "packages", "desktop"), includeDev: false, required: true },
    { root: join(repository, "packages", "opencode"), includeDev: false, required: true },
    { root: join(repository, "packages", "legal-workbench"), includeDev: false, required: true },
  ]
  for (const name of ["@opencode-ai/app", "@opencode-ai/ui", "electron"]) {
    const root = await resolveDependencyRoot(join(repository, "packages", "desktop"), name)
    assert(root, `Could not resolve bundled desktop dependency ${name}`)
    queue.push({ root, includeDev: false, required: true, requestedAs: name })
  }
  const visitedRoots = new Set<string>()
  const packages = new Map<string, Record<string, unknown>>()
  const firstParty = new Map<string, { name: string; version: string }>()

  while (queue.length) {
    const item = queue.shift()!
    let root: string
    try {
      root = await realpath(item.root)
    } catch (error) {
      if (!item.required && (error as NodeJS.ErrnoException).code === "ENOENT") continue
      throw error
    }
    if (visitedRoots.has(root)) continue
    visitedRoots.add(root)
    const manifestPath = join(root, "package.json")
    const manifest = await readJson<PackageJson>(manifestPath)
    const workspace = manifest.private === true || !root.includes(`${sep}node_modules${sep}`)
    assert(
      manifest.name && (workspace || manifest.version),
      `Incomplete package identity: ${portable(relative(repository, manifestPath))}`,
    )
    const version = manifest.version ?? "workspace"
    if (workspace) {
      firstParty.set(manifest.name, { name: manifest.name, version })
    } else {
      const license = licenseDeclaration(manifest)
      const licenseFiles = await rootLicenseFiles(root)
      const identity = `${manifest.name}@${version}`
      const override = overrides.overrides[identity]
      if (override) usedOverrides.add(identity)
      const effectiveLicense = license.length ? license : (override?.license ?? [])
      if (!effectiveLicense.length && !licenseFiles.length)
        issues.push(`${identity} has no license declaration, root license file, or reviewed override`)
      if (effectiveLicense.some((value) => value.toUpperCase() === "UNLICENSED"))
        issues.push(`${identity} is marked UNLICENSED`)
      for (const declaration of license) {
        const match = declaration.match(/^SEE LICENSE IN (.+)$/i)
        if (match)
          assert(
            licenseFiles.some((file) => basename(file.path) === basename(match[1]!.trim())),
            `${manifest.name} ${version} is missing ${match[1]}`,
          )
      }
      packages.set(identity, {
        name: manifest.name,
        version,
        license: effectiveLicense.length ? effectiveLicense : ["declared-in-included-license-file"],
        override: override ? { evidence: override.evidence, note: override.note } : undefined,
        homepage: manifest.homepage,
        repository: repositoryUrl(manifest.repository),
        licenseFiles,
      })
    }

    const dependencyKinds = [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies]
    if (item.includeDev) dependencyKinds.push(manifest.devDependencies)
    for (const dependencies of dependencyKinds) {
      for (const name of Object.keys(dependencies ?? {}).sort()) {
        const optional = dependencies === manifest.optionalDependencies || dependencies === manifest.peerDependencies
        const dependencyRoot = await resolveDependencyRoot(root, name)
        if (!dependencyRoot) {
          if (optional) continue
          throw new Error(`Could not resolve required dependency ${name} from ${manifest.name}`)
        }
        queue.push({ root: dependencyRoot, includeDev: false, required: !optional, requestedAs: name })
      }
    }
  }

  for (const identity of Object.keys(overrides.overrides)) {
    if (!usedOverrides.has(identity)) issues.push(`Stale or unreachable license override: ${identity}`)
  }
  if (issues.length) throw new Error(`Desktop dependency license inventory is incomplete:\n- ${issues.join("\n- ")}`)

  const report = {
    contractVersion: 1,
    scope: "desktop-build-and-runtime-dependency-closure",
    reviewStatus: policy.reviewStatus,
    reviewEvidence:
      policy.reviewStatus === "approved"
        ? { reviewedBy: policy.reviewedBy, reviewedAt: policy.reviewedAt, reviewRecord: policy.reviewRecord }
        : undefined,
    reviewMeaning:
      "Conservative automated dependency inventory. Build-only packages may be included; counsel must approve compatibility and notice obligations before release.",
    roots: [
      "packages/desktop",
      "packages/opencode",
      "packages/legal-workbench",
      "bundled @opencode-ai/app",
      "bundled @opencode-ai/ui",
      "Electron runtime",
    ],
    firstParty: [...firstParty.values()].sort((a, b) => a.name.localeCompare(b.name)),
    thirdParty: [...packages.values()].sort(
      (a, b) => String(a.name).localeCompare(String(b.name)) || String(a.version).localeCompare(String(b.version)),
    ),
  }
  if (options.writeTo) await Bun.write(resolve(options.writeTo), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

export async function verifyDesktopLicenseReceipt(
  repository: string,
  receiptPath: string,
  options: { requireApproved?: boolean } = {},
) {
  const expected = await auditDesktopLicenses(repository, options)
  const actual = await readJson<unknown>(receiptPath)
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${desktopLicenseReceiptName} does not match the dependency closure`,
  )
  return expected
}

async function resolveDependencyRoot(fromRoot: string, name: string) {
  const candidates: string[] = [join(fromRoot, "node_modules", name)]
  if (basename(dirname(fromRoot)) === "node_modules") candidates.push(join(dirname(fromRoot), name))
  let cursor = fromRoot
  while (true) {
    candidates.push(join(cursor, "node_modules", name))
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  for (const candidate of candidates) {
    if (await Bun.file(join(candidate, "package.json")).exists()) return candidate
  }
}

async function rootLicenseFiles(root: string) {
  const entries = await readdir(root, { withFileTypes: true })
  const paths = entries
    .filter(
      (entry) => entry.isFile() && /^(licen[cs]e|copying|notice|copyright|authors)(\.(?!pdf$).*)?$/i.test(entry.name),
    )
    .map((entry) => join(root, entry.name))
    .sort()
  return Promise.all(
    paths.map(async (path) => {
      const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
      assert(bytes.byteLength <= 2 * 1024 * 1024, `License file is unexpectedly large: ${path}`)
      return {
        path: basename(path),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      }
    }),
  )
}

function licenseDeclaration(manifest: PackageJson) {
  const values = [manifest.license, ...(manifest.licenses ?? [])]
  return values
    .flatMap((value) => {
      if (typeof value === "string") return value.trim() ? [value.trim()] : []
      if (!value || typeof value !== "object") return []
      return value.type?.trim() ? [value.type.trim()] : value.url?.trim() ? [value.url.trim()] : []
    })
    .filter((value, index, all) => all.indexOf(value) === index)
}

function repositoryUrl(value: PackageJson["repository"]) {
  return typeof value === "string" ? value : value?.url
}

function validReviewTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && !Number.isNaN(Date.parse(value))
}

async function readJson<T>(path: string): Promise<T> {
  assert(await Bun.file(path).exists(), `Missing ${portable(path)}`)
  return Bun.file(path).json() as Promise<T>
}

function portable(value: string) {
  return value.split(sep).join("/")
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

if (import.meta.main) {
  const repository = resolve(import.meta.dir, "../../..")
  const outputArgument = Bun.argv.find((value) => value.startsWith("--write="))?.slice("--write=".length)
  const requireApproved = Bun.argv.includes("--require-approved")
  const output = outputArgument ? resolve(outputArgument) : undefined
  const report = output
    ? await auditDesktopLicenses(repository, { writeTo: output, requireApproved })
    : await verifyDesktopLicenseReceipt(
        repository,
        resolve(Bun.argv[2] ?? join(import.meta.dir, "../resources", desktopLicenseReceiptName)),
      )
  console.log(`Verified ${report.thirdParty.length} desktop dependencies (${report.reviewStatus})`)
}
