// __tests__/isolation/photo-storage-db.test.ts
//
// Драйвер хранилища db (STORAGE_DRIVER=db): байты фото лежат в базе, а не на
// диске. Это единственный драйвер, который работает на Vercel и любом другом
// serverless, где файловая система функций только для чтения.
//
// Что проверяем по-настоящему (роут вызывается напрямую, база — настоящая
// in-memory):
//   * фото, лежащее в базе, отдаётся через /api/photos/file с тем же
//     content-type и теми же байтами, что и с диска;
//   * ссылка в базе не меняется: url прежний, доступ — только своя
//     организация (чужая получает отказ, а не файл);
//   * файла на диске при db-драйвере не появляется.

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import path from "node:path"

import { NextRequest } from "next/server"

import { seedWorld, sessionCookie, type World } from "./helpers"
import { memoryDb } from "../__mocks__/prisma-memory"
import { GET as photoFileGet } from "@/app/api/photos/file/route"
import { normalizeStorageKey, readPhoto, storageKind } from "@/lib/storage"

const DATE_DIR = "2026-10-18"
const FILE_NAME = "db-driver-probe.jpg"
// Минимальный JPEG-заголовок: роут обязан отдать его как image/jpeg
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])

let world: World
let staffA: string
let staffB: string
let savedDriver: string | undefined
/** Ключ фото организации А: <организация>/<дата>/<имя>. */
let key: string

beforeEach(async () => {
  savedDriver = process.env.STORAGE_DRIVER
  process.env.STORAGE_DRIVER = "db"
  world = seedWorld()
  key = `${world.orgA}/${DATE_DIR}/${FILE_NAME}`
  staffA = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
  staffB = await sessionCookie({ userId: world.adminB, role: "admin", kind: "staff" })

  // Фото организации А: байты в базе, ссылка — обычная, как у дисковых
  memoryDb.insert("photo", {
    id: world.photoA,
    organizationId: world.orgA,
    url: `/uploads/${key}`,
    type: "cargo_before",
    driverId: world.driverA,
    orderId: world.orderA,
    storageKey: key,
    mime: "image/jpeg",
    bytes: JPEG_BYTES,
  })
})

afterEach(() => {
  if (savedDriver === undefined) delete process.env.STORAGE_DRIVER
  else process.env.STORAGE_DRIVER = savedDriver
})

function fileRequest(requestedPath: string, cookie?: string) {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  return new NextRequest(`http://localhost/api/photos/file?path=${encodeURIComponent(requestedPath)}`, {
    method: "GET",
    headers,
  })
}

describe("драйвер хранилища db", () => {
  it("STORAGE_DRIVER=db выбирает именно его", () => {
    expect(storageKind()).toBe("db")
  })

  it("фото из базы отдаётся тем же content-type и теми же байтами", async () => {
    const res = await photoFileGet(fileRequest(`/uploads/${key}`, staffA))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/jpeg")
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.equals(JPEG_BYTES)).toBe(true)
  })

  it("обращение к /uploads/... (после рерайта proxy) так же читает из базы", async () => {
    const res = await photoFileGet(
      new NextRequest(`http://localhost/uploads/${key}`, {
        method: "GET",
        headers: { cookie: staffA },
      }),
    )
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(JPEG_BYTES)).toBe(true)
  })

  it("файла на диске не появляется: байты живут в базе", async () => {
    const diskPath = path.join(process.cwd(), "public", "uploads", world.orgA, DATE_DIR, FILE_NAME)
    expect(existsSync(diskPath)).toBe(false)
    const fromStorage = await readPhoto(normalizeStorageKey(`/uploads/${key}`) as string)
    expect(fromStorage?.equals(JPEG_BYTES)).toBe(true)
  })

  it("чужой организации фото из базы не отдаётся", async () => {
    const res = await photoFileGet(fileRequest(`/uploads/${key}`, staffB))
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBeTruthy()
  })

  it("без сессии фото из базы не отдаётся", async () => {
    const res = await photoFileGet(fileRequest(`/uploads/${key}`))
    expect(res.status).toBe(401)
  })

  it("фото без байтов в базе читается с диска (переезд со старого драйвера)", async () => {
    memoryDb.insert("photo", {
      id: world.photoB,
      organizationId: world.orgB,
      url: `/uploads/${world.orgB}/${DATE_DIR}/old-disk.jpg`,
      type: "cargo_before",
      driverId: world.driverB,
      orderId: world.orderB,
      storageKey: null,
      bytes: null,
    })
    const bytes = await readPhoto(`${world.orgB}/${DATE_DIR}/old-disk.jpg`)
    // Файла на диске нет — это не ошибка, просто null
    expect(bytes).toBeNull()
  })
})
