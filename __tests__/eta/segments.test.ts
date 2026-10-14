// __tests__/eta/segments.test.ts
//
// Сегментация маршрута: класс дороги из шагов OSRM, склейка коротких сегментов,
// разбор геометрии.
//
// Отдельно проверяется реальность, с которой столкнулись: публичный OSRM
// НЕ отдаёт ни way_class, ни speed — класс дороги приходится выводить из
// названия, манёвра и длины шага. Поэтому тесты идут по шагам в том виде,
// в каком их отдаёт сервер.

import { describe, expect, it } from "vitest"

import {
  buildSegmentsFromSteps,
  decodePolyline,
  mergeShortSegments,
  segmentMidpoint,
} from "@/lib/eta/segments"
import type { StepLike } from "@/lib/eta/road-class"

const MOSCOW = { lat: 55.7558, lng: 37.6173 }

function step(overrides: Partial<StepLike>): StepLike {
  return {
    name: "",
    distance: 1000,
    duration: 60,
    ...overrides,
  } as StepLike
}

describe("buildSegmentsFromSteps — класс дороги из шагов OSRM", () => {
  it("российский номер трассы М-11 определяет федеральную дорогу, а не автомагистраль", () => {
    const segments = buildSegmentsFromSteps(
      [step({ name: "М-11 Нева", distance: 20000, duration: 1200 })],
      [MOSCOW, { lat: 55.0, lng: 36.0 }],
    )

    expect(segments).toHaveLength(1)
    // Реальный пробел, который нашёлся: без номера дороги «М-4 Дон» падало в
    // автомагистраль со скоростью 75 км/ч и занижало время
    expect(segments[0].roadClass.class).toBe("federal")
    expect(segments[0].baseSpeedKmh).toBe(65)
    expect(segments[0].speedSource).toBe("table")
  })

  it("«шоссе» в названии даёт автомагистраль", () => {
    const segments = buildSegmentsFromSteps(
      [step({ name: "Каширское шоссе", distance: 20000, duration: 1200 })],
      [MOSCOW, { lat: 55.0, lng: 36.0 }],
    )

    expect(segments[0].roadClass.class).toBe("motorway")
    expect(segments[0].baseSpeedKmh).toBe(75)
  })

  it("региональный номер 46К-16 определяет региональную дорогу", () => {
    const segments = buildSegmentsFromSteps(
      [step({ name: "46К-16", distance: 20000, duration: 1300 })],
      [MOSCOW, { lat: 55.0, lng: 36.0 }],
    )

    expect(segments[0].roadClass.class).toBe("regional")
    expect(segments[0].baseSpeedKmh).toBe(55)
  })

  it("городская улица определяется по названию и получает городскую скорость", () => {
    const segments = buildSegmentsFromSteps(
      [step({ name: "Ленинградский проспект", distance: 5000, duration: 600 })],
      [MOSCOW, { lat: 55.8, lng: 37.5 }],
    )

    expect(segments[0].roadClass.class).toBe("city")
    expect(segments[0].baseSpeedKmh).toBe(25)
  })

  it("короткий шаг без названия не угадывает класс: unknown с низкой уверенностью", () => {
    const segments = buildSegmentsFromSteps(
      [step({ name: "", distance: 4000, duration: 400 })],
      [MOSCOW, { lat: 55.8, lng: 37.5 }],
    )

    expect(segments[0].roadClass.class).toBe("unknown")
    expect(segments[0].roadClass.confidence).toBeLessThan(0.5)
    // Неизвестный класс не даёт ни бонуса, ни штрафа: скорость из факта OSRM
    expect(segments[0].baseSpeedKmh).toBeGreaterThan(0)
  })

  it("фактическая скорость OSRM считается по шагу", () => {
    const segments = buildSegmentsFromSteps(
      [step({ name: "Трасса", distance: 10000, duration: 600 })],
      [MOSCOW, { lat: 55.0, lng: 36.0 }],
    )

    // 10 км за 600 с = 60 км/ч
    expect(segments[0].osrmSpeedKmh).toBe(60)
  })

  it("пустая геометрия не роняет расчёт", () => {
    const segments = buildSegmentsFromSteps([step({ name: "М-4", distance: 1000, duration: 60 })], [])

    expect(segments).toHaveLength(1)
    expect(segments[0].from).toEqual({ lat: 0, lng: 0 })
  })

  it("шаги с нулевой длиной пропускаются", () => {
    const segments = buildSegmentsFromSteps(
      [
        step({ name: "М-4", distance: 0, duration: 0 }),
        step({ name: "М-4", distance: 1000, duration: 60 }),
      ],
      [MOSCOW, { lat: 55.0, lng: 36.0 }],
    )

    expect(segments).toHaveLength(1)
  })
})

describe("mergeShortSegments", () => {
  const base = {
    roadClass: { class: "city" as const, label: "Город", confidence: 0.7, reason: "тест" },
    baseSpeedKmh: 25,
    speedSource: "table" as const,
    osrmSpeedKmh: 25,
    freeFlowSec: 100,
    baseDurationSec: 100,
    roadName: "улица",
    from: MOSCOW,
    to: MOSCOW,
  }

  it("сегмент короче порога склеивается с предыдущим", () => {
    const merged = mergeShortSegments(
      [
        { ...base, index: 0, distanceM: 5000 },
        { ...base, index: 1, distanceM: 150 },
      ],
      300,
    )

    expect(merged).toHaveLength(1)
    expect(merged[0].distanceM).toBe(5150)
    // Время не потерялось: сумма сохраняется
    expect(merged[0].freeFlowSec).toBeGreaterThan(0)
  })

  it("длинные сегменты остаются раздельными", () => {
    const merged = mergeShortSegments(
      [
        { ...base, index: 0, distanceM: 5000 },
        { ...base, index: 1, distanceM: 20000 },
      ],
      300,
    )

    expect(merged).toHaveLength(2)
    expect(merged.map((s) => s.index)).toEqual([0, 1])
  })

  it("после склейки индексы пересчитываются по порядку", () => {
    const merged = mergeShortSegments(
      [
        { ...base, index: 0, distanceM: 5000 },
        { ...base, index: 1, distanceM: 100 },
        { ...base, index: 2, distanceM: 100 },
        { ...base, index: 3, distanceM: 8000 },
      ],
      300,
    )

    expect(merged.map((s) => s.index)).toEqual([0, 1])
  })
})

describe("segmentMidpoint", () => {
  it("середина считается по обеим координатам", () => {
    const mid = segmentMidpoint({
      index: 0,
      from: { lat: 10, lng: 20 },
      to: { lat: 20, lng: 40 },
      distanceM: 1000,
      baseDurationSec: 60,
      roadClass: { class: "rural", label: "r", confidence: 1, reason: "" },
      baseSpeedKmh: 50,
      speedSource: "table",
      osrmSpeedKmh: 50,
      freeFlowSec: 72,
    })

    expect(mid).toEqual({ lat: 15, lng: 30 })
  })
})

describe("decodePolyline", () => {
  it("разбирает кодированную геометрию OSRM", () => {
    // _p~iF~ps|U — отрезок из реального ответа OSRM
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC")

    expect(points.length).toBeGreaterThan(0)
    for (const point of points) {
      expect(Number.isFinite(point.lat)).toBe(true)
      expect(Number.isFinite(point.lng)).toBe(true)
    }
  })

  it("пустая строка даёт пустой список", () => {
    expect(decodePolyline("")).toEqual([])
  })
})
