#!/usr/bin/env bun
import { $ } from "bun"
import { chmod } from "node:fs/promises"
import { resolve } from "node:path"

import { windowsify } from "./utils"

const output = resolve(Bun.argv[2] ?? windowsify("resources/legal-workbench"))
await $`bun build --compile --minify --outfile ${output} ../legal-workbench/src/server.ts`

if (process.platform !== "win32") await chmod(output, 0o755)
if (process.platform === "darwin") await $`codesign --force --sign - ${output}`
if (
  process.platform === "win32" &&
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.LEGAL_SKIP_WINDOWS_SIGNING !== "1"
)
  await $`pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File ../../script/sign-windows.ps1 ${output}`

console.log(`Built legal workbench executable at ${output}`)
