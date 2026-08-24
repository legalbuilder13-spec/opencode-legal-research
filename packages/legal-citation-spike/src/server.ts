import { join } from "node:path"
import { seedDemo } from "./demo"
import { CitationStore } from "./store"

const store = new CitationStore()
const demo = await seedDemo(store)
const webRoot = join(import.meta.dir, "web")
const port = Number(process.env.PORT ?? 3210)

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/api/demo") return Response.json(demo)
    if (url.pathname.startsWith("/api/citations/")) {
      const citation = store.resolveCitation(decodeURIComponent(url.pathname.slice("/api/citations/".length)))
      return citation ? Response.json(citation) : new Response("Citation not found", { status: 404 })
    }
    if (url.pathname.startsWith("/assets/page/")) {
      const passageId = decodeURIComponent(url.pathname.slice("/assets/page/".length))
      const asset = store.pageAsset(passageId)
      return asset ? new Response(Bun.file(asset)) : new Response("Page not found", { status: 404 })
    }
    const staticPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1)
    if (!staticPath.match(/^(index\.html|app\.js|styles\.css)$/)) return new Response("Not found", { status: 404 })
    return new Response(Bun.file(join(webRoot, staticPath)))
  },
})

console.log(`Legal citation spike listening on ${server.url}`)

function shutdown() {
  server.stop(true)
  store.close()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
