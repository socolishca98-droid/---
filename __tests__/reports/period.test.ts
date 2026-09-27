// Период отчёта и подписи интервалов — в зоне пользователя, а не UTC.
//
// Отчёт отвечает на вопрос «что было с 1 по 28 сентября», и ответ не должен
// зависеть от того, в какой зоне стоит сервер и браузер. Здесь проверяем две
// вещи, которые ломались:
//   1. границы периода из строк «2026-09-01» / «2026-09-28» (new Date() читал
//      их как полночь UTC — в зонах западнее Гринвича период съезжал на день);
//   2. ключи и подписи интервалов (toISOString() отдавал UTC — в Москве «28.09»
//      подписывалось как «27.09»).

import { afterAll, describe, expect, it } from "vitest"

import { buildPeriod, periodBuckets, startOfDay, endOfDay } from "@/lib/reports/aggregate"

const originalTz = process.env.TZ

afterAll(() => {
  process.env.TZ = originalTz
})

describe("buildPeriod — произвольные даты как локальные дни", () => {
  it("в Москве период начинается и заканчивается выбранными днями", () => {
    process.env.TZ = "Europe/Moscow"
    const period = buildPeriod("30d", { from: "2026-09-01", to: "2026-09-28" })

    expect(period.preset).toBe("custom")
    expect(period.group).toBe("day")
    expect(period.from.getTime()).toBe(new Date(2026, 8, 1, 0, 0, 0, 0).getTime())
    expect(period.to.getTime()).toBe(new Date(2026, 8, 28, 23, 59, 59, 999).getTime())
  })

  it("в зоне западнее Гринвича последний день не теряется", () => {
    process.env.TZ = "America/New_York"
    const period = buildPeriod("30d", { from: "2026-09-01", to: "2026-09-28" })

    expect(period.from.getDate()).toBe(1)
    expect(period.from.getMonth()).toBe(8)
    expect(period.to.getDate()).toBe(28)
    expect(period.to.getMonth()).toBe(8)
    // полные сутки между границами: 27 (с 1 по 28 сентября включительно)
    expect(Math.floor((period.to.getTime() - period.from.getTime()) / 86_400_000)).toBe(27)
  })

  it("пресет считает границы от «сейчас» в локальных сутках", () => {
    process.env.TZ = "Europe/Moscow"
    const now = new Date(2026, 8, 27, 14, 30)
    const period = buildPeriod("7d", { now })

    expect(period.from.getTime()).toBe(startOfDay(new Date(2026, 8, 21)).getTime())
    expect(period.to.getTime()).toBe(endOfDay(now).getTime())
    expect(period.label).toBe("Последние 7 дней")
  })

  it("мусор вместо даты не роняет отчёт", () => {
    process.env.TZ = "Europe/Moscow"
    const now = new Date(2026, 8, 27, 12)
    const period = buildPeriod("30d", { from: "не дата", to: null, now })

    expect(Number.isNaN(period.from.getTime())).toBe(false)
    expect(Number.isNaN(period.to.getTime())).toBe(false)
    expect(period.from.getTime()).toBe(startOfDay(now).getTime())
  })
})

describe("periodBuckets — подписи интервалов своими датами", () => {
  it("дневные интервалы подписаны теми днями, что выбрал пользователь", () => {
    process.env.TZ = "Europe/Moscow"
    const period = buildPeriod("30d", { from: "2026-09-01", to: "2026-09-05" })
    const buckets = periodBuckets(period)

    expect(buckets.map((bucket) => bucket.key)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ])
    expect(buckets.map((bucket) => bucket.label)).toEqual([
      "01.09",
      "02.09",
      "03.09",
      "04.09",
      "05.09",
    ])
  })

  it("недельные интервалы начинаются с понедельника локальной недели", () => {
    process.env.TZ = "Europe/Moscow"
    // длинный период — агрегатор сам переключается на недели
    const period = buildPeriod("90d", { from: "2026-09-01", to: "2026-11-15" })

    expect(period.group).toBe("week")
    const buckets = periodBuckets(period)
    // 1 сентября 2026 — вторник, значит понедельник этой недели — 31 августа
    expect(buckets[0].key).toBe("2026-08-31")
    expect(buckets[0].label).toBe("31.08")
    expect(buckets[1].key).toBe("2026-09-07")
  })

  it("в зоне западнее Гринвича дни те же", () => {
    process.env.TZ = "America/New_York"
    const period = buildPeriod("30d", { from: "2026-09-01", to: "2026-09-03" })
    const buckets = periodBuckets(period)

    expect(buckets.map((bucket) => bucket.key)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ])
    expect(buckets.map((bucket) => bucket.label)).toEqual(["01.09", "02.09", "03.09"])
  })

  it("месячные интервалы не зависят от зоны", () => {
    process.env.TZ = "Europe/Moscow"
    const period = buildPeriod("year", { from: "2026-01-01", to: "2026-12-31" })
    const buckets = periodBuckets(period)

    expect(buckets[0].key).toBe("2026-01")
    expect(buckets[0].label).toBe("янв 26")
    expect(buckets).toHaveLength(12)
  })
})
