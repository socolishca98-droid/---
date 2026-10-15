// __tests__/eta/modules.test.ts
//
// Модульные тесты посегментного ядра: часовой пояс, модель пробок, погода,
// остановки, нормы труда, профиль ТС, события, метрики точности.
//
// Часовой пояс везде явный ("UTC"): иначе результат зависел бы от машины,
// на которой запущен тест, и «московские» 9:00 на сервере в UTC стали бы 6:00.

import { beforeEach, describe, expect, it, vi } from "vitest"

import { localHour, localDayOfWeek, seasonOf, isWeekend } from "@/lib/eta/time"
import {
  TRAFFIC_BY_HOUR,
  estimateTraffic,
  trafficUncertainty,
  zoneOfClass,
} from "@/lib/eta/traffic-model"
import { assessWeather, weatherUncertainty } from "@/lib/eta/weather/model"
import { STOP_DEFAULTS, operationStats, resolveStop, totalStopMinutes } from "@/lib/eta/stops"
import { DEFAULT_REST_RULES, createRestTracker, planRestBreaks } from "@/lib/eta/driver-rest"
import { buildVehicleProfile, checkRouteRestrictions } from "@/lib/eta/vehicle-profile"
import { activeEvents, assessEvent, eventsForSegment, hasBlockingEvent } from "@/lib/eta/events"
import { calculateAccuracyMetrics, breakdownBy, arrivalErrorMinutes } from "@/lib/eta/metrics"

const TZ = "UTC"
const at = (hour: number, day = 15, month = 9) => new Date(Date.UTC(2026, month, day, hour, 0))

