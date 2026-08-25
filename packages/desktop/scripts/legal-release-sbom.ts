#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readdir } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

import { verifyDesktopLicenseReceipt } from "./desktop-license-audit"
import { verifyEvidenceWorkerLicenseReceipt } from "./evidence-worker-license-audit"

type HashedFile = { path: string; sha256: string }
type DesktopPackage = {
  name: string
  version: string
  license?: string[]
  homepage?: string
  repository?: string
}
type DesktopReceipt = {
  reviewStatus: string
  firstParty: Array<{ name: string; version: string }>
  thirdParty: DesktopPackage[]
}
type PythonDistribution = {
  name: string
  version: string
  licenseExpression?: string
  license?: string
  licenseClassifiers?: string[]
  licenseFiles: HashedFile[]
}
type Model = {
  id: string
  source: string
  revision: string
  declaredLicense: string
  artifacts: HashedFile[]
}
type WorkerReceipt = {
  reviewStatus: string
  managedPython: {
    distribution: string
    declaredLicense: string
    source: string
    licenseFiles: HashedFile[]
  }
  pythonDistributions: PythonDistribution[]
  models: Model[]
}
type Subject = { path: string; name: string; sha256: string }

type SpdxPackage = {
  name: string
  SPDXID: string
  versionInfo?: string
  downloadLocation: string
  filesAnalyzed: false
  checksums?: Array<{ algorithm: "SHA256"; checksumValue: string }>
  licenseConcluded: "NOASSERTION"
  licenseDeclared: string
  licenseComments?: string
  homepage?: string
  sourceInfo?: string
  externalRefs?: Array<{
    referenceCategory: "PACKAGE-MANAGER"
    referenceType: "purl"
    referenceLocator: string
  }>
}

type SpdxFile = {
  fileName: string
  SPDXID: string
  checksums: Array<{ algorithm: "SHA256"; checksumValue: string }>
  licenseConcluded: "NOASSERTION"
  copyrightText: "NOASSERTION"
}

export type LegalReleaseSbom = {
  spdxVersion: "SPDX-2.3"
  dataLicense: "CC0-1.0"
  SPDXID: "SPDXRef-DOCUMENT"
  name: string
  documentNamespace: string
  creationInfo: { created: string; creators: string[] }
  comment: string
  packages: SpdxPackage[]
  files: SpdxFile[]
  relationships: Array<{ spdxElementId: string; relationshipType: string; relatedSpdxElement: string }>
}

