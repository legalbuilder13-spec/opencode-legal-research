const hiddenKeys = new Set([
  "apikey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authorization",
  "cookie",
  "password",
  "secret",
  "authurl",
  "usercode",
  "email",
  "text",
  "delta",
  "input",
])

export function redact(value: unknown): unknown {
  if (typeof value === "string") return redactText(value)
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== "object") return value

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(key, item)]))
}

export function redactText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{8,}=?/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
}

function redactValue(key: string, value: unknown) {
  if (hiddenKeys.has(normalizeKey(key))) return "[REDACTED]"
  return redact(value)
}

function normalizeKey(key: string) {
  return key.replace(/[^A-Za-z0-9]/g, "").toLowerCase()
}
