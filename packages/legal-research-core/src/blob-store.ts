import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

export interface StoredBlob {
  sha256: string
  size: number
  path: string
  created: boolean
}

export class BlobStore {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async put(bytes: Uint8Array): Promise<StoredBlob> {
    const sha256 = hashBytes(bytes)
    const path = this.path(sha256)
    await mkdir(dirname(path), { recursive: true })
    if (await exists(path)) {
      const current = new Uint8Array(await readFile(path))
      if (hashBytes(current) !== sha256) throw new Error(`Content-addressed blob failed integrity check: ${sha256}`)
      return { sha256, size: current.byteLength, path, created: false }
    }

    const temporary = join(dirname(path), `.${sha256}.${randomUUID()}.tmp`)
    await Bun.write(temporary, bytes)
    const persisted = new Uint8Array(await readFile(temporary))
    if (hashBytes(persisted) !== sha256) throw new Error(`Temporary blob failed integrity check: ${sha256}`)
    await rename(temporary, path)
    return { sha256, size: bytes.byteLength, path, created: true }
  }

  async verify(sha256: string) {
    const path = this.path(sha256)
    const bytes = new Uint8Array(await readFile(path))
    return { valid: hashBytes(bytes) === sha256, size: bytes.byteLength, path }
  }

  path(sha256: string) {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid blob hash")
    return join(this.root, sha256.slice(0, 2), sha256.slice(2, 4), sha256)
  }
}

export function hashBytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

export function hashText(text: string) {
  return hashBytes(new TextEncoder().encode(text))
}

async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}
