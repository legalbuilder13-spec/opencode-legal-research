import { app, BrowserWindow } from "electron"
import { writeFile } from "node:fs/promises"
import { startElectronLegalWebRenderer } from "../src/main/legal-web-renderer-electron"

async function main() {
  const captureUrl = process.env.LEGAL_RENDERER_SMOKE_URL ?? "https://example.com/"
  if (process.env.LEGAL_RENDERER_SMOKE_RESULT)
    await writeFile(process.env.LEGAL_RENDERER_SMOKE_RESULT, `${JSON.stringify({ status: "starting" })}\n`)
  const keepAlive = setInterval(() => undefined, 1_000)
  await app.whenReady()
  clearInterval(keepAlive)
  const keeper = new BrowserWindow({ show: false })
  const renderer = await startElectronLegalWebRenderer()
  try {
    const response = await fetch(`${renderer.url}/render`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${renderer.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: captureUrl }),
    })
    const result: unknown = await response.json()
    if (!isRecord(result)) throw new Error("renderer returned a non-object capture contract")
    if (!response.ok)
      throw new Error(typeof result.error === "string" ? result.error : `renderer returned ${response.status}`)
    if (
      result.contractVersion !== 1 ||
      result.status !== 200 ||
      result.screenshotMime !== "image/png" ||
      typeof result.finalUrl !== "string" ||
      typeof result.htmlBase64 !== "string" ||
      typeof result.screenshotBase64 !== "string"
    )
      throw new Error("renderer returned an invalid capture contract")
    const html = Buffer.from(result.htmlBase64, "base64").toString("utf8")
    const screenshot = Buffer.from(result.screenshotBase64, "base64")
    if (!html.includes("Example Domain") || screenshot[0] !== 137 || screenshot[1] !== 80)
      throw new Error("renderer did not preserve the expected HTML and PNG evidence")
    if (process.env.LEGAL_RENDERER_SMOKE_RESULT)
      await writeFile(
        process.env.LEGAL_RENDERER_SMOKE_RESULT,
        `${JSON.stringify({ finalUrl: result.finalUrl, screenshotBytes: screenshot.byteLength })}\n`,
      )
    console.log(`Electron renderer smoke passed: ${result.finalUrl}, ${screenshot.byteLength} PNG bytes`)
  } finally {
    await renderer.listener.stop()
    keeper.destroy()
  }
  app.quit()
}

void main().catch((error: unknown) => {
  console.error(error)
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)
  const failure = process.env.LEGAL_RENDERER_SMOKE_RESULT
    ? writeFile(process.env.LEGAL_RENDERER_SMOKE_RESULT, `${JSON.stringify({ status: "failed", message })}\n`)
    : Promise.resolve()
  void failure.finally(() => app.exit(1))
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
