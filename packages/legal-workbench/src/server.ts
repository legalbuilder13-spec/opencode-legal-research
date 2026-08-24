import { resolve } from "node:path"
import { createWorkbench } from "./app"
import { localEvidenceWorker, unavailableEvidenceWorker } from "./ingestion"
import { discoverEvidenceWorkerRuntime } from "./worker-runtime"

const dataRoot = resolve(process.env.LEGAL_RESEARCH_DATA_DIR ?? resolve(import.meta.dir, "../.data"))
const configuredWorkerRoot = process.env.LEGAL_EVIDENCE_WORKER_DIR
const workerRoot = resolve(configuredWorkerRoot ?? resolve(import.meta.dir, "../../legal-evidence-worker"))
const worker = discoverEvidenceWorkerRuntime(workerRoot)
const workerReady = worker.status === "ready"
const workerDetail = worker.detail
const workbench = await createWorkbench({
  dataRoot,
  fixtureAccount: process.env.LEGAL_WORKBENCH_FIXTURE_ACCOUNT === "1",
  citationDemo: false,
  workerRunner: workerReady ? localEvidenceWorker(workerRoot) : unavailableEvidenceWorker(workerDetail),
  runtimeCapabilities: {
    evidenceWorker: { status: workerReady ? "ready" : "unavailable", detail: workerDetail },
    strictVisualWebRenderer: {
      status: "unavailable",
      detail: "No packaged supervised browser renderer is available",
    },
  },
})
const port = Number(process.env.PORT ?? 3212)
const hostname = process.env.LEGAL_WORKBENCH_HOST ?? "127.0.0.1"
const server = Bun.serve({ port, hostname, fetch: workbench.handler })

console.log(`Legal research workbench listening on ${server.url}`)

function shutdown() {
  server.stop(true)
  workbench.close()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
