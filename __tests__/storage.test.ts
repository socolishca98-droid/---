// __tests__/storage.test.ts
//
// Хранилище фото (lib/storage.ts) — обещание простое: файл, положенный в
// хранилище, оттуда же и читается; файл чужой организации или с чужим путём
// не читается никогда; переезд на S3 не должен ломать старое фото.
//
// Запуск: npm run test:vitest

import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  StorageError,
  buildStorageKey,
  contentTypeForFileName,
  normalizeStorageKey,
  organizationFromStorageKey,
  photoExists,
  photoUrlFromKey,
  putPhoto,
  readPhoto,
  readPhotoByUrl,
  removePhoto,
  storageKeyFromPhotoUrl,
} from "@/lib/storage"

const ORG = "org-a1b2c3"
const DATE = "2026-10-12"
const FILE = "1730000000000-x1y2z3-chek.jpg"
const KEY = `${ORG}/${DATE}/${FILE}`

let localRoot: string

/** Временный каталог вместо public/uploads: тест не трогает боевые фото. */
function useLocalStorage() {
  localRoot = mkdtempSync(path.join(tmpdir(), "loginex-storage-"))
  process.env.STORAGE_LOCAL_ROOT = localRoot
  delete process.env.STORAGE_DRIVER
}

function useS3Storage() {
  process.env.STORAGE_DRIVER = "s3"
  process.env.STORAGE_S3_ENDPOINT = "https://storage.example.cloud"
  process.env.STORAGE_S3_BUCKET = "loginex-photos"
  process.env.STORAGE_S3_REGION = "ru-central1"
  process.env.STORAGE_S3_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"
  process.env.STORAGE_S3_SECRET_ACCESS_KEY = "secret-example-key"
  process.env.STORAGE_S3_PREFIX = "photos"
  delete process.env.STORAGE_LOCAL_ROOT
}

/** Перехват fetch: запоминаем запрос и отвечаем заранее заданным статусом. */
function stubFetch(status: number, body?: Uint8Array) {
  const calls: { url: string; method: string; headers: Headers }[] = []
  vi.stubGlobal("fetch", async (input: URL | string, init?: RequestInit) => {
    const headers = new Headers(init?.headers as HeadersInit)
    calls.push({ url: String(input), method: String(init?.method), headers })
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => (body ?? new Uint8Array()).buffer,
    } as Response
  })
  return calls
}

const storageEnvKeys = [
  "STORAGE_DRIVER",
  "STORAGE_LOCAL_ROOT",
  "STORAGE_S3_ENDPOINT",
  "STORAGE_S3_BUCKET",
  "STORAGE_S3_REGION",
  "STORAGE_S3_ACCESS_KEY_ID",
  "STORAGE_S3_SECRET_ACCESS_KEY",
  "STORAGE_S3_PREFIX",
  "STORAGE_S3_PATH_STYLE",
]

let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = Object.fromEntries(storageEnvKeys.map((key) => [key, process.env[key]]))
})

afterEach(() => {
  for (const key of storageEnvKeys) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  vi.unstubAllGlobals()
  if (localRoot) rmSync(localRoot, { recursive: true, force: true })
  localRoot = ""
})

describe("ключи и ссылки фото", () => {
  it("ключ собирается из организации, даты и имени файла", () => {
    expect(buildStorageKey({ organizationId: ORG, dateKey: DATE, fileName: FILE })).toBe(KEY)
  })

  it("недопустимые части ключа не собираются", () => {
    expect(buildStorageKey({ organizationId: "../../etc", dateKey: DATE, fileName: FILE })).toBeNull()
    expect(buildStorageKey({ organizationId: ORG, dateKey: DATE, fileName: "фото чек.jpg" })).toBeNull()
    expect(buildStorageKey({ organizationId: "", dateKey: DATE, fileName: FILE })).toBeNull()
    expect(buildStorageKey({ organizationId: ORG, dateKey: DATE, fileName: ".hidden" })).toBeNull()
  })

  it("ссылка и ключ — два вида одной и той же строки", () => {
    expect(photoUrlFromKey(KEY)).toBe(`/uploads/${KEY}`)
    expect(storageKeyFromPhotoUrl(`/uploads/${KEY}`)).toBe(KEY)
    expect(storageKeyFromPhotoUrl(KEY)).toBe(KEY)
    expect(storageKeyFromPhotoUrl(`/uploads/${KEY}?v=2`)).toBe(KEY)
    expect(organizationFromStorageKey(KEY)).toBe(ORG)
  })

  it("всё, что не наш ключ фото, отбрасывается", () => {
    const bad = [
      "",
      "/",
      "/uploads/",
      "/uploads/org/",
      "/uploads/org/2026-10-12",
      "/uploads/org/2026-10-12/../../etc/passwd",
      "/uploads/org/2026-10-12/..",
      "/uploads//2026-10-12/file.jpg",
      "/uploads/org/2026-10-12/sub dir/file.jpg",
      "/uploads/org/2026-10-12/file.jpg/extra",
      "https://example.com/uploads/org/2026-10-12/file.jpg",
      "/uploads/org/2026-10-12/file.jpg\\windows",
      "/etc/passwd",
    ]
    for (const value of bad) {
      expect(normalizeStorageKey(value), value).toBeNull()
    }
  })

  it("content-type определяется по расширению", () => {
    expect(contentTypeForFileName("a.jpg")).toBe("image/jpeg")
    expect(contentTypeForFileName("a.PNG")).toBe("image/png")
    expect(contentTypeForFileName("a.pdf")).toBe("application/pdf")
    expect(contentTypeForFileName("a.bin")).toBe("application/octet-stream")
  })
})

