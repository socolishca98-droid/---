// __tests__/eta/forecast.test.ts
//
// Сценарии посегментного прогноза: 27+ случаев из ТЗ.
//
// Все тесты идут через ЧИСТУЮ функцию forecastSegments: внешние данные
// (погода, история, события) передаются параметрами, сети нет. Поэтому тест
// проверяет именно логику, а не доступность api.open-meteo.com.
//
// Часовой пояс везде задан явно ("UTC"), иначе результат зависел бы от машины,
// на которой запущен тест: на сервере в UTC «московские» 9:00 стали бы 6:00.

import { describe, expect, it } from "vitest"

import { forecastSegments, type ForecastOptions, type SegmentForecast } from "@/lib/eta/forecast"
import type { RouteSegment } from "@/lib/eta/segments"
import type { RoadClass } from "@/lib/eta/road-class"
import type { HourlyWeather } from "@/lib/eta/weather/model"
import type { RoadEvent } from "@/lib/eta/events"

const TZ = "UTC"
const MOSCOW = { lat: 55.7558, lng: 37.6173 }

/** Собирает сегмент заданного класса. */
function segment(
  klass: RoadClass,
  km: number,
  speedKmh: number,
  index: number,
  name = "участок",
): RouteSegment {
  const distanceM = Math.round(km * 1000)
  return {
    index,
    from: MOSCOW,
    to: MOSCOW,
    distanceM,
    baseDurationSec: Math.round((distanceM / 1000 / speedKmh) * 3600),
    roadClass: { class: klass, label: klass, confidence: 0.9, reason: "тест" },
    baseSpeedKmh: speedKmh,
    speedSource: "table",
    osrmSpeedKmh: speedKmh,
    freeFlowSec: Math.round((distanceM / 1000 / speedKmh) * 3600),
    roadName: name,
  }
}

/** Город → трасса: типовой рейс. */
function cityThenHighway(highwayKm = 200, highwayClass: RoadClass = "motorway"): RouteSegment[] {
  return [segment("city", 15, 25, 0, "городской участок"), segment(highwayClass, highwayKm, 95, 1, "трасса")]
}

/** Момент выезда в UTC. */
function at(hour: number, day = 15): Date {
  return new Date(Date.UTC(2026, 9, day, hour, 0))
}

/** Погодная выборка на час. */
function weather(overrides: Partial<HourlyWeather> & { time?: string } = {}): HourlyWeather {
  return {
    time: "2026-10-15T09:00",
    temperatureC: 15,
    precipitationMm: 0,
    weatherCode: 0,
    visibilityM: 10000,
    windSpeedKmh: 10,
    ...overrides,
  }
}

/** Полная карточка ТС — иначе уверенность падает по дефолту. */
const TRUCK = {
  type: "truck",
  capacity: 20000,
  length: 12,
  width: 2.5,
  height: 3.2,
}

function forecast(segments: RouteSegment[], options: Partial<ForecastOptions> = {}): ReturnType<typeof forecastSegments> {
  return forecastSegments(segments, {
    departure: at(9),
    timeZone: TZ,
    vehicle: TRUCK,
    useSeasonalFallback: true,
    ...options,
  })
}

/** Суммарный множитель всех поправок на сегменте. */
function factorOf(s: SegmentForecast): number {
  return s.totalFactor
}

