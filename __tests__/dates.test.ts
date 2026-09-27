// lib/dates.ts — календарная дата в зоне пользователя.
//
// Проверяем в двух зонах: восточнее Гринвича (Москва, +3) и западнее
// (Нью-Йорк, −4/−5). Именно на них ломались `toISOString().slice(0, 10)` и
// `new Date("2026-09-28")`: ключи дней и значения полей даты уезжали на день.

import { afterAll, describe, expect, it } from "vitest"

import {
  DATE_KEY_PATTERN,
  parseDateValue,
  toDateInputValue,
  toLocalDateKey,
} from "@/lib/dates"

const originalTz = process.env.TZ

function setZone(zone: string) {
  process.env.TZ = zone
}

afterAll(() => {
  process.env.TZ = originalTz
})

describe("toLocalDateKey — локальная дата, а не UTC", () => {
  it("в Москве локальное полночь не уезжает на предыдущий день", () => {
    setZone("Europe/Moscow")
    // 28 сентября 2026, 00:00 по Москве = 27 сентября 21:00 UTC
    expect(toLocalDateKey(new Date(2026, 8, 28, 0, 0, 0))).toBe("2026-09-28")
    expect(toLocalDateKey(new Date(2026, 8, 28, 23, 59, 59))).toBe("2026-09-28")
  })

  it("в Нью-Йорке тоже остаётся свой день", () => {
    setZone("America/New_York")
    expect(toLocalDateKey(new Date(2026, 8, 28, 0, 0, 0))).toBe("2026-09-28")
  })

  it("одиночные числа дополняются нулём", () => {
    setZone("Europe/Moscow")
    expect(toLocalDateKey(new Date(2026, 0, 5, 12))).toBe("2026-01-05")
  })

  it("битая дата не выдаёт мусор", () => {
    expect(toLocalDateKey(new Date("не дата"))).toBe("")
  })
})

describe("parseDateValue — «2026-09-28» это локальный день", () => {
  it("календарная дата читается как полночь местных суток", () => {
    setZone("America/New_York")
    const date = parseDateValue("2026-09-28")
    expect(date).not.toBeNull()
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(8)
    expect(date?.getDate()).toBe(28)
    expect(date?.getHours()).toBe(0)

    setZone("Europe/Moscow")
    const msk = parseDateValue("2026-09-28")
    expect(msk?.getDate()).toBe(28)
    expect(msk?.getHours()).toBe(0)
  })

  it("полное значение времени разбирается как есть", () => {
    setZone("Europe/Moscow")
    const iso = parseDateValue("2026-09-28T21:00:00.000Z")
    expect(iso?.getTime()).toBe(Date.parse("2026-09-28T21:00:00.000Z"))
    // 21:00 UTC = 00:00 29 сентября по Москве
    expect(toLocalDateKey(iso as Date)).toBe("2026-09-29")
  })

  it("Date пропускается без изменений", () => {
    const date = new Date(2026, 8, 28, 10)
    expect(parseDateValue(date)).toBe(date)
  })

  it("мусор, пусто и несуществующий день — null", () => {
    expect(parseDateValue("2026-02-31")).toBeNull()
    expect(parseDateValue("не дата")).toBeNull()
    expect(parseDateValue("")).toBeNull()
    expect(parseDateValue("   ")).toBeNull()
    expect(parseDateValue(null)).toBeNull()
    expect(parseDateValue(undefined)).toBeNull()
    expect(parseDateValue(new Date("oops"))).toBeNull()
  })

  it("пробелы по краям не мешают", () => {
    setZone("Europe/Moscow")
    expect(parseDateValue("  2026-09-28 ")?.getDate()).toBe(28)
  })
})

describe("toDateInputValue — значение для <input type=\"date\">", () => {
  it("календарную дату отдаёт без пересчёта", () => {
    setZone("America/New_York")
    expect(toDateInputValue("2026-09-28")).toBe("2026-09-28")
    setZone("Europe/Moscow")
    expect(toDateInputValue("2026-09-28")).toBe("2026-09-28")
  })

  it("момент времени приводит к местному дню", () => {
    setZone("Europe/Moscow")
    expect(toDateInputValue("2026-09-28T21:30:00.000Z")).toBe("2026-09-29")
    expect(toDateInputValue(new Date(2026, 8, 28, 9))).toBe("2026-09-28")
  })

  it("пусто и битое значение — пустая строка", () => {
    expect(toDateInputValue(null)).toBe("")
    expect(toDateInputValue(undefined)).toBe("")
    expect(toDateInputValue("")).toBe("")
    expect(toDateInputValue("мусор")).toBe("")
  })
})

describe("DATE_KEY_PATTERN", () => {
  it("принимает только строгий формат", () => {
    expect(DATE_KEY_PATTERN.test("2026-09-28")).toBe(true)
    expect(DATE_KEY_PATTERN.test("28.09.2026")).toBe(false)
    expect(DATE_KEY_PATTERN.test("2026-09-28T00:00:00Z")).toBe(false)
    expect(DATE_KEY_PATTERN.test("2026-9-28")).toBe(false)
  })
})
