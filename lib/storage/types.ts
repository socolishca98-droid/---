// lib/storage/types.ts
// Storage provider abstraction for file storage (Task 4 — prepare S3 transition)

export interface StorageProvider {
  /** Upload a file and return its public-accessible URL */
  upload(fileName: string, buffer: Buffer, contentType: string): Promise<string>
  /** Read a file by its URL/path */
  read(url: string): Promise<Buffer | null>
  /** Delete a file */
  delete(url: string): Promise<boolean>
  /** Check if the file exists */
  exists(url: string): Promise<boolean>
}