export function createLegalReleaseSbom(input: {
  subjects: Subject[]
  desktop: DesktopReceipt
  worker: WorkerReceipt
  created: string
  repository: string
  commit: string
}): LegalReleaseSbom {
  assert(input.subjects.length > 0, "At least one release subject is required")
  assert(!Number.isNaN(Date.parse(input.created)), `Invalid SPDX creation time: ${input.created}`)
  assert(input.desktop.reviewStatus === input.worker.reviewStatus, "Desktop and worker license review states differ")

  const packages: SpdxPackage[] = []
  const files = new Map<string, SpdxFile>()
  const relationships: LegalReleaseSbom["relationships"] = []
  const components: string[] = []

  for (const subject of [...input.subjects].sort((a, b) => a.name.localeCompare(b.name))) {
    assert(/^[a-f0-9]{64}$/.test(subject.sha256), `Invalid SHA-256 for ${subject.name}`)
    const id = spdxId("Release", `${subject.name}:${subject.sha256}`)
    packages.push(packageRecord(subject.name, id, undefined, [], undefined, undefined, subject.sha256))
    relationships.push({
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: id,
    })
  }

  for (const item of [...input.desktop.firstParty].sort(packageOrder)) {
    const id = spdxId("Workspace", `${item.name}@${item.version}`)
    packages.push(packageRecord(item.name, id, item.version, [], undefined, input.repository))
    components.push(id)
  }
  for (const item of [...input.desktop.thirdParty].sort(packageOrder)) {
    const id = spdxId("Npm", `${item.name}@${item.version}`)
    packages.push(
      packageRecord(
        item.name,
        id,
        item.version,
        item.license ?? [],
        npmPurl(item.name, item.version),
        item.repository,
        undefined,
        item.homepage,
      ),
    )
    components.push(id)
  }

  const managed = input.worker.managedPython
  const managedPythonId = spdxId("Runtime", managed.distribution)
  packages.push(
    packageRecord(
      managed.distribution,
      managedPythonId,
      undefined,
      [managed.declaredLicense],
      undefined,
      managed.source,
    ),
  )
  components.push(managedPythonId)
  addFiles(managedPythonId, managed.licenseFiles, files, relationships)

  for (const item of [...input.worker.pythonDistributions].sort(packageOrder)) {
    const id = spdxId("PyPI", `${item.name}@${item.version}`)
    const licenses = [item.licenseExpression, item.license, ...(item.licenseClassifiers ?? [])].filter(
      (value): value is string => Boolean(value),
    )
    packages.push(packageRecord(item.name, id, item.version, licenses, pypiPurl(item.name, item.version)))
    components.push(id)
    addFiles(id, item.licenseFiles, files, relationships)
  }

  for (const item of [...input.worker.models].sort((a, b) => a.id.localeCompare(b.id))) {
    const id = spdxId("Model", `${item.id}@${item.revision}`)
    packages.push(packageRecord(item.id, id, item.revision, [item.declaredLicense], undefined, item.source))
    components.push(id)
    addFiles(id, item.artifacts, files, relationships)
  }

  const releaseIds = relationships
    .filter((item) => item.spdxElementId === "SPDXRef-DOCUMENT" && item.relationshipType === "DESCRIBES")
    .map((item) => item.relatedSpdxElement)
  for (const releaseId of releaseIds) {
    for (const componentId of components)
      relationships.push({
        spdxElementId: releaseId,
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: componentId,
      })
  }

  const namespaceDigest = createHash("sha256")
    .update(
      JSON.stringify({
        subjects: input.subjects.map(({ name, sha256 }) => ({ name, sha256 })).sort(packageOrder),
        packages: packages.map(({ name, versionInfo, SPDXID }) => ({ name, versionInfo, SPDXID })),
        files: [...files.values()].map(({ fileName, checksums }) => ({ fileName, checksums })),
      }),
    )
    .digest("hex")

  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `LegalBuilder desktop release ${input.subjects
      .map((item) => item.name)
      .sort()
      .join(", ")}`,
    documentNamespace: `${input.repository.replace(/\/$/, "")}/sbom/${namespaceDigest}`,
    creationInfo: {
      created: new Date(input.created).toISOString(),
      creators: ["Organization: LegalBuilder", "Tool: legal-release-sbom.ts"],
    },
    comment:
      `Generated from the packaged desktop and evidence-worker license receipts at commit ${input.commit}. ` +
      `Receipt policy state: ${input.desktop.reviewStatus}. A receipt inventory is not legal advice or license approval.`,
    packages: packages.sort((a, b) => a.SPDXID.localeCompare(b.SPDXID)),
    files: [...files.values()].sort((a, b) => a.fileName.localeCompare(b.fileName)),
    relationships: relationships.sort(
      (a, b) =>
        a.spdxElementId.localeCompare(b.spdxElementId) ||
        a.relationshipType.localeCompare(b.relationshipType) ||
        a.relatedSpdxElement.localeCompare(b.relatedSpdxElement),
    ),
  }
}

function packageRecord(
  name: string,
  SPDXID: string,
  versionInfo: string | undefined,
  licenses: string[],
  purl?: string,
  sourceInfo?: string,
  sha256?: string,
  homepage?: string,
): SpdxPackage {
  const uniqueLicenses = [...new Set(licenses.map((value) => value.trim()).filter(Boolean))].sort()
  const declared =
    uniqueLicenses.length === 1 && isSpdxExpression(uniqueLicenses[0]!) ? uniqueLicenses[0]! : "NOASSERTION"
  return {
    name,
    SPDXID,
    ...(versionInfo ? { versionInfo } : {}),
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    ...(sha256 ? { checksums: [{ algorithm: "SHA256" as const, checksumValue: sha256 }] } : {}),
    licenseConcluded: "NOASSERTION",
    licenseDeclared: declared,
    ...(uniqueLicenses.length ? { licenseComments: `Receipt declarations: ${uniqueLicenses.join("; ")}` } : {}),
    ...(homepage ? { homepage } : {}),
    ...(sourceInfo ? { sourceInfo } : {}),
    ...(purl
      ? {
          externalRefs: [
            {
              referenceCategory: "PACKAGE-MANAGER" as const,
              referenceType: "purl" as const,
              referenceLocator: purl,
            },
          ],
        }
      : {}),
  }
}

function addFiles(
  owner: string,
  records: HashedFile[],
  files: Map<string, SpdxFile>,
  relationships: LegalReleaseSbom["relationships"],
) {
  for (const record of records) {
    assert(/^[a-f0-9]{64}$/.test(record.sha256), `Invalid SHA-256 for ${record.path}`)
    const fileName = record.path.startsWith("./") ? record.path : `./${record.path.replaceAll("\\", "/")}`
    const id = spdxId("File", `${fileName}:${record.sha256}`)
    const existing = files.get(id)
    if (existing && existing.checksums[0]!.checksumValue !== record.sha256)
      throw new Error(`Conflicting hashes for ${fileName}`)
    files.set(id, {
      fileName,
      SPDXID: id,
      checksums: [{ algorithm: "SHA256", checksumValue: record.sha256 }],
      licenseConcluded: "NOASSERTION",
      copyrightText: "NOASSERTION",
    })
    relationships.push({ spdxElementId: owner, relationshipType: "CONTAINS", relatedSpdxElement: id })
  }
}

