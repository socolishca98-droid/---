// __tests__/pagination.test.ts
//
// Одна pagination на все списки: значения по умолчанию, зажим размера,
// честные total/hasMore. Чистые функции — тесты быстрые и понятные.

import { describe, expect, it } from "vitest"

import { paginationLabel, paginationMeta, parsePagination } from "@/lib/pagination"

describe("parsePagination", () => {
  it("значения по умолчанию: 50 строк с начала", () => {
    const pagination = parsePagination({})
    expect(pagination).toEqual({ limit: 50, offset: 0, page: 1, pageSize: 50 })
  })

  it("понимает и limit/offset, и page/pageSize", () => {
    expect(parsePagination({ limit: "20", offset: "40" })).toMatchObject({ limit: 20, offset: 40, page: 3 })
    expect(parsePagination({ page: "3", pageSize: "25" })).toMatchObject({
      limit: 25,
      offset: 50,
      page: 3,
    })
  })

  it("размер страницы зажимается сверху — 100500 строк не отдаём", () => {
    const pagination = parsePagination({ limit: "100500" }, { maxSize: 200 })
    expect(pagination.limit).toBe(200)
  })

  it("мусор в параметрах не роняет запрос", () => {
    expect(parsePagination({ limit: "abc", offset: "-5", page: "0" })).toMatchObject({
      limit: 50,
      offset: 0,
    })
  })

  it("свой размер по умолчанию для тяжёлых списков", () => {
    expect(parsePagination({}, { defaultSize: 20 }).limit).toBe(20)
  })
})

describe("paginationMeta", () => {
  it("порция без остатка: hasMore=false", () => {
    const meta = paginationMeta(10, parsePagination({ limit: "20" }))
    expect(meta).toMatchObject({ total: 10, shown: 10, hasMore: false })
    expect(paginationLabel(meta)).toBe("всего 10")
  })

  it("порция с остатком: hasMore=true и подпись показывает обе цифры", () => {
    const meta = paginationMeta(340, parsePagination({ limit: "50" }))
    expect(meta).toMatchObject({ total: 340, shown: 50, hasMore: true })
    expect(paginationLabel(meta)).toBe("показано 50 из 340")
  })

  it("последняя страница: показано только остаток", () => {
    const meta = paginationMeta(120, parsePagination({ limit: "50", offset: "100" }))
    expect(meta.shown).toBe(20)
    expect(meta.hasMore).toBe(false)
  })

  it("пустой список не ломает подпись", () => {
    const meta = paginationMeta(0, parsePagination({}))
    expect(meta.shown).toBe(0)
    expect(meta.hasMore).toBe(false)
    expect(paginationLabel(meta)).toBe("всего 0")
  })

  it("смещение за пределами списка не даёт отрицательных чисел", () => {
    const meta = paginationMeta(10, parsePagination({ limit: "50", offset: "500" }))
    expect(meta.shown).toBe(0)
    expect(meta.hasMore).toBe(false)
  })
})
