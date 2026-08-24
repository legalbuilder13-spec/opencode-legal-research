#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readdir } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"

const receiptName = "THIRD_PARTY_LICENSES.json"
const policyName = "packaged-model-policy.json"

type ModelPolicy = {
  id: string
  directory: string
  source: string
  revision: string
  declaredLicense: string
  licenseEvidence: string
}

type RapidOcrPolicy = ModelPolicy & {
  copyrightNote: string
  files: Record<string, string>
}

type LicensePolicy = {
  contractVersion: number
  reviewStatus: "pending-counsel-review" | "approved"
  models: ModelPolicy[]
  rapidOcr: RapidOcrPolicy
}

export async function auditEvidenceWorkerLicenses(
  rootInput: string,
  options: { write?: boolean; requireApproved?: boolean } = {},
) {
  const root = resolve(rootInput)
  const policy = await readJson<LicensePolicy>(join(root, policyName))
  assert(policy.contractVersion === 1, "Unsupported packaged model policy contract")
  assert(
    policy.reviewStatus === "pending-counsel-review" || policy.reviewStatus === "approved",
    "Invalid license review status",
  )
  if (options.requireApproved)
    assert(policy.reviewStatus === "approved", "Dependency and model licenses still require counsel approval")

  const metadataFiles = (await listFiles(join(root, "python"))).filter((path) => {
    if (basename(path) !== "METADATA" || !basename(dirname(path)).endsWith(".dist-info")) return false
    return basename(dirname(dirname(path))) === "site-packages"
  })
  assert(metadataFiles.length > 0, "No installed Python distribution metadata found")

  const pythonDistributions = await Promise.all(
    metadataFiles.map(async (path) => {
      const fields = parseMetadata(await Bun.file(path).text())
      const name = first(fields, "Name")
      const version = first(fields, "Version")
      const licenseExpression = first(fields, "License-Expression", false)
      const license = first(fields, "License", false)
      const licenseClassifiers = (fields.get("Classifier") ?? []).filter((value) => value.startsWith("License ::"))
      assert(name && version, `Incomplete distribution identity in ${portable(relative(root, path))}`)
      assert(
        licenseExpression || license || licenseClassifiers.length,
        `${name} ${version} has no declared license metadata`,
      )

      const distInfo = dirname(path)
      const declaredFiles = fields.get("License-File") ?? []
      const availableFiles = new Set(await listFilesIfPresent(join(distInfo, "licenses")))
      for (const declared of declaredFiles) {
        const candidates = [join(distInfo, declared), join(distInfo, "licenses", declared)]
        let expected: string | undefined
        for (const candidate of candidates) {
          if (await Bun.file(candidate).exists()) {
            expected = candidate
            break
          }
        }
        assert(expected, `${name} ${version} is missing declared license file ${declared}`)
        availableFiles.add(expected)
      }

      return {
        name,
        version,
        licenseExpression: licenseExpression || undefined,
        license: license || undefined,
        licenseClassifiers,
        metadata: portable(relative(root, path)),
        licenseFiles: await hashFiles(root, [...availableFiles].sort()),
      }
    }),
  )
  pythonDistributions.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  const duplicate = pythonDistributions.find(
    (item, index) => index > 0 && item.name.toLowerCase() === pythonDistributions[index - 1]!.name.toLowerCase(),
  )
  assert(!duplicate, `Duplicate installed Python distribution metadata: ${duplicate?.name}`)

  const pythonLicenseFiles = (await listFiles(join(root, "python"))).filter(
    (path) => basename(path) === "LICENSE.txt" && /[/\\]lib[/\\]python\d+\.\d+[/\\]LICENSE\.txt$/.test(path),
  )
  assert(pythonLicenseFiles.length === 1, "Expected exactly one managed CPython license file")

  const models: Array<Record<string, unknown>> = []
  for (const expected of policy.models) {
    const modelRoot = join(root, "models", expected.directory)
    const card = join(modelRoot, "README.md")
    assert(await Bun.file(card).exists(), `Missing model card for ${expected.id}`)
    const cardLicense = parseModelCardLicense(await Bun.file(card).text())
    assert(
      cardLicense.toLowerCase() === expected.declaredLicense.toLowerCase(),
      `${expected.id} model-card license changed from ${expected.declaredLicense} to ${cardLicense}`,
    )

    const metadata = await listFilesIfPresent(join(modelRoot, ".cache", "huggingface", "download"))
    const revisions = new Set<string>()
    for (const path of metadata.filter((item) => item.endsWith(".metadata"))) {
      const revision = (await Bun.file(path).text()).split(/\r?\n/, 1)[0]!.trim()
      assert(/^[a-f0-9]{40}$/.test(revision), `Invalid Hugging Face revision metadata for ${expected.id}`)
      revisions.add(revision)
    }
    assert(
      revisions.size === 1 && revisions.has(expected.revision),
      `${expected.id} resolved to an unreviewed revision: ${[...revisions].join(", ") || "missing"}`,
    )

    const artifacts = (await listFiles(modelRoot)).filter((path) => !path.includes(`${sep}.cache${sep}`)).sort()
    assert(artifacts.length > 1, `No packaged model artifacts found for ${expected.id}`)
    models.push({ ...expected, modelCardLicense: cardLicense, artifacts: await hashFiles(root, artifacts) })
  }

  const rapid = policy.rapidOcr
  const rapidRoot = join(root, "models", rapid.directory)
  const rapidFiles = await listFiles(rapidRoot)
  assert(rapidFiles.length === Object.keys(rapid.files).length, `${rapid.id} contains an unreviewed file set`)
  for (const [name, expectedHash] of Object.entries(rapid.files)) {
    const path = join(rapidRoot, name)
    assert(await Bun.file(path).exists(), `Missing ${rapid.id} artifact ${name}`)
    assert((await hashFile(path)) === expectedHash, `${rapid.id} artifact hash changed: ${name}`)
  }
  models.push({
    id: rapid.id,
    directory: rapid.directory,
    source: rapid.source,
    revision: rapid.revision,
    declaredLicense: rapid.declaredLicense,
    licenseEvidence: rapid.licenseEvidence,
    copyrightNote: rapid.copyrightNote,
    artifacts: await hashFiles(root, rapidFiles.sort()),
  })

  const report = {
    contractVersion: 1,
    scope: "packaged-legal-evidence-worker",
    reviewStatus: policy.reviewStatus,
    reviewMeaning:
      "Automated completeness and integrity receipt; license compatibility and release approval remain counsel decisions.",
    managedPython: {
      distribution: "astral-python-build-standalone",
      declaredLicense: "Python-2.0",
      source: "https://github.com/astral-sh/python-build-standalone",
      licenseFiles: await hashFiles(root, pythonLicenseFiles),
    },
    pythonDistributions,
    models,
  }

  if (options.write) await Bun.write(join(root, receiptName), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

export async function verifyEvidenceWorkerLicenseReceipt(
  rootInput: string,
  options: { requireApproved?: boolean } = {},
) {
  const root = resolve(rootInput)
  const expected = await auditEvidenceWorkerLicenses(root, options)
  const actual = await readJson<unknown>(join(root, receiptName))
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${receiptName} does not match the installed resource`)
  return expected
}

async function hashFiles(root: string, paths: string[]) {
  return Promise.all(
    paths.map(async (path) => ({ path: portable(relative(root, path)), sha256: await hashFile(path) })),
  )
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

async function listFilesIfPresent(root: string) {
  try {
    return await listFiles(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

function parseMetadata(text: string) {
  const fields = new Map<string, string[]>()
  let current: string | undefined
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!line) break
    if (/^[ \t]/.test(line) && current) {
      const values = fields.get(current)!
      values[values.length - 1] += `\n${line.trim()}`
      continue
    }
    const separator = line.indexOf(":")
    if (separator < 1) continue
    current = line.slice(0, separator)
    const values = fields.get(current) ?? []
    values.push(line.slice(separator + 1).trim())
    fields.set(current, values)
  }
  return fields
}

function parseModelCardLicense(text: string) {
  const match = text.replace(/\r\n/g, "\n").match(/^---\n[\s\S]*?^license:\s*([^\n]+)\n[\s\S]*?^---$/m)
  assert(match?.[1], "Model card has no scalar license in YAML front matter")
  return match[1].trim().replace(/^['"]|['"]$/g, "")
}

function first(fields: Map<string, string[]>, name: string, required = true) {
  const value = fields.get(name)?.[0]?.trim() ?? ""
  if (required) assert(value, `Missing ${name} metadata field`)
  return value
}

async function readJson<T>(path: string): Promise<T> {
  assert(await Bun.file(path).exists(), `Missing ${portable(path)}`)
  return Bun.file(path).json() as Promise<T>
}

function hashFile(path: string) {
  return new Promise<string>((resolveHash, rejectHash) => {
    const digest = createHash("sha256")
    const stream = createReadStream(path)
    stream.on("data", (chunk) => digest.update(chunk))
    stream.on("error", rejectHash)
    stream.on("end", () => resolveHash(digest.digest("hex")))
  })
}

function portable(value: string) {
  return value.split(sep).join("/")
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

if (import.meta.main) {
  const root = Bun.argv[2]
  assert(root, "Usage: evidence-worker-license-audit.ts <resource-root> [--write] [--require-approved]")
  const write = Bun.argv.includes("--write")
  const requireApproved = Bun.argv.includes("--require-approved")
  const report = write
    ? await auditEvidenceWorkerLicenses(root, { write, requireApproved })
    : await verifyEvidenceWorkerLicenseReceipt(root, { requireApproved })
  console.log(
    `Verified ${report.pythonDistributions.length} Python distributions and ${report.models.length} model sets (${report.reviewStatus})`,
  )
}
