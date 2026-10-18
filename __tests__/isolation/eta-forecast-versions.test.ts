// __tests__/eta/forecast-versions.test.ts
//
// История версий прогноза и запись факта — задача 3 второго промпта.
//
// Что здесь проверяется и почему это важно:
//   1. Каждый пересчёт — НОВАЯ строка, а не правка предыдущей. Иначе кнопка
//      «Пересчитать» стирала исходный прогноз, и сравнить «как планировали» с
//      «как получилось» становилось нечем.
//   2. recalcCount считает версии. Раньше saveForecast всегда писал 0, и
//      счётчик пересчётов показывал ноль при любом числе нажатий.
//   3. initialArrivalAt берётся у первой версии и не перезаписывается.
//   4. Запись факта не трогает прогноз: initialArrivalAt и currentArrivalAt
//      остаются, ошибка считается от последнего прогноза.
//   5. Повторная запись факта по тому же прогнозу — отказ, а не вторая ошибка.
//   6. Предпросмотр без рейса версий не заводит (иначе каждый просмотр
//      карточки заказа плодил бы строки в базе).
//
// База — память (__tests__/__mocks__/prisma-memory), как в остальных тестах
// изоляции. Поэтому файл лежит здесь, а не в __tests__/eta: модуль репозитория
// помечен server-only и подключается только с подменой из этого конфига.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import {
  getForecastByRoute,
  listForecastFacts,
  recordActual,
  saveForecast,
} from "@/lib/eta/repository"
import type { ForecastResult } from "@/lib/eta/forecast"
import { ETA_MODEL_VERSION } from "@/lib/eta/forecast"

const ORG = "org-test"
const ROUTE = "route-test"
const ORDER = "order-test"

/** Минимальный, но полноценный прогноз: движок строит ForecastResult. */
function forecast(arrivalAt: Date, totalSec = 3600): ForecastResult {
  return {
    modelVersion: ETA_MODEL_VERSION,
    timeZone: "UTC",
    departureAt: new Date(arrivalAt.getTime() - totalSec * 1000),
    scenarios: {
      optimistic: {
        arrivalAt: new Date(arrivalAt.getTime() - 600 * 1000),
        drivingSec: totalSec * 0.5,
        stopsSec: 0,
        restSec: 0,
        totalSec: totalSec - 600,
      },
      base: {
        arrivalAt,
        drivingSec: totalSec * 0.6,
        stopsSec: totalSec * 0.2,
        restSec: totalSec * 0.2,
        totalSec,
      },
      conservative: {
        arrivalAt: new Date(arrivalAt.getTime() + 900 * 1000),
        drivingSec: totalSec * 0.7,
        stopsSec: 0,
        restSec: 0,
        totalSec: totalSec + 900,
      },
    },
    segments: [],
    confidence: { score: 0.6, level: "medium", reasons: [] },
    violations: [],
    reliable: true,
    explanation: {},
  } as unknown as ForecastResult
}

/** Все версии прогноза по рейсу — в порядке создания. */
function rows(): Array<{
  id: string
  recalcCount: number
  createdAt: Date
  initialArrivalAt: Date
  currentArrivalAt: Date
  actualArrivalAt: Date | null
  errorMinutes: number | null
}> {
  return memoryDb
    .rows("etaForecast")
    .filter((row) => row.routeId === ROUTE) as ReturnType<typeof rows>
}