describe("local-драйвер (по умолчанию)", () => {
  it("положил — прочитал: байты совпадают", async () => {
    useLocalStorage()
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

    await putPhoto(KEY, bytes, "image/jpeg")

    const read = await readPhoto(KEY)
    expect(read?.equals(bytes)).toBe(true)
    expect(await photoExists(KEY)).toBe(true)
    expect(existsSync(path.join(localRoot, ORG, DATE, FILE))).toBe(true)
  })

  it("чтение по ссылке из базы работает так же", async () => {
    useLocalStorage()
    const bytes = Buffer.from("receipt-bytes")
    await putPhoto(KEY, bytes)

    expect((await readPhotoByUrl(`/uploads/${KEY}`))?.toString()).toBe("receipt-bytes")
  })

  it("несуществующий файл — null, а не ошибка", async () => {
    useLocalStorage()
    expect(await readPhoto(`${ORG}/${DATE}/no-such-file.jpg`)).toBeNull()
    expect(await photoExists(`${ORG}/${DATE}/no-such-file.jpg`)).toBe(false)
  })

  it("удаление убирает файл", async () => {
    useLocalStorage()
    await putPhoto(KEY, Buffer.from("x"))
    await removePhoto(KEY)
    expect(await photoExists(KEY)).toBe(false)
  })

  it("недопустимый ключ не ломает запись и чтение", async () => {
    useLocalStorage()
    await expect(putPhoto("../../etc/passwd", Buffer.from("x"))).rejects.toBeInstanceOf(StorageError)
    expect(await readPhoto("../../etc/passwd")).toBeNull()
    expect(await photoExists("../outside.jpg")).toBe(false)
  })
})

describe("s3-драйвер", () => {
  it("запись уходит PUT с подписью и префиксом бакета", async () => {
    useS3Storage()
    const calls = stubFetch(200)

    await putPhoto(KEY, Buffer.from("hello"), "image/jpeg")

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe("PUT")
    expect(calls[0].url).toBe(
      "https://loginex-photos.storage.example.cloud/photos/org-a1b2c3/2026-10-12/1730000000000-x1y2z3-chek.jpg",
    )
    const authorization = calls[0].headers.get("authorization") ?? ""
    expect(authorization.startsWith("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/")).toBe(true)
    expect(authorization).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date")
    expect(authorization).toMatch(/Signature=[0-9a-f]{64}$/)
    expect(calls[0].headers.get("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/)
    expect(calls[0].headers.get("content-type")).toBe("image/jpeg")
  })

  it("чтение отдаёт байты объекта", async () => {
    useS3Storage()
    stubFetch(200, new Uint8Array([1, 2, 3, 4]))

    const bytes = await readPhoto(KEY)

    expect(bytes?.equals(Buffer.from([1, 2, 3, 4]))).toBe(true)
  })

  it("404 из хранилища — файла нет (null), а не ошибка", async () => {
    useS3Storage()
    stubFetch(404)

    expect(await readPhoto(KEY)).toBeNull()
    expect(await photoExists(KEY)).toBe(false)
  })

  it("ошибка хранилища превращается в понятное сообщение", async () => {
    useS3Storage()
    stubFetch(500)

    await expect(readPhoto(KEY)).rejects.toThrow(/Хранилище не отдало фото/)
  })

  it("файл, загруженный до включения S3, читается с диска", async () => {
    useS3Storage()
    // на диске старое фото, в S3 его нет
    localRoot = mkdtempSync(path.join(tmpdir(), "loginex-storage-legacy-"))
    process.env.STORAGE_LOCAL_ROOT = localRoot
    const legacy = path.join(localRoot, ORG, DATE)
    mkdirSync(legacy, { recursive: true })
    writeFileSync(path.join(legacy, FILE), "old-photo-bytes")

    stubFetch(404)

    expect((await readPhoto(KEY))?.toString()).toBe("old-photo-bytes")
    expect(await photoExists(KEY)).toBe(true)
  })

  it("без ключей доступа S3 не молчит, а объясняет что задать", async () => {
    process.env.STORAGE_DRIVER = "s3"
    process.env.STORAGE_S3_ENDPOINT = "https://storage.example.cloud"
    delete process.env.STORAGE_S3_BUCKET
    delete process.env.STORAGE_S3_ACCESS_KEY_ID
    delete process.env.STORAGE_S3_SECRET_ACCESS_KEY
    stubFetch(200)

    await expect(putPhoto(KEY, Buffer.from("x"))).rejects.toThrow(/STORAGE_S3_BUCKET/)
  })
})
