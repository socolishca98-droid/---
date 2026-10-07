// lib/storage/local.ts
// Local file system storage (current default — does not break dev)

import { mkdir, readFile, unlink, writeFile, access } from "node:fs/promises"
import path from "node:path"
import { StorageProvider } from "./types"

export class LocalStorage implements StorageProvider {
  private uploadsRoot: string

  constructor(uploadsRoot: string = path.join(process.cwd(), "public", "uploads")) {
    this.uploadsRoot = uploadsRoot
  }

  async upload(fileName: string, buffer: Buffer, contentType: string): Promise<string> {
    const relativePath = fileName.replace(/\.\./g, "")
    const absolutePath = path.resolve(path.join(this.uploadsRoot, relativePath))
    const normalizedRoot = path.resolve(this.uploadsRoot)

    // Path traversal guard
    if (!absolutePath.startsWith(normalizedRoot + path.sep) && absolutePath !== normalizedRoot) {
      throw new Error("Invalid upload path: path traversal detected")
    }

    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, buffer)

    // Return URL path (not absolute filesystem path)
    return `/uploads/${path.basename(path.dirname(relativePath))}/${path.basename(fileName)}`
  }

  async read(url: string): Promise<Buffer | null> {
    // URL is /uploads/<org>/<date>/filename
    const relativePath = url.replace("/uploads/", "")
    const absolutePath = path.resolve(path.join(this.uploadsRoot, relativePath))
    const normalizedRoot = path.resolve(this.uploadsRoot)

    if (!absolutePath.startsWith(normalizedRoot + path.sep) && absolutePath !== normalizedRoot) {
      return null
    }

    try {
      return await readFile(absolutePath)
    } catch {
      return null
    }
  }

  async delete(url: string): Promise<boolean> {
    const relativePath = url.replace("/uploads/", "")
    const absolutePath = path.resolve(path.join(this.uploadsRoot, relativePath))
    const normalizedRoot = path.resolve(this.uploadsRoot)

    if (!absolutePath.startsWith(normalizedRoot + path.sep) && absolutePath !== normalizedRoot) {
      return false
    }

    try {
      await unlink(absolutePath)
      return true
    } catch {
      return false
    }
  }

  async exists(url: string): Promise<boolean> {
    const relativePath = url.replace("/uploads/", "")
    const absolutePath = path.resolve(path.join(this.uploadsRoot, relativePath))
    try {
      await access(absolutePath)
      return true
    } catch {
      return false
    }
  }
}
