// __tests__/isolation/photos-file.test.ts
//
// Фотографии документов лежат в public/uploads — а значит, Next отдаёт их
// статикой любому, кто знает ссылку. Поэтому обращения к /uploads/**
// переписываются на /api/photos/file (proxy.ts), который проверяет сессию и
// организацию. Здесь проверяем сам роут: без входа файла нет, чужая
// организация — 403, выход за пределы каталога — 400.
//
// Запуск: npm run test:isolation

import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { NextRequest } from "next/server"

import { jsonOf, seedWorld, sessionCookie, type World } from "./helpers"

import { GET as photoFileGet } from "@/app/api/photos/file/route"

const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads")
const DATE_DIR = "2026-09-27"
const FILE_NAME = "isolation-probe.jpg"
// Минимальный JPEG-заголовок: роут обязан отдать его как image/jpeg
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

let world: World
let staffA: string
let staffB: string
let driverB: string
let ownDir: string
/** Каталоги, созданные тестом: убираем за собой только их, не всё хранилище */
const createdDirs = new Set<string>()

function fileRequest(requestedPath: string, cookie?: string) {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  return new NextRequest(
    `http://localhost/api/photos/file?path=${encodeURIComponent(requestedPath)}`,
    { method: "GET", headers },
  )
}

function photoUrl(organizationId: string) {
  return `/uploads/${organizationId}/${DATE_DIR}/${FILE_NAME}`
}

beforeEach(async () => {
  world = seedWorld()
  staffA = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
  staffB = await sessionCookie({ userId: world.adminB, role: "admin", kind: "staff" })
  driverB = await sessionCookie({
    userId: world.driverUserB,
    role: "driver",
    kind: "driver",
    driverId: world.driverB,
  })

  ownDir = path.join(UPLOADS_ROOT, world.orgA, DATE_DIR)
  mkdirSync(ownDir, { recursive: true })
  writeFileSync(path.join(ownDir, FILE_NAME), JPEG_BYTES)
  createdDirs.add(path.join(UPLOADS_ROOT, world.orgA))
})

afterAll(() => {
  // За тестом не должно оставаться мусора — но чужие фото трогать нельзя,
  // поэтому удаляем только каталоги своих тестовых организаций
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true })
  createdDirs.clear()
})

describe("GET /api/photos/file", () => {
  it("своей организации файл отдаёт", async () => {
    const response = await photoFileGet(fileRequest(photoUrl(world.orgA), staffA))

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/jpeg")
    expect(response.headers.get("cache-control")).toContain("private")
    const bytes = Buffer.from(await response.arrayBuffer())
    expect(bytes.equals(JPEG_BYTES)).toBe(true)
  })

  it("сотруднику другой организации — 403, даже если файл существует", async () => {
    const response = await photoFileGet(fileRequest(photoUrl(world.orgA), staffB))

    expect(response.status).toBe(403)
    const payload = await jsonOf(response)
    expect(payload.success).toBe(false)
    // причина не раскрывает, существует ли файл
    expect(payload.error).toContain("другой организации")
  })

  it("водителю другой организации — 403", async () => {
    const response = await photoFileGet(fileRequest(photoUrl(world.orgA), driverB))
    expect(response.status).toBe(403)
  })

  it("без сессии — 401", async () => {
    const response = await photoFileGet(fileRequest(photoUrl(world.orgA)))
    expect(response.status).toBe(401)
  })

  it("выход за пределы каталога загрузок — 400", async () => {
    const response = await photoFileGet(
      fileRequest(`/uploads/${world.orgA}/../../../../etc/passwd`, staffA),
    )

    expect(response.status).toBe(400)
  })

  it("путь не из хранилища — 404", async () => {
    const response = await photoFileGet(fileRequest("/uploads/short", staffA))
    expect(response.status).toBe(404)
  })

  it("своего файла, которого нет на диске, — 404", async () => {
    const response = await photoFileGet(
      fileRequest(`/uploads/${world.orgA}/${DATE_DIR}/нет-такого-файла.jpg`, staffA),
    )
    expect(response.status).toBe(404)
  })
})
