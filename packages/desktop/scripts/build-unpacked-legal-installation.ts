#!/usr/bin/env bun
import { readdir, rename, rm } from "node:fs/promises"
import { join, resolve } from "node:path"

const desktopRoot = resolve(import.meta.dir, "..")
const sourceWorker = resolve(Bun.argv[2] ?? "")
const installedWorker = join(desktopRoot, "resources", "legal-evidence-worker")
const fixture = resolve(desktopRoot, "../legal-evidence-worker/fixtures/generated/scan_page_1.png")

if (!Bun.argv[2]) throw new Error("usage: bun build-unpacked-legal-installation.ts WORKER_RESOURCE")
if (!(await Bun.file(join(sourceWorker, "runtime-manifest.json")).exists()))
  throw new Error(`Evidence-worker resource is invalid: ${sourceWorker}`)

await rm(installedWorker, { recursive: true, force: true })
await rename(sourceWorker, installedWorker)
await run([bun(), "run", "build"])
await run([bunx(), "electron-builder", ...platformArguments(), "--dir", "--publish", "never", "--config", "electron-builder.config.ts"])

const resourcesPath = await packagedResourcesPath()
await run([bun(), "./scripts/verify-legal-installation.ts", resourcesPath, fixture])
console.log(`Unpacked ${process.platform}-${process.arch} legal installation passed: ${resourcesPath}`)

function platformArguments() {
  if (process.platform === "darwin") return ["--mac", process.arch === "arm64" ? "--arm64" : "--x64"]
  if (process.platform === "win32") return ["--win", process.arch === "arm64" ? "--arm64" : "--x64"]
  if (process.platform === "linux") return ["--linux", process.arch === "arm64" ? "--arm64" : "--x64"]
  throw new Error(`Unsupported installer platform: ${process.platform}-${process.arch}`)
}

async function packagedResourcesPath() {
  if (process.platform === "win32") return join(desktopRoot, "dist", "win-unpacked", "resources")
  if (process.platform === "linux") return join(desktopRoot, "dist", "linux-unpacked", "resources")
  const directory = join(desktopRoot, "dist", process.arch === "arm64" ? "mac-arm64" : "mac")
  const app = (await readdir(directory, { withFileTypes: true })).find(
    (entry) => entry.isDirectory() && entry.name.endsWith(".app"),
  )
  if (!app) throw new Error(`Packaged macOS application is missing: ${directory}`)
  return join(directory, app.name, "Contents", "Resources")
}

function bun() {
  const executable = Bun.which("bun")
  if (!executable) throw new Error("Bun executable is unavailable")
  return executable
}

function bunx() {
  const executable = Bun.which(process.platform === "win32" ? "bunx.exe" : "bunx")
  if (!executable) throw new Error("bunx executable is unavailable")
  return executable
}

async function run(command: string[]) {
  const processHandle = Bun.spawn(command, {
    cwd: desktopRoot,
    env: {
      ...process.env,
      OPENCODE_CHANNEL: "prod",
      LEGAL_SKIP_WINDOWS_SIGNING: "1",
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  })
  const code = await processHandle.exited
  if (code !== 0) throw new Error(`Command failed (${code}): ${command.slice(0, 2).join(" ")}`)
}
