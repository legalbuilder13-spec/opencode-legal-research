import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

export type PublicAddressResolver = (hostname: string) => Promise<string[]>

export async function resolvePublicAddresses(hostname: string) {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address)
}

export async function publicHttpUrl(value: string, resolver: PublicAddressResolver = resolvePublicAddresses) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Enter a valid public HTTP(S) URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only public HTTP(S) URLs are allowed")
  if (url.username || url.password) throw new Error("URL credentials are not allowed")
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Only standard HTTP(S) ports are allowed")
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost"))
    throw new Error("Local and private URLs are not allowed")
  const addresses = isIP(hostname) ? [hostname] : await resolver(hostname)
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address)))
    throw new Error("Local, private, and reserved network addresses are not allowed")
  url.hash = ""
  return url
}

export function isPublicAddress(value: string): boolean {
  if (value.includes(":")) {
    const address = value.toLowerCase()
    if (address === "::" || address === "::1" || address.startsWith("fc") || address.startsWith("fd")) return false
    if (/^fe[89ab]/.test(address) || address.startsWith("ff") || address.startsWith("2001:db8:")) return false
    const mapped = mappedIpv4(address)
    return mapped ? isPublicAddress(mapped) : true
  }
  const parts = value.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a = 0, b = 0, c = 0] = parts
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0) return false
  if (a === 192 && b === 0 && c === 2) return false
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function mappedIpv4(address: string) {
  const suffix = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : undefined
  if (!suffix) return undefined
  if (/^\d+\.\d+\.\d+\.\d+$/.test(suffix)) return suffix
  const groups = suffix.split(":")
  if (groups.length !== 2 || groups.some((group) => !/^[a-f0-9]{1,4}$/.test(group))) return undefined
  const high = Number.parseInt(groups[0] ?? "", 16)
  const low = Number.parseInt(groups[1] ?? "", 16)
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
}