// ─────────────────────────────────────────────────────────────────────────────
describe("1. Сухая трасса: база без внешних платных API", () => {
  it("ночной выезд по трассе даёт время, близкое к базовому OSRM", () => {
    const result = forecast([segment("motorway", 200, 95, 0)], {
      departure: at(3),
      useSeasonalFallback: false,
    })

    // 200 км при 95 км/ч ≈ 126 мин, +12% на грузовик
    expect(result.scenarios.base.totalSec / 60).toBeGreaterThan(126)
    expect(result.scenarios.base.totalSec / 60).toBeLessThan(150)
    expect(result.reliable).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it("в базовом сценарии время не быстрее свободного потока", () => {
    const result = forecast([segment("motorway", 100, 95, 0)], { departure: at(3) })
    const freeFlow = result.segments[0].freeFlowSec

    expect(result.segments[0].drivingSec).toBeGreaterThanOrEqual(freeFlow)
  })

  it("модель помечает версию и часовой пояс расчёта", () => {
    const result = forecast(cityThenHighway())

    expect(result.modelVersion).toMatch(/^2\./)
    expect(result.timeZone).toBe(TZ)
    expect(result.segments).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("2. Городской пик", () => {
  it("вечерний пик замедляет городской участок сильнее, чем ночь", () => {
    const night = forecast(cityThenHighway(), { departure: at(3) })
    const peak = forecast(cityThenHighway(), { departure: at(18) })

    const nightCity = night.segments[0].totalFactor
    const peakCity = peak.segments[0].totalFactor

    expect(peakCity).toBeGreaterThan(nightCity * 1.3)
    expect(peak.scenarios.base.totalSec).toBeGreaterThan(night.scenarios.base.totalSec)
  })

  it("коэффициент часа пик действительно доходит до итога, а не размывается", () => {
    // Историческая ошибка: взвешенная сумма превращала ×1.55 в ×1.28
    const peak = forecast(cityThenHighway(), { departure: at(18) })
    const cityFactor = peak.segments[0].totalFactor

    expect(cityFactor).toBeGreaterThan(1.4)
  })

  it("утренний пик тоже отличается от дневного затишья", () => {
    const noon = forecast(cityThenHighway(), { departure: at(13) })
    const morning = forecast(cityThenHighway(), { departure: at(8) })

    expect(morning.segments[0].totalFactor).toBeGreaterThan(noon.segments[0].totalFactor)
  })

  it("на трассе вне города пик почти не влияет", () => {
    const night = forecast([segment("motorway", 200, 95, 0)], { departure: at(3) })
    const peak = forecast([segment("motorway", 200, 95, 0)], { departure: at(18) })

    // Загородная трасса: ночь ×1.0 против часа пик ×1.05
    expect(peak.segments[0].totalFactor).toBeLessThan(night.segments[0].totalFactor * 1.1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("3. Изменение времени выезда", () => {
  it("перенос выезда меняет момент прохождения каждого сегмента", () => {
    const early = forecast(cityThenHighway(), { departure: at(6) })
    const late = forecast(cityThenHighway(), { departure: at(18) })

    // Город проезжается раньше — значит затор меньший
    expect(early.segments[0].arrivalAt.getTime()).toBeLessThan(late.segments[0].arrivalAt.getTime())
    expect(early.scenarios.base.totalSec).toBeLessThan(late.scenarios.base.totalSec)
  })

  it("на долгом рейсе смена времени выезда сдвигает прибытие на трассу", () => {
    const early = forecast([segment("motorway", 400, 95, 0)], { departure: at(6) })
    const late = forecast([segment("motorway", 400, 95, 0)], { departure: at(14) })

    expect(early.segments[0].arrivalAt.getUTCHours()).toBe(6)
    expect(late.segments[0].arrivalAt.getUTCHours()).toBe(14)
  })

  it("выезд в пятницу вечером отличает от вторника", () => {
    const tuesday = forecast(cityThenHighway(), { departure: at(18, 13) })
    const friday = forecast(cityThenHighway(), { departure: at(18, 16) })

    expect(friday.segments[0].totalFactor).toBeGreaterThan(tuesday.segments[0].totalFactor)
  })

  it("праздничный выезд считает выходной коэффициент", () => {
    const usual = forecast(cityThenHighway(), { departure: at(18, 15) })
    const holiday = forecast(cityThenHighway(), { departure: new Date(Date.UTC(2026, 0, 4, 18, 0)) })

    expect(holiday.segments[0].totalFactor).toBeLessThan(usual.segments[0].totalFactor)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("4-8. Погода на момент прохождения сегмента", () => {
  it("снег замедляет трассу сильнее сухой дороги", () => {
    const dry = forecast(cityThenHighway(), {
      departure: at(9),
      weatherBySegment: [weather(), weather({ weatherCode: 0 })],
    })
    const snow = forecast(cityThenHighway(), {
      departure: at(9),
      weatherBySegment: [
        weather({ weatherCode: 73, temperatureC: -3, precipitationMm: 3 }),
        weather({ weatherCode: 73, temperatureC: -3, precipitationMm: 3 }),
      ],
    })

    expect(snow.segments[1].totalFactor).toBeGreaterThan(dry.segments[1].totalFactor * 1.1)
    expect(snow.segments[1].weather?.label).toBe("снегопад")
  })

  it("дождь даёт умеренную поправку, а не максимум «за факт осадков»", () => {
    const result = forecast([segment("motorway", 100, 95, 0)], {
      weatherBySegment: [weather({ weatherCode: 61, precipitationMm: 1.5, visibilityM: 8000 })],
    })

    const factor = result.segments[0].weather?.factor ?? 1
    expect(factor).toBeGreaterThan(1)
    expect(factor).toBeLessThan(1.2)
    expect(result.segments[0].weather?.label).toBe("дождь")
  })

  it("туман снижает скорость по видимости", () => {
    const result = forecast([segment("motorway", 100, 95, 0)], {
      weatherBySegment: [weather({ weatherCode: 45, visibilityM: 300 })],
    })

    expect(result.segments[0].weather?.label).toBe("туман")
    expect(result.segments[0].weather?.factor).toBeGreaterThan(1.05)
  })

  it("около нуля + осадки = риск гололедица как ВЕРОЯТНОСТЬ, не как факт", () => {
    const result = forecast([segment("motorway", 100, 95, 0)], {
      weatherBySegment: [weather({ weatherCode: 71, temperatureC: 0.5, precipitationMm: 1 })],
    })

    expect(result.segments[0].weather?.iceRisk).toBeGreaterThan(0)
    // Покрытие бесплатный источник не подтверждает — значит не утверждаем
    expect(result.segments[0].weather?.iceRisk).toBeLessThan(1)
  })

  it("подтверждённый гололёд даёт сильную поправку", () => {
    const freezing = forecast([segment("motorway", 100, 95, 0)], {
      weatherBySegment: [weather({ weatherCode: 66, temperatureC: -2, precipitationMm: 2 })],
    })

    expect(freezing.segments[0].weather?.factor).toBeGreaterThan(1.15)
  })

  it("боковой ветер с порывами замедляет", () => {
    const calm = forecast([segment("motorway", 100, 95, 0)], {
      weatherBySegment: [weather({ windSpeedKmh: 10, windGustsKmh: 15 })],
    })
    const windy = forecast([segment("motorway", 100, 95, 0)], {
      weatherBySegment: [weather({ windSpeedKmh: 45, windGustsKmh: 70 })],
    })

    expect(windy.segments[0].weather?.factor).toBeGreaterThan(calm.segments[0].weather?.factor ?? 1)
  })

  it("погода считается на МОМЕНТ прохождения сегмента, а не выезда", () => {
    // Долгий рейс: на выезде ясно, через 6 часов снег
    const result = forecast(
      [segment("motorway", 600, 95, 0), segment("motorway", 600, 95, 1)],
      {
        departure: at(9),
        weatherBySegment: [weather({ weatherCode: 0 }), weather({ weatherCode: 73, temperatureC: -3 })],
      },
    )

    expect(result.segments[0].weather?.condition).toBe("clear")
    expect(result.segments[1].weather?.condition).toBe("snow")
    expect(result.segments[1].weather?.factor).toBeGreaterThan(result.segments[0].weather?.factor ?? 1)
  })

  it("на классе дороги погода влияет по-разному: трасса vs промзона", () => {
    const motorway = forecast([segment("motorway", 100, 95, 0)], {
      weatherBySegment: [weather({ weatherCode: 73, temperatureC: -3 })],
    })
    const industrial = forecast([segment("industrial", 100, 12, 0)], {
      weatherBySegment: [weather({ weatherCode: 73, temperatureC: -3 })],
    })

    expect(motorway.segments[0].weather?.factor ?? 0)
      .toBeGreaterThan(industrial.segments[0].weather?.factor ?? 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("9-10. Дорожные события: ДТП и перекрытия", () => {
  const accident = (severity: RoadEvent["severity"]): RoadEvent[] => [
    {
      segmentIndex: 0,
      severity,
      description: "ДТП на съезде",
      reportedAt: at(9),
    },
  ]

  it("частичное перекрытие повышает время на затронутом сегменте и попадает в объяснение", () => {
    const clean = forecast(cityThenHighway(), { departure: at(9) })
    const jam = forecast(cityThenHighway(), { departure: at(9), events: accident("partial") })

    expect(jam.segments[0].totalFactor).toBeGreaterThan(clean.segments[0].totalFactor)
    expect(jam.reliable).toBe(true)

    const eventCorrection = jam.segments[0].corrections.find((c) => c.kind === "event")
    expect(eventCorrection).toBeDefined()
    expect(eventCorrection?.reason).toContain("движение ограничено")
  })

  it("на незатронутом сегменте событие не действует", () => {
    const jam = forecast(cityThenHighway(), { departure: at(9), events: accident("partial") })

    // Поправки «событие» на втором сегменте нет вовсе. Общий множитель может
    // отличаться — и это правильно: задержка на первом сегменте сдвигает
    // МОМЕНТ прохождения второго, а значит и его дорожную обстановку.
    expect(jam.segments[1].corrections.some((c) => c.kind === "event")).toBe(false)
  })

  it("полное перекрытие НЕ маскируется искусственным максимумом", () => {
    const blocked = forecast(cityThenHighway(), { departure: at(9), events: accident("full") })

    // Никакого ×10 или ×50: вместо этого честный признак
    expect(blocked.reliable).toBe(false)
    expect(blocked.reliabilityNote).toContain("полное перекрытие")
    expect(blocked.confidence.level).toBe("low")
  })

  it("альтернативный маршрут в обход перекрытия считается нормально", () => {
    // Событие привязано к сегменту СТАРОГО маршрута; в объезде его нет —
    // иначе «обход перекрытия» сам оказывался перекрыт
    const alternative = forecast(
      [segment("regional", 30, 55, 0, "обход"), segment("motorway", 200, 95, 1)],
      { departure: at(9), events: [] },
    )

    expect(alternative.segments[0].roadClass).toBe("regional")
    expect(alternative.reliable).toBe(true)
    expect(alternative.scenarios.base.totalSec).toBeGreaterThan(0)
    expect(alternative.segments.every((s) => !s.blocked)).toBe(true)
  })

  it("устаревшее событие не влияет на расчёт", () => {
    const stale: RoadEvent[] = [
      {
        segmentIndex: 0,
        severity: "partial",
        description: "ДТП",
        reportedAt: at(6),
        expiresAt: at(8),
      },
    ]

    const clean = forecast(cityThenHighway(), { departure: at(9) })
    const staleResult = forecast(cityThenHighway(), { departure: at(9), events: stale })

    expect(staleResult.segments[0].totalFactor).toBe(clean.segments[0].totalFactor)
    expect(staleResult.events).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("11. Недоступность внешних источников (резервный режим)", () => {
  it("нет погоды → коэффициент 1.0, а уверенность честно падает", () => {
    const withWeather = forecast(cityThenHighway(), {
      weatherBySegment: [weather({ weatherCode: 73, temperatureC: -3 }), weather({ weatherCode: 73, temperatureC: -3 })],
    })
    const without = forecast(cityThenHighway(), { weatherBySegment: [null, null] })

    expect(without.segments[0].weather).toBeUndefined()
    expect(without.confidence.reasons.some((r) => r.includes("погод"))).toBe(true)
    expect(without.confidence.score).toBeLessThan(withWeather.confidence.score)
  })

  it("маршрутизатор не ответил: прогноз не выдаётся за достоверный", () => {
    const result = forecast([], { departure: at(9) })

    expect(result.reliable).toBe(false)
    expect(result.confidence.score).toBe(0)
    expect(result.confidence.reasons[0]).toContain("маршрут не построен")
  })

  it("частично доступная погода работает по остальным сегментам", () => {
    const result = forecast(cityThenHighway(), {
      weatherBySegment: [weather({ weatherCode: 73, temperatureC: -3 }), null],
    })

    expect(result.segments[0].weather?.available).toBe(true)
    expect(result.segments[1].weather).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("12. Устаревшие данные трафика", () => {
  it("исторический коэффициент по сегменту заменяет модель, а не складывается с ней", () => {
    const historical = forecast(cityThenHighway(), {
      departure: at(18),
      historicalBySegment: [
        { trafficFactor: 1.5, source: "факт 2026-09" },
        null,
      ],
    })

    // Иначе был бы двойной учёт: 1.5 × 1.63 = 2.4
    expect(historical.segments[0].traffic.factor).toBeCloseTo(1.63, 2)
    const trafficCorrection = historical.segments[0].corrections.find((c) => c.kind === "traffic")
    expect(trafficCorrection?.factor).toBe(1.5)
    expect(trafficCorrection?.source).toBe("history")
  })

  it("использование истории помечается в уверенности", () => {
    const historical = forecast(cityThenHighway(), {
      departure: at(18),
      historicalBySegment: [{ trafficFactor: 1.5, source: "факт" }, { trafficFactor: 1.1, source: "факт" }],
    })

    expect(historical.confidence.reasons.some((r) => r.includes("исторические"))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("13. Длинный рейс со сменой погоды и времени суток", () => {
  it("за 12 часов рейса сегменты получают разное время и разную погоду", () => {
    const result = forecast(
      [segment("city", 20, 25, 0), segment("motorway", 500, 95, 1), segment("city", 20, 25, 2)],
      {
        departure: at(9),
        weatherBySegment: [
          weather({ weatherCode: 0 }),
          weather({ weatherCode: 73, temperatureC: -3 }),
          weather({ weatherCode: 45, visibilityM: 200 }),
        ],
      },
    )

    const arrivals = result.segments.map((s) => s.arrivalAt.getTime())
    expect(arrivals[1]).toBeGreaterThan(arrivals[0])
    expect(arrivals[2]).toBeGreaterThan(arrivals[1])

    const conditions = result.segments.map((s) => s.weather?.condition)
    expect(conditions).toEqual(["clear", "snow", "fog"])

    // Общее время больше суммы базовых: задержки накопились
    const baseSum = result.segments.reduce((sum, s) => sum + s.baseDurationSec, 0)
    expect(result.scenarios.base.drivingSec).toBeGreaterThan(baseSum)
  })

  it("время прибытия каждого сегмента считается с накоплением задержек", () => {
    const result = forecast(
      [segment("city", 10, 25, 0), segment("city", 10, 25, 1)],
      {
        departure: at(18),
        events: [
          { segmentIndex: 0, severity: "partial", description: "ДТП", reportedAt: at(18) },
        ],
      },
    )

    // Второй сегмент начинается позже, чем через чистое время первого
    const cleanFirst = result.segments[0].baseDurationSec
    expect(result.segments[1].arrivalAt.getTime() - result.departureAt.getTime())
      .toBeGreaterThan(cleanFirst * 1000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("14-16. Остановки, перерывы, пересчёт", () => {
  it("погрузка и выгрузка считаются отдельно от движения", () => {
    const plain = forecast([segment("motorway", 100, 95, 0)], { departure: at(9) })
    const withStops = forecast([segment("motorway", 100, 95, 0)], {
      departure: at(9),
      stops: [
        { kind: "loading", afterSegmentIndex: 0, actualMinutes: 60 },
        { kind: "unloading", afterSegmentIndex: 0, actualMinutes: 45 },
      ],
    })

    expect(withStops.scenarios.base.stopsSec).toBe(105 * 60)
    expect(withStops.scenarios.base.drivingSec).toBe(plain.scenarios.base.drivingSec)
    expect(withStops.stops).toHaveLength(2)
    expect(withStops.stops[0].kind).toBe("loading")
  })

  it("оценка остановки по умолчанию берёт середину диапазона ТЗ", () => {
    const result = forecast([segment("motorway", 100, 95, 0)], {
      departure: at(9),
      stops: [{ kind: "loading", afterSegmentIndex: 0 }],
    })

    // ТЗ: погрузка 30–120 мин
    expect(result.stops[0].minutes).toBe(75)
    expect(result.stops[0].source).toBe("default")
  })

  it("фактическое время остановки важнее оценки", () => {
    const result = forecast([segment("motorway", 100, 95, 0)], {
      departure: at(9),
      stops: [{ kind: "loading", afterSegmentIndex: 0, actualMinutes: 90 }],
    })

    expect(result.stops[0].minutes).toBe(90)
    expect(result.stops[0].source).toBe("actual")
  })

  it("обязательный перерыв добавляется после 4.5 часов управления", () => {
    const short = forecast([segment("motorway", 200, 95, 0)], { departure: at(9) })
    const long = forecast([segment("motorway", 600, 95, 0)], { departure: at(9) })

    expect(short.rest.breaks).toHaveLength(0)
    expect(long.rest.breaks.length).toBeGreaterThan(0)
    expect(long.scenarios.base.restSec).toBeGreaterThan(0)
  })

  it("перерыв входит в оптимистичный сценарий как 0, а в базовый — полностью", () => {
    const long = forecast([segment("motorway", 600, 95, 0)], { departure: at(9) })

    expect(long.scenarios.optimistic.restSec).toBe(0)
    expect(long.scenarios.base.restSec).toBe(long.rest.totalMinutes * 60)
  })

  it("без данных о предыдущем времени управления — предупреждение, а не утверждение", () => {
    const long = forecast([segment("motorway", 800, 95, 0)], {
      departure: at(9),
      priorDrivingMinutes: undefined,
    })

    expect(long.rest.warning).toContain("нормам труда")
  })

  it("повторный расчёт с теми же данными даёт тот же результат", () => {
    const first = forecast(cityThenHighway(), {
      departure: at(9),
      weatherBySegment: [weather({ weatherCode: 61, precipitationMm: 2 }), null],
    })
    const second = forecast(cityThenHighway(), {
      departure: at(9),
      weatherBySegment: [weather({ weatherCode: 61, precipitationMm: 2 }), null],
    })

    expect(second.scenarios.base.totalSec).toBe(first.scenarios.base.totalSec)
    expect(second.scenarios.base.arrivalAt.getTime()).toBe(first.scenarios.base.arrivalAt.getTime())
  })

  it("изменение маршрута в рейсе: пересчёт от текущей позиции", () => {
    // Водитель уже проехал город, осталась трасса: берём только оставшиеся сегменты
    const remaining = forecast([segment("motorway", 150, 95, 0)], {
      departure: new Date(Date.UTC(2026, 9, 15, 11, 30)),
    })
    const full = forecast(cityThenHighway(150), { departure: at(9) })

    expect(remaining.scenarios.base.totalSec).toBeLessThan(full.scenarios.base.totalSec)
    expect(remaining.segments[0].arrivalAt.getTime()).toBe(Date.UTC(2026, 9, 15, 11, 30))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("17. Отсутствие двойного учёта", () => {
  it("снег + зима: сезонная поправка на скорость не добавляется поверх погоды", () => {
    const winterDate = new Date(Date.UTC(2026, 0, 15, 9, 0))

    const withWeather = forecast([segment("motorway", 100, 95, 0)], {
      departure: winterDate,
      weatherBySegment: [weather({ weatherCode: 73, temperatureC: -3 })],
      useSeasonalFallback: true,
    })
    const withoutWeather = forecast([segment("motorway", 100, 95, 0)], {
      departure: winterDate,
      weatherBySegment: [null],
      useSeasonalFallback: true,
    })

    // Погодный коэффициент уже содержит зимние эффекты
    expect(withWeather.segments[0].corrections.some((c) => c.kind === "season")).toBe(false)
    // Без погоды сезон работает как резерв
    expect(withoutWeather.segments[0].corrections.some((c) => c.kind === "season")).toBe(true)
  })

  it("сезонный резерв отключается флагом", () => {
    const result = forecast([segment("motorway", 100, 95, 0)], {
      departure: new Date(Date.UTC(2026, 0, 15, 9, 0)),
      weatherBySegment: [null],
      useSeasonalFallback: false,
    })

    expect(result.segments[0].corrections.some((c) => c.kind === "season")).toBe(false)
  })

  it("погодная модель скорости не дополняется «погодным коэффициентом» ещё раз", () => {
    const result = forecast([segment("motorway", 100, 95, 0)], {
      departure: at(9),
      weatherBySegment: [weather({ weatherCode: 73, temperatureC: -3 })],
    })

    const weatherCorrections = result.segments[0].corrections.filter((c) => c.kind === "weather")
    expect(weatherCorrections).toHaveLength(1)
  })

  it("историческая скорость по сегменту не умножается на модель пробок", () => {
    const result = forecast(cityThenHighway(), {
      departure: at(18),
      historicalBySegment: [{ trafficFactor: 1.0, source: "факт" }, null],
    })

    const trafficCorrections = result.segments[0].corrections.filter((c) => c.kind === "traffic")
    expect(trafficCorrections).toHaveLength(1)
    expect(trafficCorrections[0].factor).toBe(1.0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("18-19. Неполные данные о ТС и недопустимые ограничения", () => {
  it("без карточки ТС профиль строится по умолчанию, а уверенность падает", () => {
    const known = forecastSegments(cityThenHighway(), { departure: at(9), timeZone: TZ, vehicle: TRUCK })
    const unknown = forecastSegments(cityThenHighway(), { departure: at(9), timeZone: TZ, vehicle: undefined })

    expect(unknown.confidence.reasons.some((r) => r.includes("транспортном средстве"))).toBe(true)
    expect(unknown.confidence.score).toBeLessThan(known.confidence.score)
    // При этом прогноз ВСЁ РАВНО считается: неполные данные — не отказ
    expect(unknown.scenarios.base.totalSec).toBeGreaterThan(0)
  })

  it("недостающие характеристики попадают в missing, а не придумываются", () => {
    const result = forecast(cityThenHighway(), { vehicle: { type: "тягач", trailer: true } })

    const vehicleCorrection = result.segments[0].corrections.find((c) => c.kind === "vehicle")
    expect(vehicleCorrection?.reason).toContain("нет данных")
    expect(vehicleCorrection?.factor).toBeGreaterThan(1.15)
  })

  it("легковой автомобиль не штрафуется грузовым коэффициентом", () => {
    const result = forecast(cityThenHighway(), { vehicle: { type: "car" } })
    const vehicleCorrection = result.segments[0].corrections.find((c) => c.kind === "vehicle")

    expect(vehicleCorrection?.factor).toBe(1.0)
  })

  it("недопустимое ограничение — нарушение, а не рост коэффициента", () => {
    const result = forecast(cityThenHighway(), {
      vehicle: { type: "truck", height: 4.2 },
      restrictions: [{ code: "max_height", message: "ограничение высоты 3.5 м", value: 3.5, onSegmentIndex: 0 }],
    })

    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.reliable).toBe(false)
    expect(result.reliabilityNote).toContain("недопустим")
  })

  it("допустимый маршрут не даёт нарушений", () => {
    const result = forecast(cityThenHighway(), {
      vehicle: { type: "truck", height: 3.2 },
      restrictions: [{ code: "max_height", message: "ограничение высоты 3.5 м", value: 3.5, onSegmentIndex: 0 }],
    })

    expect(result.violations).toHaveLength(0)
    expect(result.reliable).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("20. Сценарии, диапазон и уверенность", () => {
  it("три сценария упорядочены: оптимистичный ≤ базовый ≤ консервативный", () => {
    const result = forecast(cityThenHighway(), { departure: at(18) })

    expect(result.scenarios.optimistic.totalSec).toBeLessThanOrEqual(result.scenarios.base.totalSec)
    expect(result.scenarios.base.totalSec).toBeLessThanOrEqual(result.scenarios.conservative.totalSec)
  })

  it("диапазон прибытия совпадает со сценариями", () => {
    const result = forecast(cityThenHighway(), { departure: at(18) })

    expect(result.arrivalWindow.from.getTime()).toBe(result.scenarios.optimistic.arrivalAt.getTime())
    expect(result.arrivalWindow.to.getTime()).toBe(result.scenarios.conservative.arrivalAt.getTime())
    expect(result.arrivalWindow.to.getTime()).toBeGreaterThan(result.arrivalWindow.from.getTime())
  })

  it("в час пик разброс сценариев шире, чем ночью", () => {
    const night = forecast(cityThenHighway(), { departure: at(3) })
    const peak = forecast(cityThenHighway(), { departure: at(18) })

    const nightSpread = night.scenarios.conservative.totalSec - night.scenarios.optimistic.totalSec
    const peakSpread = peak.scenarios.conservative.totalSec - peak.scenarios.optimistic.totalSec

    expect(peakSpread).toBeGreaterThan(nightSpread)
  })

  it("уверенность объясняется причинами, а не «магическим числом»", () => {
    const result = forecast(cityThenHighway(), {
      departure: at(9),
      weatherBySegment: [null, null],
    })

    expect(result.confidence.reasons.length).toBeGreaterThan(0)
    expect(["high", "medium", "low"]).toContain(result.confidence.level)
  })

  it("объяснение перечисляет применённые поправки с причинами", () => {
    const result = forecast(cityThenHighway(), {
      departure: at(18),
      weatherBySegment: [weather({ weatherCode: 73, temperatureC: -3 }), null],
      stops: [{ kind: "loading", afterSegmentIndex: 0 }],
    })

    const kinds = result.explanation.map((item) => item.kind)
    expect(kinds).toContain("traffic")
    expect(kinds).toContain("weather")
    expect(kinds).toContain("vehicle")
    expect(kinds).toContain("stops")
    expect(kinds).toContain("window")

    const traffic = result.explanation.find((item) => item.kind === "traffic")
    expect(traffic?.detail.length).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("21. Крайние значения", () => {
  it("нулевое расстояние даёт нулевое время без падения", () => {
    const result = forecast([segment("motorway", 0, 95, 0)], { departure: at(9) })

    expect(result.scenarios.base.totalSec).toBe(0)
    expect(result.reliable).toBe(true)
  })

  it("некорректные координаты не роняют расчёт", () => {
    const broken = segment("motorway", 100, 95, 0)
    broken.from = { lat: NaN, lng: NaN }

    const result = forecast([broken], { departure: at(9) })

    expect(Number.isFinite(result.scenarios.base.totalSec)).toBe(true)
  })

  it("пустой список сегментов не даёт бесконечности", () => {
    const result = forecast([], { departure: at(9) })

    expect(result.scenarios.base.totalSec).toBe(0)
    expect(result.segments).toHaveLength(0)
  })

  it("отрицательная длительность сегмента обнуляется", () => {
    const negative = segment("motorway", 100, 95, 0)
    negative.baseDurationSec = -500

    const result = forecast([negative], { departure: at(9) })

    expect(result.scenarios.base.drivingSec).toBeGreaterThanOrEqual(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 17. Обязательный отдых В ЧАСАХ рейса (регресс: перерыв прибавлялся в конце)
//
// Раньше план перерывов считался после цикла по сегментам и добавлялся к
// итогу одной суммой. Сегменты после перерыва при этом считались БЕЗ него:
// час пик, сезон и погода брались на момент, которого в реальности не
// существовало. Здесь закреплено обратное поведение.
// ─────────────────────────────────────────────────────────────────────────────
describe("17. Перерыв водителя сдвигает последующие сегменты", () => {
  /** Несколько плеч по 100 км трассы ≈ 109 мин каждое: перерыв наступает после 3-го. */
  function longRoute(km = 100, count = 6): RouteSegment[] {
    return Array.from({ length: count }, (_, index) =>
      segment("federal", km, 65, index, `плечо ${index + 1}`),
    )
  }

  it("перерыв сдвигает прибытие во все последующие сегменты", () => {
    // 4 плеча: лимит непрерывности (270 мин) наступает один раз,
    // лимит смены (600 мин) — ни разу. Ровно один перерыв.
    const result = forecast(longRoute(100, 4), { departure: at(0) })

    const breaks = result.rest.breaks
    expect(breaks).toHaveLength(1)
    expect(breaks[0].kind).toBe("break")
    expect(breaks[0].minutes).toBe(45)
    expect(breaks[0].afterSegmentIndex).toBe(2)

    // До перерыва: сегменты 1-3 идут без паузы
    expect(result.segments[1].arrivalAt.getTime()).toBe(result.segments[0].departureAt.getTime())
    // После перерыва: 4-е плечо выезжает ровно на 45 мин позже
    expect(result.segments[3].arrivalAt.getTime()).toBe(
      result.segments[2].departureAt.getTime() + 45 * 60_000,
    )
  })

  it("смещение после перерыва равно именно перерыву, не «какой-то задержке»", () => {
    const result = forecast(longRoute(100, 4), { departure: new Date(Date.UTC(2026, 9, 15, 4, 0)) })
    const beforeBreak = result.segments[2]
    const afterBreak = result.segments[3]

    expect(afterBreak.arrivalAt.getTime() - beforeBreak.departureAt.getTime()).toBe(45 * 60_000)
    expect(afterBreak.arrivalAt.getTime()).toBeGreaterThan(beforeBreak.departureAt.getTime())
  })

  it("несколько перерывов: каждый сдвигает часы", () => {
    // 12 плеч по 100 км: перерыв после 3-го, 6-го и 9-го
    const result = forecast(longRoute(100, 12), { departure: at(0) })

    expect(result.rest.breaks.length).toBeGreaterThanOrEqual(3)
    expect(result.rest.breaks.every((b) => b.minutes > 0)).toBe(true)

    // Сумма пауз входит в общее время ровно один раз
    const sumBreaks = result.rest.breaks.reduce((sum, b) => sum + b.minutes, 0) * 60
    const sumDriving = result.segments.reduce((sum, s) => sum + s.drivingSec, 0)
    expect(result.scenarios.base.totalSec).toBe(sumDriving + sumBreaks)
  })

  it("переход через полночь: сегменты после полуночи считаются новой датой", () => {
    const result = forecast(longRoute(100, 4), { departure: new Date(Date.UTC(2026, 9, 15, 22, 0)) })

    expect(result.segments.some((s) => s.arrivalAt.getUTCDate() === 16)).toBe(true)
    expect(result.scenarios.base.arrivalAt.getUTCDate()).toBe(16)
    expect(result.segments[result.segments.length - 1].departureAt.getTime()).toBe(
      result.scenarios.base.arrivalAt.getTime(),
    )
  })

  it("перерыв и остановка вместе: оба в часах и оба в итоге", () => {
    const result = forecast(longRoute(100, 4), {
      departure: at(0),
      stops: [{ kind: "loading", afterSegmentIndex: 2, actualMinutes: 60 }],
    })

    expect(result.segments[3].arrivalAt.getTime()).toBe(
      result.segments[2].departureAt.getTime() + 60 * 60_000 + 45 * 60_000,
    )
    expect(result.scenarios.base.stopsSec).toBe(60 * 60)
    expect(result.scenarios.base.restSec).toBe(45 * 60)
  })

  it("цепочка сегментов совпадает с итоговым прибытием (нет двойного учёта)", () => {
    const result = forecast(longRoute(100, 4), { departure: at(0) })

    const last = result.segments[result.segments.length - 1]
    expect(last.departureAt.getTime()).toBe(result.scenarios.base.arrivalAt.getTime())

    const expected =
      result.segments.reduce((sum, s) => sum + s.drivingSec, 0) +
      result.scenarios.base.stopsSec +
      result.scenarios.base.restSec
    expect(result.scenarios.base.totalSec).toBe(expected)
  })

  it("одно длинное плечо: перерыв вставляется ВНУТРИ плеча, а не после точки", () => {
    // 600 км по трассе ≈ 380 мин движения — больше лимита 270 мин.
    // Раньше перерыв «после последней точки» прибытие не задерживал вовсе.
    const result = forecast([segment("motorway", 600, 95, 0)], { departure: at(9) })

    expect(result.rest.breaks.length).toBeGreaterThan(0)
    expect(result.scenarios.base.restSec).toBeGreaterThan(0)
    // Прибытие сдвинуто ровно на паузу
    const withoutRest = result.scenarios.base.drivingSec
    expect(result.scenarios.base.totalSec).toBe(withoutRest + result.scenarios.base.restSec)
  })

  it("оптимистичный сценарий без перерывов, но цепочка сегментов согласована", () => {
    const result = forecast(longRoute(100, 4), { departure: at(0) })

    expect(result.scenarios.optimistic.restSec).toBe(0)
    expect(result.scenarios.optimistic.totalSec).toBeLessThan(result.scenarios.base.totalSec)
    expect(result.segments[3].arrivalAt.getTime()).toBeGreaterThan(
      result.segments[2].departureAt.getTime(),
    )
  })

  it("уже отработанное до выезда время сдвигает первый перерыв", () => {
    const fresh = forecast(longRoute(100, 4), { departure: at(0) })
    const tired = forecast(longRoute(100, 4), { departure: at(0), priorDrivingMinutes: 240 })

    expect(fresh.rest.breaks[0]?.afterSegmentIndex).toBe(2)
    expect(tired.rest.breaks[0]?.afterSegmentIndex).toBe(0)
    expect(tired.rest.priorDrivingUnknown).toBe(false)
  })

  it("многодневный рейс: ежедневный отдых вставляется между плечами", () => {
    // 8 плеч по 200 км ≈ 184 мин каждое: смена (600 мин) наступает после 4-го
    const result = forecast(longRoute(200, 8), {
      departure: new Date(Date.UTC(2026, 9, 15, 6, 0)),
    })

    const daily = result.rest.breaks.find((b) => b.kind === "daily_rest")
    expect(daily).toBeDefined()
    expect(daily!.minutes).toBe(660)

    const nextIndex = daily!.afterSegmentIndex + 1
    if (nextIndex < result.segments.length) {
      expect(result.segments[nextIndex].arrivalAt.getTime()).toBe(
        result.segments[daily!.afterSegmentIndex].departureAt.getTime() + 660 * 60_000,
      )
    }
  })

  it("объяснение показывает паузы водителя с привязкой к плечу", () => {
    const result = forecast(longRoute(100, 4), { departure: at(0) })

    const restItem = result.explanation.find((item) => item.kind === "rest")
    expect(restItem).toBeDefined()
    expect(restItem!.detail).toContain("45 мин")
    expect(restItem!.detail).toContain("после сегмента 3")
  })
})

describe("надёжность при неполном геокодировании", () => {
  it("неогеокодированные точки делают прогноз недостоверным", () => {
    // Регрессия: reliable смотрел только на нарушения и перекрытия. Геокодер,
    // молча отбросивший часть адресов, давал более короткий и правдоподобный
    // маршрут с нулём нарушений — и reliable оставался true.
    const full = forecast(cityThenHighway())
    expect(full.reliable).toBe(true)
    expect(full.unlocatedCount).toBe(0)

    const partial = forecast(cityThenHighway(), {
      unlocatedAddresses: ["ЗЗЗ-несуществующий-город, ул. Нету"],
    })
    expect(partial.reliable).toBe(false)
    expect(partial.unlocatedCount).toBe(1)
    expect(partial.reliabilityNote).toContain("не определены координаты 1 точек")
    expect(partial.reliabilityNote).toContain("ЗЗЗ-несуществующий")
  })

  it("полный маршрут остаётся достоверным", () => {
    const result = forecast(cityThenHighway(), { unlocatedAddresses: [] })
    expect(result.reliable).toBe(true)
    expect(result.reliabilityNote).toBeUndefined()
  })
})
