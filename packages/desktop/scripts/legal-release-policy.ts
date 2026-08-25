#!/usr/bin/env bun
import { resolve } from "node:path"

import { auditDesktopLicenses } from "./desktop-license-audit"
import { type EvidenceWorkerLicensePolicy, validateEvidenceWorkerLicensePolicy } from "./evidence-worker-license-audit"

const repository = resolve(import.meta.dir, "../../..")
const desktop = await auditDesktopLicenses(repository, { requireApproved: true })
const workerPolicyPath = resolve(repository, "packages/legal-evidence-worker/packaged-model-policy.json")
const worker = validateEvidenceWorkerLicensePolicy(
  (await Bun.file(workerPolicyPath).json()) as EvidenceWorkerLicensePolicy,
  { requireApproved: true },
)

console.log(`Release license policies approved: desktop=${desktop.reviewStatus}, worker=${worker.reviewStatus}`)
