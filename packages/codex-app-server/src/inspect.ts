import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { join, relative } from "node:path"
import { tmpdir } from "node:os"

export interface ProtocolManifest {
  codexVersion: string
  executableHash: string
  schemaHash: string
  schemaFileCount: number
}

export async function inspect(command = [process.env.CODEX_APP_SERVER_BIN ?? "codex"]): Promise<ProtocolManifest> {
  const executable = Bun.which(command[0] ?? "")
  if (!executable) throw new Error(`Codex executable not found: ${command[0]}`)
  const codexVersion = (await run([...command, "--version"])).trim()
  const executableHash = await hashFile(executable)
  const directory = await mkdtemp(join(tmpdir(), "legalbuilder-codex-schema-"))

  const result = await run([...command, "app-server", "generate-json-schema", "--out", directory])
    .then(() => hashDirectory(directory))
    .finally(() => rm(directory, { recursive: true, force: true }))

  return {
    codexVersion,
    executableHash,
    schemaHash: result.hash,
    schemaFileCount: result.count,
  }
}

async function hashFile(path: string) {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(await readFile(path))
  return hasher.digest("hex")
}

export function verify(actual: ProtocolManifest, expected: ProtocolManifest) {
  const mismatches = [
    mismatch("codexVersion", actual.codexVersion, expected.codexVersion),
    mismatch("executableHash", actual.executableHash, expected.executableHash),
    mismatch("schemaHash", actual.schemaHash, expected.schemaHash),
    mismatch("schemaFileCount", actual.schemaFileCount, expected.schemaFileCount),
  ].filter((value) => value !== undefined)
  if (mismatches.length) throw new Error(`Codex app-server compatibility check failed\n${mismatches.join("\n")}`)
}

export function parseManifest(value: unknown): ProtocolManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid protocol manifest")
  const manifest = Object.fromEntries(Object.entries(value))
  if (
    typeof manifest.codexVersion !== "string" ||
    typeof manifest.executableHash !== "string" ||
    typeof manifest.schemaHash !== "string" ||
    typeof manifest.schemaFileCount !== "number"
  ) {
    throw new Error("Invalid protocol manifest")
  }
  return {
    codexVersion: manifest.codexVersion,
    executableHash: manifest.executableHash,
    schemaHash: manifest.schemaHash,
    schemaFileCount: manifest.schemaFileCount,
  }
}

function mismatch(name: string, actual: string | number, expected: string | number) {
  if (actual === expected) return undefined
  return `${name}: expected ${expected}, received ${actual}`
}

async function hashDirectory(directory: string) {
  const files = await listFiles(directory)
  const hasher = new Bun.CryptoHasher("sha256")
  for (const file of files) {
    hasher.update(relative(directory, file))
    hasher.update("\0")
    hasher.update(await readFile(file))
    hasher.update("\0")
  }
  return { hash: hasher.digest("hex"), count: files.length }
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? listFiles(path) : [path]
    }),
  )
  return nested.flat().sort()
}

async function run(command: string[]) {
  const processHandle = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" })
  const result = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ])
  if (result[0] === 0) return result[1]
  throw new Error(result[2].trim() || `Command failed: ${command.join(" ")}`)
}
