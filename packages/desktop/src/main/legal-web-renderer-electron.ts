import { publicHttpUrl, isPublicAddress } from "@legalbuilder/legal-research-core/public-network"
import { randomUUID } from "node:crypto"
import { BrowserWindow, session } from "electron"

import { rendererRequestDecision } from "./legal-web-renderer-policy"
import { startLegalWebRendererServer, type LegalWebRenderResult } from "./legal-web-renderer-server"

const MAX_REQUESTS = 200
const MAX_HTML_BYTES = 20 * 1024 * 1024
const MAX_SCREENSHOT_BYTES = 40 * 1024 * 1024
const MAX_DECLARED_RESOURCE_BYTES = 25 * 1024 * 1024
const MAX_WIDTH = 2_000
const MAX_HEIGHT = 12_000
const MAX_PIXELS = 60_000_000
const RENDER_TIMEOUT_MS = 30_000

export async function startElectronLegalWebRenderer() {
  return startLegalWebRendererServer(renderWithElectron)
}

async function renderWithElectron(value: string): Promise<LegalWebRenderResult> {
  const requested = await publicHttpUrl(value)
  const partition = `legal-web-capture-${randomUUID()}`
  const isolated = session.fromPartition(partition, { cache: false })
  isolated.setPermissionCheckHandler(() => false)
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))

  let requestCount = 0
  let mainStatus = 0
  let mainFinalUrl = requested.toString()
  let securityFailure: Error | undefined
  const filter = { urls: ["<all_urls>"] }
  isolated.webRequest.onBeforeRequest(filter, (details, callback) => {
    requestCount += 1
    if (requestCount > MAX_REQUESTS) {
      securityFailure = new Error(`Rendered page exceeded the ${MAX_REQUESTS}-request limit`)
      callback({ cancel: true })
      return
    }
    void rendererRequestDecision(details).then((decision) => {
      if (decision.allow) {
        callback({})
        return
      }
      if (details.resourceType === "mainFrame" || decision.reason.includes("private"))
        securityFailure = new Error(`Renderer blocked ${details.resourceType}: ${decision.reason}`)
      callback({ cancel: true })
    })
  })
  isolated.webRequest.onHeadersReceived(filter, (details, callback) => {
    const length = contentLength(details.responseHeaders)
    if (length !== undefined && length > MAX_DECLARED_RESOURCE_BYTES) {
      securityFailure = new Error(`Renderer blocked an oversized ${details.resourceType} response`)
      callback({ cancel: true })
      return
    }
    callback({})
  })
  isolated.webRequest.onBeforeRedirect(filter, (details) => {
    if (details.ip && !isPublicAddress(details.ip))
      securityFailure = new Error("Renderer connected to a local, private, or reserved network address")
  })
  isolated.webRequest.onCompleted(filter, (details) => {
    if (details.resourceType !== "mainFrame") return
    mainStatus = details.statusCode
    mainFinalUrl = details.url
  })
  isolated.on("will-download", (event) => event.preventDefault())

  const window = new BrowserWindow({
    show: false,
    width: 1_440,
    height: 900,
    webPreferences: {
      partition,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: false,
      javascript: true,
      images: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-attach-webview", (event) => event.preventDefault())

  try {
    await withTimeout(
      window.loadURL(requested.toString(), { userAgent: "LegalBuilderResearch/0.1 strict-visual-capture" }),
      RENDER_TIMEOUT_MS,
    )
    await delay(750)
    if (securityFailure) throw securityFailure
    const finalUrl = await publicHttpUrl(window.webContents.getURL() || mainFinalUrl)
    if (mainStatus < 200 || mainStatus >= 300) throw new Error(`Rendered URL returned HTTP ${mainStatus || "unknown"}`)

    const snapshot = await window.webContents.executeJavaScript(
      `(() => {
      const root = document.documentElement
      const body = document.body
      return {
        html: root ? root.outerHTML : "",
        width: Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0, 1),
        height: Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0, 1),
      }
    })()`,
      true,
    )
    const html = typeof snapshot?.html === "string" ? snapshot.html : ""
    const htmlBytes = new TextEncoder().encode(html)
    if (!htmlBytes.byteLength || htmlBytes.byteLength > MAX_HTML_BYTES)
      throw new Error(`Rendered HTML is empty or exceeds ${MAX_HTML_BYTES} bytes`)
    const dimensions = boundedDimensions(snapshot?.width, snapshot?.height)
    window.setContentSize(dimensions.width, dimensions.height)
    const image = await window.webContents.capturePage(
      { x: 0, y: 0, width: dimensions.width, height: dimensions.height },
      { stayHidden: true, stayAwake: true },
    )
    const screenshot = image.toPNG()
    if (!screenshot.byteLength || screenshot.byteLength > MAX_SCREENSHOT_BYTES)
      throw new Error(`Rendered screenshot is empty or exceeds ${MAX_SCREENSHOT_BYTES} bytes`)
    return {
      finalUrl: finalUrl.toString(),
      status: mainStatus,
      html: htmlBytes,
      screenshot,
      screenshotMime: "image/png",
    }
  } finally {
    if (!window.isDestroyed()) window.destroy()
    isolated.webRequest.onBeforeRequest(null)
    isolated.webRequest.onHeadersReceived(null)
    isolated.webRequest.onBeforeRedirect(null)
    isolated.webRequest.onCompleted(null)
    isolated.setPermissionCheckHandler(null)
    isolated.setPermissionRequestHandler(null)
    await isolated.clearStorageData().catch(() => undefined)
    await isolated.clearCache().catch(() => undefined)
  }
}

function boundedDimensions(width: unknown, height: unknown) {
  const boundedWidth = Math.min(MAX_WIDTH, Math.max(1, Math.ceil(Number(width) || 0)))
  const boundedHeight = Math.min(MAX_HEIGHT, Math.max(1, Math.ceil(Number(height) || 0)))
  if (boundedWidth * boundedHeight > MAX_PIXELS)
    throw new Error(`Rendered page exceeds the ${MAX_PIXELS}-pixel capture limit`)
  return { width: boundedWidth, height: boundedHeight }
}

function contentLength(headers: Record<string, string[]> | undefined) {
  const value = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === "content-length")?.[1]?.[0]
  const length = Number(value)
  return Number.isFinite(length) && length >= 0 ? length : undefined
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Renderer exceeded ${milliseconds}ms`)), milliseconds)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
