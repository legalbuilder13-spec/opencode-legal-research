#!/usr/bin/env bun
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const staging = await mkdtemp(join(tmpdir(), "legal-web-corpus-runner-"))
const profile = join(staging, "profile")
const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "evaluate-legal-web-corpus.ts")],
  outdir: staging,
  target: "node",
  format: "esm",
  external: ["electron"],
})
if (!result.success) throw new Error(result.logs.map((log) => log.message).join("\n"))
const bundle = result.outputs[0]?.path
if (!bundle) throw new Error("Live-web corpus runner did not produce an Electron bundle")
await chmod(bundle, 0o755)

const electron = process.env.ELECTRON_EXECUTABLE ?? resolve(import.meta.dir, "../node_modules/.bin/electron")
const child = Bun.spawn([electron, "--use-mock-keychain", `--user-data-dir=${profile}`, bundle], {
  cwd: resolve(import.meta.dir, "../../.."),
  env: process.env,
  stdout: "inherit",
  stderr: "inherit",
})
try {
  const code = await child.exited
  if (code !== 0) throw new Error(`Live-web corpus runner exited ${code}`)
} finally {
  await rm(staging, { recursive: true, force: true })
}
