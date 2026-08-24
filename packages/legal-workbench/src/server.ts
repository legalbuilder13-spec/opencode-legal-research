import { resolve } from "node:path"
import { createWorkbench } from "./app"
import { localEvidenceWorker, unavailableEvidenceWorker } from "./ingestion"
import { httpWebCaptureRenderer, rendererHealth } from "./web-capture"
import { discoverEvidenceWorkerRuntime } from "./worker-runtime"

const dataRoot = resolve(process.env.LEGAL_RESEARCH_DATA_DIR ?? resolve(import.meta.dir, "../.data"))
const configuredWorkerRoot = process.env.LEGAL_EVIDENCE_WORKER_DIR
const workerRoot = resolve(configuredWorkerRoot ?? resolve(import.meta.dir, "../../legal-evidence-worker"))
const worker = discoverEvidenceWorkerRuntime(workerRoot)
const workerReady = worker.status === "ready"
const workerDetail = worker.detail
const rendererEndpoint = process.env.LEGAL_WEB_RENDERER_URL
const rendererToken = process.env.LEGAL_WEB_RENDERER_TOKEN
const rendererConfigured = Boolean(rendererEndpoint && rendererToken)
const rendererReady = rendererConfigured && (await rendererHealth({ endpoint: rendererEndpoint! }))
const renderer = rendererReady
  ? httpWebCaptureRenderer({ endpoint: rendererEndpoint!, token: rendererToken! })
  : undefined
const rendererDetail = rendererReady
  ? "Supervised isolated Electron renderer is ready"
  : rendererConfigured
    ? "Configured supervised renderer failed its health contract"
    : "No packaged supervised browser renderer is available"
const workbench = await createWorkbench({
  dataRoot,
  fixtureAccount: process.env.LEGAL_WORKBENCH_FIXTURE_ACCOUNT === "1",
  citationDemo: false,
  workerRunner: workerReady ? localEvidenceWorker(workerRoot) : unavailableEvidenceWorker(workerDetail),
  webCapture: renderer ? { renderer } : undefined,
  runtimeCapabilities: {
    evidenceWorker: { status: workerReady ? "ready" : "unavailable", detail: workerDetail },
    strictVisualWebRenderer: {
      status: rendererReady ? "ready" : "unavailable",
      detail: rendererDetail,
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