function isSpdxExpression(value: string) {
  return /^(?:0BSD|AFL-3\.0|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|BSL-1\.0|CC0-1\.0|ISC|MIT|MPL-2\.0|Python-2\.0|Unlicense|WTFPL|Zlib)(?: (?:AND|OR) (?:0BSD|AFL-3\.0|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|BSL-1\.0|CC0-1\.0|ISC|MIT|MPL-2\.0|Python-2\.0|Unlicense|WTFPL|Zlib))*$/.test(
    value,
  )
}

function npmPurl(name: string, version: string) {
  if (name.startsWith("@")) {
    const [scope, packageName] = name.split("/", 2)
    return `pkg:npm/${encodeURIComponent(scope!)}/${encodeURIComponent(packageName!)}@${encodeURIComponent(version)}`
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`
}

function pypiPurl(name: string, version: string) {
  return `pkg:pypi/${encodeURIComponent(name.toLowerCase().replaceAll("_", "-"))}@${encodeURIComponent(version)}`
}

function spdxId(prefix: string, identity: string) {
  return `SPDXRef-${prefix}-${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`
}

function packageOrder(a: { name: string; version?: string }, b: { name: string; version?: string }) {
  return a.name.localeCompare(b.name) || String(a.version ?? "").localeCompare(String(b.version ?? ""))
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

export async function releaseArtifactPaths(distInput: string) {
  const dist = resolve(distInput)
  const entries = await readdir(dist, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && /\.(?:AppImage|deb|dmg|exe|rpm|tar\.gz|zip)$/i.test(entry.name))
    .map((entry) => join(dist, entry.name))
    .sort()
}

function option(name: string) {
  return Bun.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
}

function options(name: string) {
  return Bun.argv.filter((value) => value.startsWith(`--${name}=`)).map((value) => value.slice(name.length + 3))
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, "../../..")
  const explicitSubjects = options("subject").map((value) => resolve(value))
  const dist = option("dist")
  assert(!(explicitSubjects.length && dist), "Use either --subject or --dist, not both")
  const subjectPaths = dist ? await releaseArtifactPaths(dist) : explicitSubjects
  const desktopReceiptPath = resolve(option("desktop-receipt") ?? "")
  const workerRoot = resolve(option("worker-root") ?? "")
  const output = resolve(option("output") ?? "")
  const checksums = resolve(option("checksums") ?? "")
  if (
    !subjectPaths.length ||
    !option("desktop-receipt") ||
    !option("worker-root") ||
    !option("output") ||
    !option("checksums")
  )
    throw new Error(
      "usage: bun legal-release-sbom.ts (--subject=ARTIFACT [...] | --dist=DIST) --desktop-receipt=RECEIPT --worker-root=WORKER --output=SBOM --checksums=CHECKSUMS",
    )

  const [desktop, worker, subjects] = await Promise.all([
    verifyDesktopLicenseReceipt(repositoryRoot, desktopReceiptPath),
    verifyEvidenceWorkerLicenseReceipt(workerRoot),
    Promise.all(
      subjectPaths.map(async (path) => {
        assert(await Bun.file(path).exists(), `Release subject is missing: ${path}`)
        return { path, name: basename(path), sha256: await hashFile(path) }
      }),
    ),
  ])
  const duplicate = subjects.find((item, index) => subjects.findIndex((other) => other.name === item.name) !== index)
  assert(!duplicate, `Release subject names must be unique: ${duplicate?.name}`)

  const created = option("created") ?? process.env.SOURCE_DATE_EPOCH
  const createdAt =
    created && /^\d+$/.test(created)
      ? new Date(Number(created) * 1_000).toISOString()
      : (created ?? new Date().toISOString())
  const repository =
    option("repository") ??
    `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY ?? "legalbuilder13-spec/opencode-legal-research"}`
  const commit = option("commit") ?? process.env.GITHUB_SHA ?? "NOASSERTION"
  const document = createLegalReleaseSbom({ subjects, desktop, worker, created: createdAt, repository, commit })
  await Promise.all([
    Bun.write(output, `${JSON.stringify(document, null, 2)}\n`),
    Bun.write(
      checksums,
      `${subjects
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => `${item.sha256}  ${item.name}`)
        .join("\n")}\n`,
    ),
  ])
  console.log(
    `Generated SPDX 2.3 SBOM for ${subjects.length} release artifact(s), ${document.packages.length} packages, and ${document.files.length} hashed files`,
  )
  console.log(`SBOM: ${output}`)
  console.log(`Subjects: ${checksums}`)
}