beforeEach(() => {
  memoryDb.reset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("история версий прогноза", () => {
  it("первый расчёт — версия 0, initial = current", async () => {
    const arrival = new Date("2026-10-20T10:00:00.000Z")
    await saveForecast({
      organizationId: ORG,
      routeId: ROUTE,
      orderId: ORDER,
      forecast: forecast(arrival),
    })

    const saved = rows()
    expect(saved).toHaveLength(1)
    expect(saved[0].recalcCount).toBe(0)
    expect(saved[0].initialArrivalAt.toISOString()).toBe(arrival.toISOString())
    expect(saved[0].currentArrivalAt.toISOString()).toBe(arrival.toISOString())
  })

  it("пересчёт — новая строка, счётчик растёт, исходное время не трогается", async () => {
    const first = new Date("2026-10-20T10:00:00.000Z")
    const second = new Date("2026-10-20T12:30:00.000Z")
    const third = new Date("2026-10-20T14:00:00.000Z")

    await saveForecast({ organizationId: ORG, routeId: ROUTE, forecast: forecast(first) })
    await saveForecast({ organizationId: ORG, routeId: ROUTE, forecast: forecast(second) })
    await saveForecast({ organizationId: ORG, routeId: ROUTE, forecast: forecast(third) })

    const saved = rows()
    // Три отдельные версии, а не одна перезаписанная строка
    expect(saved).toHaveLength(3)
    expect(saved.map((row) => row.recalcCount)).toEqual([0, 1, 2])

    // Исходный прогноз — у всех один и тот же, из самой первой версии
    for (const row of saved) {
      expect(row.initialArrivalAt.toISOString()).toBe(first.toISOString())
    }
    // Актуальное время — у каждой версии своё
    expect(saved[2].currentArrivalAt.toISOString()).toBe(third.toISOString())
  })

  it("две версии в одну миллисекунду не путаются: последняя остаётся последней", async () => {
    // «Пересчитать» можно нажать дважды подряд, и тогда createdAt совпадёт.
    // Раньше getForecastByRoute в этом случае мог отдать старую версию.
    const first = new Date("2026-10-20T10:00:00Z")
    const second = new Date("2026-10-20T11:00:00Z")
    const third = new Date("2026-10-20T12:00:00Z")

    await saveForecast({ organizationId: ORG, routeId: ROUTE, forecast: forecast(first) })
    const secondId = await saveForecast({ organizationId: ORG, routeId: ROUTE, forecast: forecast(second) })
    const thirdId = await saveForecast({ organizationId: ORG, routeId: ROUTE, forecast: forecast(third) })

    const created = rows().map((row) => row.createdAt)
    // Времена создания строго возрастают — иначе порядок версий не определён
    expect(created[1].getTime()).toBeGreaterThan(created[0].getTime())
    expect(created[2].getTime()).toBeGreaterThan(created[1].getTime())

    const latest = await getForecastByRoute(ROUTE, ORG)
    expect(latest?.id).toBe(thirdId)
    expect(secondId).not.toBe(thirdId)
  })

  it("getForecastByRoute отдаёт последнюю версию, а не первую", async () => {
    const first = new Date("2026-10-20T10:00:00.000Z")
    const second = new Date("2026-10-20T16:00:00.000Z")

    await saveForecast({ organizationId: ORG, routeId: ROUTE, forecast: forecast(first) })
    const latestId = await saveForecast({
      organizationId: ORG,
      routeId: ROUTE,
      forecast: forecast(second),
    })

    const latest = await getForecastByRoute(ROUTE, ORG)
    expect(latest?.id).toBe(latestId)
    expect(latest?.currentArrivalAt.toISOString()).toBe(second.toISOString())
    // …но исходный прогноз остался первым
    expect(latest?.initialArrivalAt.toISOString()).toBe(first.toISOString())
  })

  it("версии разных рейсов не смешиваются", async () => {
    const otherRoute = "route-other"
    await saveForecast({ organizationId: ORG, routeId: ROUTE, forecast: forecast(new Date("2026-10-20T10:00:00Z")) })
    await saveForecast({ organizationId: ORG, routeId: otherRoute, forecast: forecast(new Date("2026-10-20T11:00:00Z")) })
    await saveForecast({ organizationId: ORG, routeId: otherRoute, forecast: forecast(new Date("2026-10-20T12:00:00Z")) })

    // У route-test одна версия (0 пересчётов), у другого рейса — две (1 пересчёт)
    expect(rows()).toHaveLength(1)
    expect(rows()[0].recalcCount).toBe(0)
    const other = memoryDb.rows("etaForecast").filter((row) => row.routeId === otherRoute)
    expect(other).toHaveLength(2)
    expect(other.map((row) => row.recalcCount)).toEqual([0, 1])
  })

  it("версии разных моделей не смешиваются", async () => {
    const v1 = forecast(new Date("2026-10-20T10:00:00Z"))
    const v2 = forecast(new Date("2026-10-20T11:00:00Z"))
    v2.modelVersion = "eta-2.0.0-test"

    await saveForecast({ organizationId: ORG, routeId: ROUTE, forecast: v1 })
    await saveForecast({ organizationId: ORG, routeId: ROUTE, forecast: v2 })

    // Счётчик у второй модели начинается заново: это другой расчёт
    const saved = rows()
    expect(saved).toHaveLength(2)
    expect(saved.map((row) => row.recalcCount)).toEqual([0, 0])
  })

  it("предпросмотр без рейса и без заказа версий не заводит", async () => {
    await saveForecast({ organizationId: ORG, forecast: forecast(new Date("2026-10-20T10:00:00Z")) })
    await saveForecast({ organizationId: ORG, forecast: forecast(new Date("2026-10-20T11:00:00Z")) })

    const all = memoryDb.rows("etaForecast")
    expect(all).toHaveLength(2)
    for (const row of all) {
      expect(row.recalcCount).toBe(0)
    }
  })
})

describe("запись факта не перезаписывает прогноз", () => {
  it("факт пишется отдельно, исходный и актуальный прогноз целы", async () => {
    const planned = new Date("2026-10-20T10:00:00Z")
    const id = await saveForecast({
      organizationId: ORG,
      routeId: ROUTE,
      forecast: forecast(planned),
    })

    const actual = new Date("2026-10-20T10:45:00Z")
    const result = await recordActual(id, ORG, { actualArrivalAt: actual })

    expect(result.ok).toBe(true)
    if (result.ok === false) return
    expect(result.errorMinutes).toBe(45)

    const saved = rows()
    expect(saved).toHaveLength(1)
    // Прогноз не сдвинут фактом
    expect(saved[0].initialArrivalAt.toISOString()).toBe(planned.toISOString())
    expect(saved[0].currentArrivalAt.toISOString()).toBe(planned.toISOString())
    // Факт — отдельным полем
    expect(saved[0].actualArrivalAt?.toISOString()).toBe(actual.toISOString())
    expect(saved[0].errorMinutes).toBe(45)
  })

  it("ошибка считается от последней версии, а не от исходной", async () => {
    const first = new Date("2026-10-20T10:00:00Z")
    const second = new Date("2026-10-20T12:00:00Z")
    await saveForecast({ organizationId: ORG, routeId: ROUTE, forecast: forecast(first) })
    const latestId = await saveForecast({
      organizationId: ORG,
      routeId: ROUTE,
      forecast: forecast(second),
    })

    const actual = new Date("2026-10-20T12:30:00Z")
    const result = await recordActual(latestId, ORG, { actualArrivalAt: actual })

    expect(result.ok).toBe(true)
    if (result.ok === false) return
    // 30 минут опоздания относительно ПЕРЕСЧИТАННОГО прогноза
    expect(result.errorMinutes).toBe(30)
    // …а не 150 минут относительно исходного
  })

  it("чужой прогноз не обновляется", async () => {
    const id = await saveForecast({
      organizationId: "org-other",
      routeId: ROUTE,
      forecast: forecast(new Date("2026-10-20T10:00:00Z")),
    })

    const result = await recordActual(id, ORG, { actualArrivalAt: new Date("2026-10-20T11:00:00Z") })

    expect(result).toEqual({ ok: false, reason: "not_found" })
    const saved = rows()
    expect(saved).toHaveLength(1)
    // Факт не записан: ни даты, ни ошибки
    expect(saved[0].actualArrivalAt ?? null).toBeNull()
    expect(saved[0].errorMinutes ?? null).toBeNull()
  })

  it("факт виден в выборке для оценки точности, чужой организации — нет", async () => {
    const id = await saveForecast({
      organizationId: ORG,
      routeId: ROUTE,
      forecast: forecast(new Date("2026-10-20T10:00:00Z")),
    })
    await recordActual(id, ORG, { actualArrivalAt: new Date("2026-10-20T10:20:00Z") })

    const facts = await listForecastFacts(ORG)
    expect(facts).toHaveLength(1)
    // Прогноз и факт рядом: по ним и считается ошибка модели
    expect(facts[0].predictedAt.toISOString()).toBe("2026-10-20T10:00:00.000Z")
    expect(facts[0].actualAt.toISOString()).toBe("2026-10-20T10:20:00.000Z")

    // У чужой организации выборка пустая
    const foreign = await listForecastFacts("org-other")
    expect(foreign).toHaveLength(0)
  })
})
