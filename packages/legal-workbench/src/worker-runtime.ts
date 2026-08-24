import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"

export interface EvidenceWorkerRuntime {
  kind: "packaged" | "development"
  root: string
  python: string
  packageRoot: string
  artifactsPath?: string
  ocrEngine: "rapidocr" | "tesseract"
  ocrLanguages: string[]
  licenseReviewStatus?: "pending-counsel-review" | "approved"
}

export type EvidenceWorkerDiscovery =
  | { status: "ready"; runtime: EvidenceWorkerRuntime; detail: string }
  | { status: "unavailable"; detail: string }

interface RuntimeManifest {
  contractVersion: 1
  runtime: "legalbuilder-evidence-worker"
  python: { executable: string; version: string }
  packageRoot: string
  models: { path: string; included: boolean; sha256: string }
  ocr: { engine: "rapidocr"; backend: "torch"; languages: string[] }
  licenses: {
    path: string
    sha256: string
    pythonDistributions: number
    modelSets: number
    reviewStatus: "pending-counsel-review" | "approved"
  }
  lockSha256: string
}

export function discoverEvidenceWorkerRuntime(workerRoot: string): EvidenceWorkerDiscovery {
  const root = resolve(workerRoot)
  const manifestPath = resolve(root, "runtime-manifest.json")
  if (existsSync(manifestPath)) {
    try {
      const manifest = runtimeManifest(JSON.parse(readFileSync(manifestPath, "utf8")))
      const python = containedPath(root, manifest.python.executable, "Python executable")
      const packageRoot = containedPath(root, manifest.packageRoot, "worker package")
      const artifactsPath = containedPath(root, manifest.models.path, "Docling model artifacts")
      const licensesPath = containedPath(root, manifest.licenses.path, "third-party license receipt")
      if (!existsSync(python)) throw new Error("Python executable is missing")
      if (!existsSync(resolve(packageRoot, "legal_evidence_worker", "cli.py")))
        throw new Error("worker package is missing")
      if (!manifest.models.included || !existsSync(artifactsPath))
        throw new Error("offline model artifacts are missing")
      if (!existsSync(licensesPath)) throw new Error("third-party license receipt is missing")
      if (createHash("sha256").update(readFileSync(licensesPath)).digest("hex") !== manifest.licenses.sha256)
        throw new Error("third-party license receipt hash does not match the runtime manifest")
      return {
        status: "ready",
        runtime: {
          kind: "packaged",
          root,
          python,
          packageRoot,
          artifactsPath,
          ocrEngine: manifest.ocr.engine,
          ocrLanguages: manifest.ocr.languages,
          licenseReviewStatus: manifest.licenses.reviewStatus,
        },
        detail: `Packaged Docling/${manifest.ocr.engine} worker ready (${manifest.ocr.languages.join(", ")} OCR)`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid runtime manifest"
      return { status: "unavailable", detail: `Packaged evidence worker is invalid: ${message}` }
    }
  }

  const python = resolve(root, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python")
  if (existsSync(python) && existsSync(resolve(root, "legal_evidence_worker", "cli.py"))) {
    return {
      status: "ready",
      runtime: {
        kind: "development",
        root,
        python,
        packageRoot: root,
        ocrEngine: "tesseract",
        ocrLanguages: [],
      },
      detail: `Development Docling/Tesseract worker configured at ${root}`,
    }
  }
  return {
    status: "unavailable",
    detail: `Evidence worker is missing a valid packaged runtime or development environment: ${root}`,
  }
}

function runtimeManifest(value: unknown): RuntimeManifest {
  if (!value || typeof value !== "object") throw new Error("runtime manifest is not an object")
  const manifest = value as Partial<RuntimeManifest>
  if (manifest.contractVersion !== 1 || manifest.runtime !== "legalbuilder-evidence-worker")
    throw new Error("runtime manifest identity is unsupported")
  if (!manifest.python || typeof manifest.python.executable !== "string" || typeof manifest.python.version !== "string")
    throw new Error("runtime manifest has no Python identity")
  if (typeof manifest.packageRoot !== "string") throw new Error("runtime manifest has no worker package path")
  if (
    !manifest.models ||
    typeof manifest.models.path !== "string" ||
    typeof manifest.models.included !== "boolean" ||
    !isSha256(manifest.models.sha256)
  )
    throw new Error("runtime manifest has no valid model identity")
  if (
    !manifest.ocr ||
    manifest.ocr.engine !== "rapidocr" ||
    manifest.ocr.backend !== "torch" ||
    !Array.isArray(manifest.ocr.languages) ||
    !manifest.ocr.languages.length ||
    manifest.ocr.languages.some((language) => typeof language !== "string" || !language.trim())
  )
    throw new Error("runtime manifest has no supported OCR configuration")
  if (
    !manifest.licenses ||
    typeof manifest.licenses.path !== "string" ||
    !isSha256(manifest.licenses.sha256) ||
    !Number.isInteger(manifest.licenses.pythonDistributions) ||
    manifest.licenses.pythonDistributions < 1 ||
    !Number.isInteger(manifest.licenses.modelSets) ||
    manifest.licenses.modelSets < 1 ||
    (manifest.licenses.reviewStatus !== "pending-counsel-review" && manifest.licenses.reviewStatus !== "approved")
  )
    throw new Error("runtime manifest has no valid third-party license identity")
  if (!isSha256(manifest.lockSha256)) throw new Error("runtime manifest has no valid lock identity")
  return manifest as RuntimeManifest
}

function containedPath(root: string, candidate: string, label: string) {
  if (!candidate || isAbsolute(candidate)) throw new Error(`${label} path must be relative`)
  const path = resolve(root, candidate)
  const relation = relative(root, path)
  if (
    relation === ".." ||
    relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(relation)
  )
    throw new Error(`${label} escapes the packaged worker root`)
  return path
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}
