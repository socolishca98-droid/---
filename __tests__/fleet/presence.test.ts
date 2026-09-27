// «Водитель на связи» — по фактической GPS-точке, а не по названию статуса.
//
// Счётчик «N водителей на связи» видят логисты на дашборде и на карте, поэтому
// правило проверяем отдельно от базы: свежая точка, протухшая точка, отсутствие
// точки, битая дата и метка из будущего (часы устройства спешат).

import { describe, expect, it } from "vitest"

import {
  GPS_FUTURE_TOLERANCE_MS,
  GPS_ONLINE_WINDOW_MS,
  countOnlineDrivers,
  gpsAgeMs,
  isDriverOnline,
} from "@/lib/fleet/presence"

const NOW = new Date("2026-09-27T12:00:00.000Z")

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000)
}

describe("isDriverOnline — свежесть последней GPS-точки", () => {
  it("свежая точка — водитель на связи", () => {
    expect(isDriverOnline(NOW, NOW)).toBe(true)
    expect(isDriverOnline(minutesAgo(1), NOW)).toBe(true)
    expect(isDriverOnline(minutesAgo(14), NOW)).toBe(true)
  })

  it("протухшая точка — не на связи", () => {
    expect(isDriverOnline(minutesAgo(16), NOW)).toBe(false)
    expect(isDriverOnline(minutesAgo(60), NOW)).toBe(false)
    expect(isDriverOnline(minutesAgo(24 * 60), NOW)).toBe(false)
  })

  it("граница окна — ровно в пределах считается связью", () => {
    expect(isDriverOnline(new Date(NOW.getTime() - GPS_ONLINE_WINDOW_MS), NOW)).toBe(true)
    expect(isDriverOnline(new Date(NOW.getTime() - GPS_ONLINE_WINDOW_MS - 1), NOW)).toBe(false)
  })

  it("точки никогда не было — не на связи, а не «онлайн по статусу»", () => {
    expect(isDriverOnline(null, NOW)).toBe(false)
    expect(isDriverOnline(undefined, NOW)).toBe(false)
  })

  it("битую дату не выдаёт за присутствие", () => {
    expect(isDriverOnline("не дата", NOW)).toBe(false)
    expect(isDriverOnline(new Date("oops"), NOW)).toBe(false)
    expect(isDriverOnline("" as unknown as null, NOW)).toBe(false)
  })

  it("ISO-строка из JSON читается так же, как Date", () => {
    expect(isDriverOnline(minutesAgo(3).toISOString(), NOW)).toBe(true)
    expect(isDriverOnline(minutesAgo(120).toISOString(), NOW)).toBe(false)
  })

  it("небольшой уход часов вперёд допустим, час в будущем — нет", () => {
    const ahead = new Date(NOW.getTime() + GPS_FUTURE_TOLERANCE_MS - 1000)
    const brokenClock = new Date(NOW.getTime() + 60 * 60 * 1000)
    expect(isDriverOnline(ahead, NOW)).toBe(true)
    expect(isDriverOnline(brokenClock, NOW)).toBe(false)
  })

  it("окно свежести больше допуска на будущее", () => {
    expect(GPS_ONLINE_WINDOW_MS).toBeGreaterThan(GPS_FUTURE_TOLERANCE_MS)
    expect(GPS_FUTURE_TOLERANCE_MS).toBeGreaterThan(0)
  })
})

describe("gpsAgeMs — возраст точки", () => {
  it("считает возраст в миллисекундах и отрицательный для будущего", () => {
    expect(gpsAgeMs(minutesAgo(5), NOW)).toBe(5 * 60 * 1000)
    expect(gpsAgeMs(new Date(NOW.getTime() + 1000), NOW)).toBe(-1000)
  })

  it("без точки и с битой датой возвращает null", () => {
    expect(gpsAgeMs(null, NOW)).toBeNull()
    expect(gpsAgeMs("не дата", NOW)).toBeNull()
  })
})

describe("countOnlineDrivers — счётчик для сводок", () => {
  it("считает только свежие точки", () => {
    const drivers = [
      { lastGpsUpdate: minutesAgo(1) },
      { lastGpsUpdate: minutesAgo(30) },
      { lastGpsUpdate: null },
      { lastGpsUpdate: minutesAgo(2).toISOString() },
      {},
    ]
    expect(countOnlineDrivers(drivers, NOW)).toBe(2)
  })

  it("пустой список и пропуски не ломают подсчёт", () => {
    expect(countOnlineDrivers([], NOW)).toBe(0)
    expect(countOnlineDrivers([null, undefined], NOW)).toBe(0)
  })
})
