#!/usr/bin/env bun
import { $ } from "bun"
import { resolve } from "node:path"

import { downloadCliToResources, resolveChannel } from "./utils"
import { auditDesktopLicenses, desktopLicenseReceiptName } from "./desktop-license-audit"

const channel = resolveChannel()
await auditDesktopLicenses(resolve(import.meta.dir, "../../.."), {
  writeTo: resolve(import.meta.dir, "..", "resources", desktopLicenseReceiptName),
})
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`
await $`bun ./scripts/build-legal-workbench.ts`
if (process.env.LEGAL_BUNDLE_EVIDENCE_WORKER === "1") await $`bun ./scripts/build-evidence-worker.ts`

await $`cd ../opencode && bun script/build-node.ts`
if (channel === "dev") await downloadCliToResources()
