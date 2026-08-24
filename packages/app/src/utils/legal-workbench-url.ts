const DEFAULT_LEGAL_WORKBENCH_URL = "http://127.0.0.1:3212"

export function legalWorkbenchUrl(configured?: string) {
  if (!configured) return DEFAULT_LEGAL_WORKBENCH_URL
  try {
    const url = new URL(configured)
    if (url.protocol === "http:" || url.protocol === "https:") return url.href.replace(/\/$/, "")
  } catch {
    return DEFAULT_LEGAL_WORKBENCH_URL
  }
  return DEFAULT_LEGAL_WORKBENCH_URL
}
