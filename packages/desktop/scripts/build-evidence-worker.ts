#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"

const desktopRoot = resolve(import.meta.dir, "..")
const workerRoot = resolve(desktopRoot, "../legal-evidence-worker")
const output = resolve(Bun.argv[2] ?? join(desktopRoot, "resources", "legal-evidence-worker"))
const staging = resolve(dirname(output), `.${basename(output)}.staging-${process.pid}`)
const uv = process.env.UV ?? Bun.which("uv")

if (!uv) throw new Error("uv is required to build the packaged evidence worker")
if (output === workerRoot || staging === workerRoot)
  throw new Error("Refusing to replace the evidence-worker source tree")

const pythonVersion = (await Bun.file(join(workerRoot, ".python-version")).text()).trim()
if (!/^\d+\.\d+\.\d+$/.test(pythonVersion))
  throw new Error("The packaged Python version must include an exact patch version")

await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })

try {
  const pythonInstallRoot = join(staging, "python")
  await run([
    uv,
    "python",
    "install",
    pythonVersion,
    "--managed-python",
    "--no-bin",
    "--install-dir",
    pythonInstallRoot,
  ])
  const python = await findManagedPython(pythonInstallRoot, pythonVersion)
  const requirements = join(staging, "frozen-requirements.txt")
  await run(
    [uv, "export", "--frozen", "--no-dev", "--format", "requirements-txt", "--output-file", requirements],
    workerRoot,
    "ignore",
  )
  await run([
    uv,
    "pip",
    "sync",
    "--python",
    python,
    "--system",
    "--break-system-packages",
    "--link-mode",
    "copy",
    "--compile-bytecode",
    requirements,
  ])

  const models = join(staging, "models")
  await run([
    python,
    "-m",
    "docling.cli.tools",
    "models",
    "download",
    "layout",
    "tableformer",
    "rapidocr",
    "--output-dir",
    models,
    "--rapidocr-backend-lang",
    "torch:latin",
  ])

  await cp(join(workerRoot, "legal_evidence_worker"), join(staging, "legal_evidence_worker"), { recursive: true })
  for (const name of ["README.md", "pyproject.toml", "uv.lock"]) await cp(join(workerRoot, name), join(staging, name))

  const installedVersion = (await runCapture([python, "--version"])).replace(/^Python\s+/, "").trim()
  const manifest = {
    contractVersion: 1,
    runtime: "legalbuilder-evidence-worker",
    createdAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    python: {
      executable: portablePath(relative(staging, python)),
      version: installedVersion,
      distribution: "astral-python-build-standalone",
    },
    packageRoot: ".",
    models: {
      path: "models",
      included: true,
      sha256: await hashTree(models),
    },
    ocr: { engine: "rapidocr", backend: "torch", languages: ["latin"] },
    lockSha256: await hashFile(join(workerRoot, "uv.lock")),
  }
  await Bun.write(join(staging, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)

  await rm(output, { recursive: true, force: true })
  await rename(staging, output)
  console.log(`Built relocatable evidence worker at ${output}`)
} catch (error) {
  await rm(staging, { recursive: true, force: true })
  throw error
}

async function findManagedPython(root: string, version: string) {
  const name = process.platform === "win32" ? "python.exe" : `python${version.split(".").slice(0, 2).join(".")}`
  const candidates = await findFiles(root, name)
  const candidate =
    process.platform === "win32"
      ? candidates[0]
      : candidates.find((path) => path.includes(`${sep}bin${sep}`) || path.includes(`${sep}Scripts${sep}`))
  if (!candidate) throw new Error(`uv did not install the expected managed Python executable: ${name}`)
  return candidate
}

async function findFiles(root: string, name: string): Promise<string[]> {
  const matches: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) matches.push(...(await findFiles(path, name)))
    else if (entry.name === name) matches.push(path)
  }
  return matches
}

async function hashTree(root: string) {
  const files = (await listFiles(root)).sort()
  const digest = createHash("sha256")
  for (const path of files) {
    digest.update(portablePath(relative(root, path)))
    digest.update("\0")
    digest.update(await hashFile(path))
    digest.update("\0")
  }
  return digest.digest("hex")
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
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

async function run(command: string[], cwd = desktopRoot, stdout: "inherit" | "ignore" = "inherit") {
  const processHandle = Bun.spawn(command, { cwd, stdout, stderr: "inherit" })
  const code = await processHandle.exited
  if (code !== 0) throw new Error(`Command failed (${code}): ${command[0]} ${command[1] ?? ""}`)
}

async function runCapture(command: string[], cwd = desktopRoot) {
  const processHandle = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "inherit" })
  const [code, stdout] = await Promise.all([processHandle.exited, new Response(processHandle.stdout).text()])
  if (code !== 0) throw new Error(`Command failed (${code}): ${command[0]} ${command[1] ?? ""}`)
  return stdout
}

function portablePath(value: string) {
  return value.split(sep).join("/")
}
