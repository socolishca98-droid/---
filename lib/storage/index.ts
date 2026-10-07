// lib/storage/index.ts
// Storage provider abstraction layer
// Production can switch to S3 by configuring STORAGE_PROVIDER=s3 and S3_* env vars.

import { StorageProvider } from "./types"
import { LocalStorage } from "./local"
import { S3Storage, S3Config } from "./s3"

export { LocalStorage, S3Storage }
export type { StorageProvider, S3Config }

export function createStorageProvider(): StorageProvider {
  const provider = process.env.STORAGE_PROVIDER || "local"
  if (provider === "s3") {
    const s3Config: S3Config = {
      endpoint: process.env.S3_ENDPOINT || "https://s3.amazonaws.com",
      bucket: process.env.S3_BUCKET || "loginex-uploads",
      accessKeyId: process.env.S3_ACCESS_KEY || "",
      secretAccessKey: process.env.S3_SECRET_KEY || "",
      region: process.env.S3_REGION || "us-east-1",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    }
    if (!s3Config.accessKeyId || !s3Config.secretAccessKey) {
      console.warn("[Storage] S3 credentials missing — falling back to LocalStorage")
      return new LocalStorage()
    }
    return new S3Storage(s3Config)
  }
  return new LocalStorage()
}
