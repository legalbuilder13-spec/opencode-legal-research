import { resolve } from "node:path"
import { createWorkbench } from "./app"

const dataRoot = resolve(process.env.LEGAL_RESEARCH_DATA_DIR ?? resolve(import.meta.dir, "../.data"))
const workbench = await createWorkbench({
  dataRoot,
  fixtureAccount: process.env.LEGAL_WORKBENCH_FIXTURE_ACCOUNT === "1",
})
const port = Number(process.env.PORT ?? 3212)
const server = Bun.serve({ port, fetch: workbench.handler })

console.log(`Legal research workbench listening on ${server.url}`)

function shutdown() {
  server.stop(true)
  workbench.close()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