// ─────────────────────────────────────────────────────────────────────────────
describe("time — местное время сегмента", () => {
  it("час считается в часовом поясе маршрута, а не процесса", () => {
    // 09:00 UTC = 12:00 в Москве
    expect(localHour(at(9), "Europe/Moscow")).toBe(12)
    expect(localHour(at(9), "UTC")).toBe(9)
    expect(localHour(at(9), "Asia/Yakutsk")).toBe(18)
  })

  it("день недели и сезон тоже местные", () => {
    expect(localDayOfWeek(at(9, 15), "UTC")).toBe(4) // четверг
    expect(seasonOf(at(9, 15, 0), "UTC")).toBe("winter")
    expect(seasonOf(at(9, 15, 6), "UTC")).toBe("summer")
  })

  it("выходные определяются по местной дате", () => {
    expect(isWeekend(at(9, 17), "UTC")).toBe(true) // суббота
    expect(isWeekend(at(9, 18), "UTC")).toBe(true) // воскресенье
    expect(isWeekend(at(9, 19), "UTC")).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("traffic-model — таблица по часам и зонам", () => {
  it("таблица покрывает все 24 часа для всех трёх зон", () => {
    for (const zone of ["city", "suburban", "rural"] as const) {
      expect(TRAFFIC_BY_HOUR[zone]).toHaveLength(24)
      for (const value of TRAFFIC_BY_HOUR[zone]) {
        expect(value).toBeGreaterThanOrEqual(1)
        expect(value).toBeLessThan(2)
      }
    }
  })

  it("в час пик город медленнее пригорода, пригород медленнее трассы", () => {
    const city = estimateTraffic({ when: at(18), roadClass: "city", timeZone: TZ })
    const suburban = estimateTraffic({ when: at(18), roadClass: "settlement", timeZone: TZ })
    const rural = estimateTraffic({ when: at(18), roadClass: "motorway", timeZone: TZ })

    expect(city.factor).toBeGreaterThan(suburban.factor)
    expect(suburban.factor).toBeGreaterThan(rural.factor)
  })

  it("ночью коэффициенты минимальны", () => {
    const night = estimateTraffic({ when: at(3), roadClass: "city", timeZone: TZ })
    expect(night.hourFactor).toBe(1)
  })

  it("зона определяется классом дороги, а unknown не считается городом", () => {
    // Реальный баг, который поймал тест: «city» попадал в default и получал
    // загородные коэффициенты
    expect(zoneOfClass("city")).toBe("city")
    expect(zoneOfClass("dense_city")).toBe("city")
    expect(zoneOfClass("industrial")).toBe("city")
    expect(zoneOfClass("motorway")).toBe("rural")
    expect(zoneOfClass("unknown")).toBe("rural")
  })

  it("пятница и праздник учитываются", () => {
    const friday = estimateTraffic({ when: at(18, 16), roadClass: "city", timeZone: TZ })
    const tuesday = estimateTraffic({ when: at(18, 13), roadClass: "city", timeZone: TZ })

    expect(friday.factor).toBeGreaterThan(tuesday.factor)
  })

  it("праздник РФ распознаётся и снижает коэффициент", () => {
    // Реальный баг: en-GB отдаёт «день/месяц», а множество праздников хранит
    // «месяц-день» — сравнение не срабатывало никогда, и праздничный
    // коэффициент не применялся вообще. 5 января 2026 — понедельник-праздник.
    const holidayMonday = estimateTraffic({ when: new Date(Date.UTC(2026, 0, 5, 18, 0)), roadClass: "city", timeZone: TZ })
    const usualMonday = estimateTraffic({ when: new Date(Date.UTC(2026, 0, 12, 18, 0)), roadClass: "city", timeZone: TZ })

    expect(holidayMonday.holiday).toBe(true)
    expect(usualMonday.holiday).toBe(false)
    expect(holidayMonday.factor).toBeLessThan(usualMonday.factor)
  })

  it("неопределённость шире в час пик, чем ночью", () => {
    const night = trafficUncertainty(estimateTraffic({ when: at(3), roadClass: "city", timeZone: TZ }))
    const peak = trafficUncertainty(estimateTraffic({ when: at(18), roadClass: "city", timeZone: TZ }))

    expect(peak.conservative).toBeGreaterThan(night.conservative)
    expect(peak.optimistic).toBeLessThan(night.optimistic)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("weather/model — погодные коэффициенты", () => {
  const sample = (overrides: Record<string, unknown> = {}) => ({
    temperatureC: 15,
    precipitationMm: 0,
    weatherCode: 0,
    visibilityM: 20000,
    windSpeedKmh: 10,
    ...overrides,
  })

  it("нет данных — коэффициент 1.0 и честный unavailable", () => {
    const result = assessWeather(null, "motorway")
    expect(result.factor).toBe(1)
    expect(result.available).toBe(false)
    expect(result.iceRisk).toBe(0)
  })

  it("сухо — коэффициент 1.0", () => {
    expect(assessWeather(sample(), "motorway").factor).toBe(1)
  })

  it("снег на автомагистрали сильнее, чем в промзоне", () => {
    const snowy = sample({ weatherCode: 73, temperatureC: -3, precipitationMm: 4 })
    expect(assessWeather(snowy, "motorway").factor)
      .toBeGreaterThan(assessWeather(snowy, "industrial").factor)
  })

  it("интенсивность осадков решает, а не сам факт осадков", () => {
    const drizzle = assessWeather(sample({ weatherCode: 61, precipitationMm: 0.2 }), "motorway")
    const downpour = assessWeather(sample({ weatherCode: 65, precipitationMm: 9 }), "motorway")

    expect(drizzle.factor).toBeLessThan(downpour.factor)
    expect(drizzle.factor).toBeGreaterThan(1)
  })

  it("около нуля — риск гололедица как вероятность, не подтверждение", () => {
    const result = assessWeather(sample({ weatherCode: 61, temperatureC: 0.3, precipitationMm: 3 }), "motorway")

    expect(result.iceRisk).toBeGreaterThan(0)
    expect(result.iceRisk).toBeLessThan(1)
    expect(result.iceConfirmed).toBe(false)
    expect(result.reason).toContain("риск гололедица")
  })

  it("гололёд даёт сильную поправку и меняет условие", () => {
    const result = assessWeather(sample({ weatherCode: 66, temperatureC: -1, precipitationMm: 3 }), "motorway")
    expect(result.condition).toBe("freezing_rain")
    expect(result.factor).toBeGreaterThan(1.15)
  })

  it("туман определяется по видимости, даже если кода нет", () => {
    expect(assessWeather(sample({ visibilityM: 200 }), "motorway").condition).toBe("fog")
    expect(assessWeather(sample({ weatherCode: 45, visibilityM: 340 }), "motorway").condition).toBe("fog")
  })

  it("код тумана при нормальной видимости туманом не считается", () => {
    // Живой маршрут: Open-Meteo вернул code 45 с видимостью 1160 м
    const result = assessWeather(sample({ weatherCode: 45, visibilityM: 1160 }), "motorway")
    expect(result.condition).toBe("clear")
    expect(result.factor).toBe(1)
  })

  it("видимость ниже 100 м — отдельное условие", () => {
    expect(assessWeather(sample({ weatherCode: 45, visibilityM: 60 }), "motorway").condition)
      .toBe("low_visibility")
  })

  it("порывы ветра замедляют", () => {
    const calm = assessWeather(sample({ windGustsKmh: 15 }), "motorway")
    const windy = assessWeather(sample({ windGustsKmh: 70 }), "motorway")
    expect(windy.factor).toBeGreaterThan(calm.factor)
    expect(windy.reason).toContain("порывы")
  })

  it("неопределённость погоды растёт со временем", () => {
    const soon = weatherUncertainty(6)
    const later = weatherUncertainty(120)

    expect(later.conservative).toBeGreaterThan(soon.conservative)
    expect(later.optimistic).toBeLessThan(soon.optimistic)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("stops — остановки отдельно от движения", () => {
  it("диапазоны соответствуют ТЗ", () => {
    expect(STOP_DEFAULTS.loading).toEqual({ min: 30, typical: 75, max: 120 })
    expect(STOP_DEFAULTS.unloading).toEqual({ min: 30, typical: 75, max: 120 })
    expect(STOP_DEFAULTS.documents).toEqual({ min: 10, typical: 20, max: 30 })
    expect(STOP_DEFAULTS.waiting).toEqual({ min: 0, typical: 60, max: 120 })
    expect(STOP_DEFAULTS.extra_point).toEqual({ min: 15, typical: 37, max: 60 })
  })

  it("приоритет: факт клиента → медиана → диапазон", () => {
    const actual = resolveStop({ kind: "loading", actualMinutes: 90 })
    expect(actual.minutes).toBe(90)
    expect(actual.source).toBe("actual")

    const history = resolveStop({ kind: "loading", medianMinutes: 50 })
    expect(history.minutes).toBe(50)
    expect(history.source).toBe("history")

    const dflt = resolveStop({ kind: "loading" })
    expect(dflt.minutes).toBe(75)
    expect(dflt.source).toBe("default")
  })

  it("факт важнее медианы, даже если медиана есть", () => {
    const result = resolveStop({ kind: "unloading", actualMinutes: 40, medianMinutes: 100 })
    expect(result.minutes).toBe(40)
  })

  it("сценарии расходятся вокруг базового значения", () => {
    const stop = resolveStop({ kind: "loading" })
    expect(stop.optimisticMinutes).toBeLessThan(stop.minutes)
    expect(stop.conservativeMinutes).toBeGreaterThan(stop.minutes)
  })

  it("сумма по сценариям считается отдельно", () => {
    const stops = [resolveStop({ kind: "loading" }), resolveStop({ kind: "documents" })]

    expect(totalStopMinutes(stops, "optimistic")).toBe(40)
    expect(totalStopMinutes(stops, "base")).toBe(95)
    expect(totalStopMinutes(stops, "conservative")).toBe(150)
  })

  it("статистика по истории: медиана и процентили", () => {
    const stats = operationStats([30, 40, 50, 60, 120, 200])
    expect(stats).not.toBeNull()
    expect(stats!.median).toBe(60)
    expect(stats!.p90).toBe(200)
    expect(stats!.count).toBe(6)
  })

  it("выбросы вне [0, 24 часа] отбрасываются", () => {
    expect(operationStats([30, -5, 2000])).toEqual({ median: 30, p75: 30, p90: 30, count: 1 })
    expect(operationStats([])).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("driver-rest — нормы труда и отдыха", () => {
  it("на коротком рейсе перерывов нет", () => {
    const plan = planRestBreaks({ segmentDrivingMinutes: [120, 100] })
    expect(plan.breaks).toHaveLength(0)
    expect(plan.totalMinutes).toBe(0)
  })

  it("после лимита непрерывного движения встаёт перерыв", () => {
    const plan = planRestBreaks({ segmentDrivingMinutes: [300] })

    expect(plan.breaks).toHaveLength(1)
    expect(plan.breaks[0].kind).toBe("break")
    expect(plan.breaks[0].minutes).toBe(DEFAULT_REST_RULES.breakMinutes)
  })

  it("после лимита смены встаёт ежедневный отдых", () => {
    const plan = planRestBreaks({ segmentDrivingMinutes: [600] })

    expect(plan.breaks.some((b) => b.kind === "daily_rest")).toBe(true)
    expect(plan.totalMinutes).toBeGreaterThan(DEFAULT_REST_RULES.breakMinutes)
  })

  it("уже отработанное до выезда время учитывается", () => {
    const fresh = planRestBreaks({ segmentDrivingMinutes: [100] })
    const tired = planRestBreaks({ segmentDrivingMinutes: [100], priorDrivingMinutes: 250 })

    expect(fresh.breaks).toHaveLength(0)
    expect(tired.breaks.length).toBeGreaterThan(0)
    expect(tired.priorDrivingUnknown).toBe(false)
  })

  it("без данных о предыдущем времени управления — предупреждение, а не утверждение", () => {
    const plan = planRestBreaks({ segmentDrivingMinutes: [60] })
    expect(plan.priorDrivingUnknown).toBe(true)
    expect(plan.warning).toContain("не доказано")
  })

  it("правила переопределяются (многоводительский экипаж, другая юрисдикция)", () => {
    const plan = planRestBreaks({
      segmentDrivingMinutes: [100],
      rules: { maxDrivingMinutes: 90 },
    })
    expect(plan.breaks).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("vehicle-profile — профиль ТС", () => {
  it("категория выводится из типа ТС", () => {
    expect(buildVehicleProfile({ type: "truck" }).category).toBe("truck")
    expect(buildVehicleProfile({ type: "тягач", trailer: true }).category).toBe("articulated")
    expect(buildVehicleProfile({ type: "car" }).category).toBe("light")
  })

  it("без типа категория выводится из грузоподъёмности", () => {
    expect(buildVehicleProfile({ capacity: 20000 }).category).toBe("truck")
    expect(buildVehicleProfile({ capacity: 500 }).category).toBe("van")
  })

  it("недостающие данные попадают в missing, уверенность падает", () => {
    const empty = buildVehicleProfile()
    const full = buildVehicleProfile({ type: "truck", capacity: 20000, length: 12, width: 2.5, height: 3.2 })

    expect(empty.missing.length).toBeGreaterThan(0)
    expect(empty.confidence).toBeLessThan(full.confidence)
    // Но прогноз всё равно считается: неполные данные — не отказ
    expect(empty.speedFactor).toBeGreaterThan(1)
  })

  it("тяжёлому и длинному ТС нужно больше времени", () => {
    expect(buildVehicleProfile({ type: "спецтехника" }).speedFactor)
      .toBeGreaterThan(buildVehicleProfile({ type: "truck" }).speedFactor)
    expect(buildVehicleProfile({ type: "truck" }).speedFactor)
      .toBeGreaterThan(buildVehicleProfile({ type: "car" }).speedFactor)
  })

  it("20-тонный грузовик остаётся truck, автопоезд — только с прицепом", () => {
    // Реальный дефект: грузоподъёмность выше 3.5 т сразу давала «автопоезд»
    // с коэффициентом 1.2, то есть любую фуру модель считала сцепкой
    expect(buildVehicleProfile({ capacity: 20000 }).category).toBe("truck")
    expect(buildVehicleProfile({ capacity: 25000 }).category).toBe("articulated")
    expect(buildVehicleProfile({ type: "тягач", trailer: true }).category).toBe("articulated")
  })

  it("недопустимая высота — нарушение, а не коэффициент", () => {
    const violations = checkRouteRestrictions(
      { type: "truck", height: 4.2 },
      [{ code: "max_height", message: "ограничение 3.5 м", value: 3.5 }],
    )

    expect(violations).toHaveLength(1)
    expect(violations[0].message).toContain("выше ограничения")
  })

  it("допустимая высота нарушений не даёт", () => {
    const violations = checkRouteRestrictions(
      { type: "truck", height: 3.2 },
      [{ code: "max_height", message: "ограничение 3.5 м", value: 3.5 }],
    )
    expect(violations).toHaveLength(0)
  })

  it("ограничение разбирается из текста, если числа нет", () => {
    const violations = checkRouteRestrictions(
      { type: "truck", height: 4.2 },
      [{ code: "max_height", message: "не выше 3.5 м" }],
    )
    expect(violations).toHaveLength(1)
  })

  it("запрет грузовиков и опасного груза проверяется", () => {
    expect(checkRouteRestrictions({ type: "truck" }, [{ code: "no_trucks", message: "грузовым запрещено" }]))
      .toHaveLength(1)
    expect(checkRouteRestrictions({ type: "car" }, [{ code: "no_trucks", message: "грузовым запрещено" }]))
      .toHaveLength(0)
    expect(checkRouteRestrictions({ type: "truck", hazmat: true }, [{ code: "no_hazmat", message: "опасный груз запрещён" }]))
      .toHaveLength(1)
  })

  it("без ТС ограничения не проверяются", () => {
    expect(checkRouteRestrictions(undefined, [{ code: "max_height", message: "3.5", value: 3.5 }]))
      .toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("events — дорожные события", () => {
  const accident = (severity: "partial" | "full", at_: Date = at(9)): RoadEventLike[] => [
    { segmentIndex: 0, severity, description: "ДТП на съезде", reportedAt: at_ },
  ]
  type RoadEventLike = Parameters<typeof assessEvent>[0]

  it("частичное перекрытие — множитель, а не блокировка", () => {
    const result = assessEvent(accident("partial")[0], "motorway")
    expect(result.blocked).toBe(false)
    expect(result.factor).toBeGreaterThan(1)
    expect(result.reason).toContain("движение ограничено")
  })

  it("полное перекрытие — блокировка без искусственного максимума", () => {
    const result = assessEvent(accident("full")[0], "motorway")
    expect(result.blocked).toBe(true)
    expect(result.reason).toContain("нужен другой маршрут")
  })

  it("на узкой городской улице относительная задержка меньше", () => {
    const motorway = assessEvent(accident("partial")[0], "motorway")
    const dense = assessEvent(accident("partial")[0], "dense_city")
    expect(dense.factor).toBeLessThan(motorway.factor)
  })

  it("устаревшие события отбрасываются", () => {
    const expired = [
      { segmentIndex: 0, severity: "partial" as const, description: "ДТП", reportedAt: at(6), expiresAt: at(8) },
    ]
    expect(activeEvents(expired, at(9))).toHaveLength(0)
    expect(activeEvents(expired, at(7))).toHaveLength(1)
  })

  it("события фильтруются по сегменту", () => {
    const events = [
      { segmentIndex: 0, severity: "partial" as const, description: "А", reportedAt: at(9) },
      { segmentIndex: 2, severity: "partial" as const, description: "Б", reportedAt: at(9) },
    ]
    expect(eventsForSegment(events, 2)).toHaveLength(1)
    expect(eventsForSegment(events, 1)).toHaveLength(0)
  })

  it("блокирующее событие определяется по оценкам", () => {
    expect(hasBlockingEvent([assessEvent(accident("full")[0], "motorway")])).toBe(true)
    expect(hasBlockingEvent([assessEvent(accident("partial")[0], "motorway")])).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("metrics — точность прогноза по фактам", () => {
  /**
   * Факт: прогноз на 10:00, факт на 10:00 + deltaMinutes.
   * delta > 0 — прибыли позже прогноза (опоздание), delta < 0 — раньше.
   */
  const fact = (deltaMinutes: number, day = 15, month = 9) => ({
    predictedAt: at(10, day, month),
    actualAt: new Date(at(10, day, month).getTime() + deltaMinutes * 60_000),
    actualDrivingSec: 3600,
    predictedDrivingSec: 3600,
  })

  it("пустая выборка не даёт деления на ноль", () => {
    const metrics = calculateAccuracyMetrics([])
    expect(metrics.sampleCount).toBe(0)
    expect(metrics.maeMinutes).toBe(0)
    expect(metrics.recalibrationReady).toBe(false)
  })

  it("MAE и медиана считаются", () => {
    const metrics = calculateAccuracyMetrics([fact(0, 15), fact(60, 16), fact(120, 17)])
    expect(metrics.sampleCount).toBe(3)
    expect(metrics.maeMinutes).toBe(60)
    expect(metrics.medianAbsErrorMinutes).toBe(60)
  })

  it("доля попаданий в коридор 15/30 минут", () => {
    const metrics = calculateAccuracyMetrics([fact(0, 15), fact(30, 16), fact(75, 17)])

    expect(metrics.within15Minutes).toBeCloseTo(1 / 3, 2)
    expect(metrics.within30Minutes).toBeCloseTo(2 / 3, 2)
  })

  it("систематическое опоздание и опереждение различаются", () => {
    const late = calculateAccuracyMetrics([fact(60, 15), fact(120, 16)])
    const early = calculateAccuracyMetrics([fact(-60, 15), fact(-120, 16)])

    expect(late.biasMinutes).toBeGreaterThan(0)
    expect(early.biasMinutes).toBeLessThan(0)
  })

  it("выбросы исключаются из метрик", () => {
    const metrics = calculateAccuracyMetrics([
      fact(0, 15),
      { ...fact(600, 16), outlier: true },
    ])

    expect(metrics.sampleCount).toBe(1)
    expect(metrics.outliersExcluded).toBe(1)
    expect(metrics.maeMinutes).toBe(0)
  })

  it("ошибка времени движения считается отдельно от прибытия", () => {
    const metrics = calculateAccuracyMetrics([
      { ...fact(60, 15), actualDrivingSec: 4000, predictedDrivingSec: 3600 },
    ])

    expect(metrics.drivingBiasMinutes).toBeCloseTo((4000 - 3600) / 60, 1)
  })

  it("порог пересмотра коэффициентов не достигается на нескольких рейсах", () => {
    const metrics = calculateAccuracyMetrics([fact(0, 15), fact(60, 16)])
    expect(metrics.recalibrationReady).toBe(false)
  })

  it("разбивка по типу дороги группирует и сортирует по ошибке", () => {
    const rows = breakdownBy(
      [
        { ...fact(0, 15), roadClass: "motorway" },
        { ...fact(60, 16), roadClass: "city" },
        { ...fact(30, 17), roadClass: "city" },
        { ...fact(0, 18), roadClass: undefined },
      ],
      "roadClass",
    )

    const groups = rows.map((row) => row.group)
    expect(groups).toContain("motorway")
    expect(groups).toContain("city")
    expect(groups).toContain("нет данных")

    // Худшая группа — первая
    expect(rows[0].metrics.maeMinutes).toBeGreaterThanOrEqual(rows[rows.length - 1].metrics.maeMinutes)
  })

  it("разбивка по сезону работает по дате прогноза", () => {
    const rows = breakdownBy([fact(0, 15, 0), fact(120, 15, 6)], "season")
    expect(rows.map((row) => row.group).sort()).toEqual(["summer", "winter"])
  })

  it("ошибка прибытия в минутах", () => {
    expect(arrivalErrorMinutes(fact(60))).toBe(60)
    expect(arrivalErrorMinutes(fact(-60))).toBe(-60)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("weather/client — флаг лицензии", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it("по умолчанию погода выключена", async () => {
    vi.stubEnv("ETA_WEATHER", "")
    const { isWeatherEnabled } = await import("@/lib/eta/weather/client")
    expect(isWeatherEnabled()).toBe(false)
  })

  it("включается только явным флагом", async () => {
    vi.stubEnv("ETA_WEATHER", "on")
    const { isWeatherEnabled } = await import("@/lib/eta/weather/client")
    expect(isWeatherEnabled()).toBe(true)
  })
})

describe("createRestTracker — инкрементальный планировщик перерывов", () => {
  it("на коротком рейсе перерывов нет", () => {
    const tracker = createRestTracker()
    expect(tracker.afterSegment(0, 60)).toBeNull()
    expect(tracker.afterSegment(1, 60)).toBeNull()
    expect(tracker.totalMinutes()).toBe(0)
  })

  it("после лимита непрерывного движения возвращает перерыв и сбрасывает счётчик", () => {
    const tracker = createRestTracker()
    expect(tracker.afterSegment(0, 200)).toBeNull()

    const rest = tracker.afterSegment(1, 100)
    expect(rest).not.toBeNull()
    expect(rest!.kind).toBe("break")
    expect(rest!.minutes).toBe(DEFAULT_REST_RULES.breakMinutes)
    expect(rest!.afterSegmentIndex).toBe(1)

    // Счётчик сброшен: следующие 100 мин перерыва не дают
    expect(tracker.afterSegment(2, 100)).toBeNull()
  })

  it("после лимита смены возвращает ежедневный отдых", () => {
    // Лимит смены задан явно: с дефолтными 600 мин смена наступает позже,
    // чем обычный перерыв, и проверять её пришлось бы на 6 плечах.
    const tracker = createRestTracker({ maxShiftDrivingMinutes: 400 })
    tracker.afterSegment(0, 150) // 150 мин смены
    tracker.afterSegment(1, 150) // 300 мин: сюда же обычный перерыв
    const rest = tracker.afterSegment(2, 150) // 450 ≥ 400 → смена
    expect(rest).not.toBeNull()
    expect(rest!.kind).toBe("daily_rest")
    expect(rest!.minutes).toBe(DEFAULT_REST_RULES.dailyRestMinutes)
    expect(rest!.reason).toContain("400")
  })

  it("смена поглощает обычный перерыв и сбрасывает оба счётчика", () => {
    const tracker = createRestTracker({ maxShiftDrivingMinutes: 400 })
    tracker.afterSegment(0, 200)
    tracker.afterSegment(1, 200) // 400 ≥ 400 → смена
    // После смены оба счётчика обнулены: 100 мин не дают перерыва
    expect(tracker.afterSegment(2, 100)).toBeNull()
  })

  it("уже отработанное до выезда время учитывается", () => {
    const fresh = createRestTracker()
    const tired = createRestTracker(undefined, 250)

    expect(fresh.afterSegment(0, 100)).toBeNull()
    expect(tired.afterSegment(0, 100)).not.toBeNull()
    expect(tired.priorDrivingUnknown()).toBe(false)
  })

  it("без данных о предыдущем времени управления — предупреждение", () => {
    const tracker = createRestTracker()
    tracker.afterSegment(0, 60)
    expect(tracker.priorDrivingUnknown()).toBe(true)
  })

  it("правила переопределяются, применённый набор правил доступен", () => {
    const tracker = createRestTracker({ maxDrivingMinutes: 90, jurisdiction: "Тест" })
    expect(tracker.rules().maxDrivingMinutes).toBe(90)
    expect(tracker.rules().jurisdiction).toBe("Тест")

    const rest = tracker.afterSegment(0, 100)
    expect(rest).not.toBeNull()
    expect(rest!.reason).toContain("90")
  })

  it("нулевое и отрицательное время сегмента перерыва не создают", () => {
    const tracker = createRestTracker()
    expect(tracker.afterSegment(0, 0)).toBeNull()
    expect(tracker.afterSegment(1, -10)).toBeNull()
    expect(tracker.totalMinutes()).toBe(0)
  })

  it("перерыв ставится ПОСЛЕ остановок, поэтому планировщик не сбрасывается на них", () => {
    // Остановка не считается перерывом: 2 часа выгрузки не дают права
    // утверждать, что водитель отдохнул согласно нормам.
    const tracker = createRestTracker()
    tracker.afterSegment(0, 200)
    const rest = tracker.afterSegment(1, 100)
    expect(rest).not.toBeNull()
  })
})
