// __tests__/photos-access.test.ts
//
// Фотографии документов лежат в public/uploads, а Next отдаёт всё из public
// статикой — без сессии и без проверки организации. Поэтому прокси обязан
// переписывать /uploads/** на роут с проверкой доступа, и не трогать остальные
// пути (иначе сломается весь первый контур защиты: CSRF, редиректы, роли).
//
// Запуск: npm run test:vitest

import { beforeAll, describe, expect, it } from "vitest"

import { NextRequest } from "next/server"

import { proxy } from "@/proxy"

const REWRITE_HEADER = "x-middleware-rewrite"

beforeAll(() => {
  process.env.AUTH_SECRET =
    process.env.AUTH_SECRET || "photos-proxy-test-secret-0123456789abcdef0123456789ab"
})

describe("proxy: доступ к фотографиям", () => {
  it("/uploads/** переписывается на роут с проверкой организации", async () => {
    const request = new NextRequest("http://localhost/uploads/org123/2026-09-27/ttn.jpg")

    const response = await proxy(request)

    expect(response.headers.get(REWRITE_HEADER)).toBe(
      "http://localhost/api/photos/file?path=%2Fuploads%2Forg123%2F2026-09-27%2Fttn.jpg",
    )
  })

  it("путь фото передаётся целиком, вместе с датой и именем файла", async () => {
    const request = new NextRequest(
      "http://localhost/uploads/org-abc/2026-01-05/1730000000000-x1y2z3-chek.png",
    )

    const response = await proxy(request)
    const target = response.headers.get(REWRITE_HEADER) ?? ""

    expect(target.startsWith("http://localhost/api/photos/file?path=")).toBe(true)
    expect(decodeURIComponent(target.split("path=")[1])).toBe(
      "/uploads/org-abc/2026-01-05/1730000000000-x1y2z3-chek.png",
    )
  })

  it("остальные пути не уходят на фото-роут", async () => {
    for (const path of ["/login", "/api/health", "/dashboard", "/m/orders"]) {
      const response = await proxy(new NextRequest(`http://localhost${path}`))
      const rewrite = response.headers.get(REWRITE_HEADER) ?? ""
      expect(rewrite, `${path} не должен переписываться на фото-роут`).not.toContain(
        "/api/photos/file",
      )
    }
  })
})
