// __tests__/routes/date-range.test.ts
//
// Период выборки рейсов для истории: разбор query и условие для БД.
// Проверяем ровно то, из-за чего история рейсов врала: «за сегодня» без
// дописанного конца дня, молчаливое проглатывание мусора вместо 400 и
// отменённые рейсы, выпадающие из выборки по периоду.

import { describe, expect, it } from "vitest"

import { parseDateParam, routePeriodWhere } from "@/lib/routes/date-range"

describe("parseDateParam", () => {
  it("нет параметра — границы нет, это не ошибка", () => {
    expect(parseDateParam(null, false)).toEqual({ ok: true, value: null })
    expect(parseDateParam("", false)).toEqual({ ok: true, value: null })
    expect(parseDateParam("   ", true)).toEqual({ ok: true, value: null })
  })

  it("YYYY-MM-DD → начало дня", () => {
    const result = parseDateParam("2026-10-01", false)
    expect(result.ok).toBe(true)
    if (!result.ok || !result.value) throw new Error("ожидалась дата")
    // Локаль теста — Europe/Moscow, но сравнение идёт через UTC-компоненты,
    // поэтому фиксируем именно календарные числа.
    expect(result.value.getUTCFullYear()).toBe(2026)
    expect(result.value.getUTCMonth()).toBe(9)
    expect(result.value.getUTCDate()).toBe(1)
    expect(result.value.getUTCHours()).toBe(0)
    expect(result.value.getUTCMinutes()).toBe(0)
  })

  it("конец дня дописывает 23:59:59.999 — иначе «по 17.10» отсекало бы сегодня", () => {
    const result = parseDateParam("2026-10-17", true)
    expect(result.ok).toBe(true)
    if (!result.ok || !result.value) throw new Error("ожидалась дата")
    expect(result.value.getUTCHours()).toBe(23)
    expect(result.value.getUTCMinutes()).toBe(59)
    expect(result.value.getUTCSeconds()).toBe(59)
    expect(result.value.getUTCMilliseconds()).toBe(999)
  })

  it("полный ISO принимается как есть", () => {
    const result = parseDateParam("2026-10-05T12:30:00.000Z", false)
    expect(result.ok).toBe(true)
    if (!result.ok || !result.value) throw new Error("ожидалась дата")
    expect(result.value.toISOString()).toBe("2026-10-05T12:30:00.000Z")
  })

  it("мусор даёт ok=false — период не превращается в «за всё время»", () => {
    expect(parseDateParam("32.01.2026", false).ok).toBe(false)
    expect(parseDateParam("вчера", false).ok).toBe(false)
    expect(parseDateParam("2026-13-45", false).ok).toBe(false)
    expect(parseDateParam("2026", false).ok).toBe(false)
  })
})

describe("routePeriodWhere", () => {
  it("без границ условия нет", () => {
    expect(routePeriodWhere(null, null)).toBeNull()
  })

  it("только начало — только gte", () => {
    const from = new Date("2026-10-01T00:00:00.000Z")
    expect(routePeriodWhere(from, null)).toEqual({
      OR: [{ completedAt: { gte: from } }, { completedAt: null, createdAt: { gte: from } }],
    })
  })

  it("обе границы — и завершение, и создание для отменённых", () => {
    const from = new Date("2026-10-01T00:00:00.000Z")
    const to = new Date("2026-10-17T23:59:59.999Z")
    const where = routePeriodWhere(from, to)
    expect(where).toEqual({
      OR: [
        { completedAt: { gte: from, lte: to } },
        { completedAt: null, createdAt: { gte: from, lte: to } },
      ],
    })
  })
})
