// __tests__/eta/trip.test.ts
//
// Единый расчёт ETA рейса: временная шкала этапов.
//
// Проверяется то, чего не делала ни одна из прежних формул:
//   * рейс описывается последовательностью этапов, а не суммой оценок;
//   * завершённые этапы не пересчитываются как будущие;
//   * движение, операции и перерыв не смешиваются и не дублируются;
//   * возврат на базу считается отдельным плечом;
//   * прогноз по оставшейся части совпадает с цепочкой этапов.

import { describe, expect, it } from "vitest"

import {
  buildRouteStages,
  calculateTripEta,
  tripStopsSec,
  type TripStageInput,
} from "@/lib/eta/trip"
import type { Coordinates } from "@/lib/eta/types"

const TZ = "UTC"
const BASE: Coordinates = { lat: 55.7558, lng: 37.6173 }
const YAROSLAVL: Coordinates = { lat: 57.6261, lng: 39.8845 }
const VOLOGDA: Coordinates = { lat: 59.2205, lng: 39.8915 }
const NOW = new Date(Date.UTC(2026, 9, 15, 9, 0))

const KOSTROMA: Coordinates = { lat: 57.7679, lng: 40.9269 }

/**
 * Три заказа: Москва → Ярославль → Вологда → Кострома.
 * Рейс заканчивается НЕ на базе, поэтому возврат на базу — отдельное плечо.
 */
function orders() {
  return [
    { id: "o1", routeFrom: "Москва", routeTo: "Ярославль", from: BASE, to: YAROSLAVL, routeSequence: 1 },
    { id: "o2", routeFrom: "Ярославль", routeTo: "Вологда", from: YAROSLAVL, to: VOLOGDA, routeSequence: 2 },
    { id: "o3", routeFrom: "Вологда", routeTo: "Кострома", from: VOLOGDA, to: KOSTROMA, routeSequence: 3 },
  ]
}

describe("buildRouteStages — последовательность этапов", () => {
  it("рейс = погрузка, плечо, выгрузка на каждый заказ + возврат на базу", () => {
    const stages = buildRouteStages(orders(), {
      origin: { point: BASE, address: "Москва, база" },
      returnToBase: { point: BASE, address: "Москва, база" },
    })

    // 3 заказа × (погрузка + плечо + выгрузка) + возврат на базу.
    // Плечо «Москва → Ярославль» одно: погрузка №1 уже в Москве, лишнего
    // плеча до неё не появляется.
    const kinds = stages.map((stage) => stage.kind)
    expect(kinds).toEqual([
      "loading", // погрузка №1 (Москва)
      "driving", // Москва → Ярославль
      "unloading", // выгрузка №1
      "loading", // погрузка №2 (Ярославль)
      "driving", // Ярославль → Вологда
      "unloading", // выгрузка №2
      "loading", // погрузка №3 (Вологда)
      "driving", // Вологда → Кострома
      "unloading", // выгрузка №3
      "return_to_base", // Кострома → Москва
    ])
  })

  it("рейс, заканчивающийся на базе, лишнего плеча возврата не создаёт", () => {
    const atBase = orders().map((order) =>
      order.id === "o3" ? { ...order, routeTo: "Москва", to: BASE } : order,
    )
    const stages = buildRouteStages(atBase, {
      origin: { point: BASE },
      returnToBase: { point: BASE, address: "Москва, база" },
    })

    expect(stages[stages.length - 1].kind).toBe("unloading")
    expect(stages.some((stage) => stage.kind === "return_to_base")).toBe(false)
  })

  it("начальная точка, совпадающая с первой погрузкой, лишнего плеча не создаёт", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })

    const firstDriving = stages.find((stage) => stage.kind === "driving")
    expect(firstDriving?.from).toEqual(BASE)
    expect(firstDriving?.to).toEqual(YAROSLAVL)
    // Ни одного «плеча» нулевой длины
    expect(stages.every((stage) => stage.kind !== "driving" || stage.from !== stage.to)).toBe(true)
  })

  it("возврат на базу добавляется отдельным этапом", () => {
    const stages = buildRouteStages(orders(), { returnToBase: { point: BASE, address: "база" } })
    const last = stages[stages.length - 1]

    expect(last.kind).toBe("return_to_base")
    expect(last.to).toEqual(BASE)
    expect(last.address).toContain("база")
  })

  it("без возврата на базу рейс заканчивается выгрузкой", () => {
    const stages = buildRouteStages(orders())
    expect(stages[stages.length - 1].kind).toBe("unloading")
  })

  it("порядок заказов задаёт routeSequence, а не порядок массива", () => {
    const shuffled = [...orders()].reverse()
    const stages = buildRouteStages(shuffled)
    const firstLoading = stages.find((stage) => stage.kind === "loading")
    expect(firstLoading?.orderId).toBe("o1")

    const addresses = stages.filter((s) => s.kind === "unloading").map((s) => s.address)
    expect(addresses).toEqual(["Ярославль", "Вологда", "Кострома"])
  })

  it("заказ без координат не ломает сборку этапов", () => {
    const partial = [{ id: "x", routeFrom: "Тула", routeTo: "Орёл", routeSequence: 1 }]
    const stages = buildRouteStages(partial as never)
    expect(stages).toHaveLength(0)
  })
})

describe("calculateTripEta — прогноз по шкале этапов", () => {
  it("прогноз по оставшейся части совпадает с цепочкой этапов", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })
    const result = calculateTripEta(stages, { now: NOW, timeZone: TZ })

    const last = result.stages[result.stages.length - 1]
    expect(last.plannedEndAt).toBeDefined()
    expect(last.plannedEndAt!.getTime()).toBe(result.completionAt.getTime())
  })

  it("движение и операции не смешиваются", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })
    const result = calculateTripEta(stages, { now: NOW, timeZone: TZ })

    // Сумма движения по плечам = drivingSec движка
    const legsDriving = result.stages
      .filter((stage) => stage.segment)
      .reduce((sum, stage) => sum + (stage.segment?.drivingSec ?? 0), 0)

    expect(result.remaining.drivingSec).toBe(legsDriving)
    expect(result.remaining.stopsSec).toBeGreaterThan(0)
    expect(result.remaining.totalSec).toBe(
      result.remaining.drivingSec + result.remaining.stopsSec + result.remaining.restSec,
    )
  })

  it("следующая точка — первый незавершённый этап, с адресом и операцией", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })
    const result = calculateTripEta(stages, { now: NOW, timeZone: TZ })

    expect(result.nextStageIndex).toBe(0)
    expect(result.nextPoint).not.toBeNull()
    expect(result.nextPoint!.operation).toBe("loading")
    expect(result.nextPoint!.address).toBe("Москва")
    expect(result.nextPoint!.arrivalAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime())
  })

  it("завершённые этапы не пересчитываются как будущие", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })

    // Погрузка №1 и плечо до Ярославля уже сделаны
    stages[0].actualStartAt = new Date(Date.UTC(2026, 9, 15, 6, 0))
    stages[0].actualEndAt = new Date(Date.UTC(2026, 9, 15, 7, 30)) // 90 мин фактически
    stages[1].actualStartAt = new Date(Date.UTC(2026, 9, 15, 7, 30))
    stages[1].actualEndAt = new Date(Date.UTC(2026, 9, 15, 11, 0)) // 3.5 ч фактически

    const result = calculateTripEta(stages, { now: NOW, timeZone: TZ })

    expect(result.stages[0].completed).toBe(true)
    expect(result.stages[1].completed).toBe(true)
    expect(result.dataQuality.hasActuals).toBe(true)

    // Оставшееся время считается от «сейчас», а не от выезда
    expect(result.remaining.totalSec).toBeGreaterThan(0)
    expect(result.remaining.arrivalAt.getTime()).toBeGreaterThan(NOW.getTime())

    // Завершённые этапы не получили планового времени «в будущем»
    expect(result.stages[0].plannedStartAt).toBeUndefined()
    expect(result.stages[1].plannedStartAt).toBeUndefined()
  })

  it("фактическое время этапа идёт в часы, а не оценочное", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })
    stages[0].actualStartAt = new Date(Date.UTC(2026, 9, 15, 6, 0))
    stages[0].actualEndAt = new Date(Date.UTC(2026, 9, 15, 7, 30)) // 90 мин вместо оценки 75

    const result = calculateTripEta(stages, { now: NOW, timeZone: TZ })
    expect(result.stages[0].durationSec).toBe(90 * 60)
  })

  it("текущий этап (начат, не завершён) учитывает уже проведённое время", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })
    // Погрузка начата в 08:30, всё ещё идёт в 09:00
    stages[0].actualStartAt = new Date(Date.UTC(2026, 9, 15, 8, 30))

    const result = calculateTripEta(stages, { now: NOW, timeZone: TZ })

    expect(result.stages[0].current).toBe(true)
    expect(result.stages[0].completed).toBe(false)
    expect(result.currentStageIndex).toBe(0)
    // Следующая точка — та же операция, она ещё не закончена
    expect(result.nextPoint!.operation).toBe("loading")
  })

  it("возврат на базу считается отдельным плечом со своим временем", () => {
    const stages = buildRouteStages(orders(), {
      origin: { point: BASE },
      returnToBase: { point: BASE, address: "Москва, база" },
    })
    const result = calculateTripEta(stages, { now: NOW, timeZone: TZ })

    expect(result.returnToBase).not.toBeNull()
    expect(result.returnToBase!.drivingSec).toBeGreaterThan(0)
    // Возврат на базу — последнее плечо, поэтому завершение рейса = его конец
    expect(result.returnToBase!.arrivalAt.getTime()).toBe(result.completionAt.getTime())
    // И общее оставшееся время согласовано с движком (не «своя формула»)
    expect(result.totalRemainingSec).toBe(result.remaining.totalSec)
    // Плечо возврата реально входит в сумму движения
    const legsDriving = result.stages
      .filter((stage) => stage.segment)
      .reduce((sum, stage) => sum + (stage.segment?.drivingSec ?? 0), 0)
    expect(legsDriving).toBe(result.remaining.drivingSec)
    expect(legsDriving).toBeGreaterThanOrEqual(result.returnToBase!.drivingSec)
  })

  it("без возврата на базу завершение рейса = конец последней операции", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })
    const result = calculateTripEta(stages, { now: NOW, timeZone: TZ })

    expect(result.returnToBase).toBeNull()
    expect(result.completionAt.getTime()).toBe(result.remaining.arrivalAt.getTime())
  })

  it("три сценария упорядочены", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })
    const result = calculateTripEta(stages, { now: NOW, timeZone: TZ })

    expect(result.scenarios.optimistic.totalSec).toBeLessThanOrEqual(result.scenarios.base.totalSec)
    expect(result.scenarios.base.totalSec).toBeLessThanOrEqual(result.scenarios.conservative.totalSec)
  })

  it("уверенность и её причины объясняются, а не «магическое число»", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })
    const result = calculateTripEta(stages, { now: NOW, timeZone: TZ })

    expect(["high", "medium", "low"]).toContain(result.confidence.level)
    expect(result.confidence.reasons.length).toBeGreaterThan(0)
  })

  it("качество данных перечисляет, чего именно не хватает", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })
    const result = calculateTripEta(stages, { now: NOW, timeZone: TZ })

    expect(result.dataQuality.weatherAvailable).toBe(false)
    expect(result.dataQuality.warnings.some((w) => w.includes("погода"))).toBe(true)
    expect(result.sources.weather).toBe("unavailable")
  })

  it("машина из карточки поднимает уверенность и попадает в факторы", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })
    const withVehicle = calculateTripEta(stages, {
      now: NOW,
      timeZone: TZ,
      vehicle: { type: "truck", capacity: 20000, height: 3.2 },
    })

    expect(withVehicle.dataQuality.vehicleKnown).toBe(true)
    expect(withVehicle.factors.some((f) => f.kind === "vehicle")).toBe(true)
  })

  it("завершённый рейс: нечего прогнозировать, но и не падаем", () => {
    const stages: TripStageInput[] = [
      { kind: "loading", sequence: 0, actualStartAt: new Date(Date.UTC(2026, 9, 15, 6, 0)), actualEndAt: new Date(Date.UTC(2026, 9, 15, 7, 0)) },
      { kind: "unloading", sequence: 1, actualStartAt: new Date(Date.UTC(2026, 9, 15, 11, 0)), actualEndAt: new Date(Date.UTC(2026, 9, 15, 12, 0)) },
    ]
    const result = calculateTripEta(stages, { now: NOW, timeZone: TZ })

    expect(result.nextStageIndex).toBeNull()
    expect(result.nextPoint).toBeNull()
    expect(result.remaining.totalSec).toBe(0)
    expect(result.confidence.level).toBe("low")
    expect(result.dataQuality.warnings.some((w) => w.includes("завершён"))).toBe(true)
  })

  it("повторный расчёт с теми же данными даёт тот же результат", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })
    const first = calculateTripEta(stages, { now: NOW, timeZone: TZ })
    const second = calculateTripEta(stages, { now: NOW, timeZone: TZ })

    expect(second.completionAt.getTime()).toBe(first.completionAt.getTime())
    expect(second.remaining.totalSec).toBe(first.remaining.totalSec)
  })

  it("пустой список этапов не роняет расчёт", () => {
    const result = calculateTripEta([], { now: NOW, timeZone: TZ })
    expect(result.nextPoint).toBeNull()
    expect(result.remaining.totalSec).toBe(0)
    expect(result.dataQuality.warnings.length).toBeGreaterThan(0)
  })

  it("длинная операция сдвигает все последующие плечи", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })
    const quick = calculateTripEta(stages, { now: NOW, timeZone: TZ })

    // Та же выгрузка, но фактически 3 часа вместо оценки
    const slow = stages.map((stage) =>
      stage.kind === "unloading"
        ? { ...stage, stop: { kind: "unloading" as const, actualMinutes: 180 } }
        : stage,
    )
    const slowResult = calculateTripEta(slow, { now: NOW, timeZone: TZ })

    expect(slowResult.completionAt.getTime()).toBeGreaterThan(quick.completionAt.getTime())

    // Разница — как минимум разница операций (3 × 105 мин). Может быть чуть
    // больше: сдвинувшись на часы, рейс попадает в другие коэффициенты
    // часового трафика, и движок это учитывает. Своей поправки здесь нет.
    const diffMin = (slowResult.completionAt.getTime() - quick.completionAt.getTime()) / 60_000
    expect(diffMin).toBeGreaterThanOrEqual((180 - 75) * 3 - 1)
    expect(diffMin).toBeLessThan((180 - 75) * 3 + 60)
  })

  it("tripStopsSec считает операции отдельно от движения", () => {
    const stages = buildRouteStages(orders(), { origin: { point: BASE } })
    const result = calculateTripEta(stages, { now: NOW, timeZone: TZ })

    expect(tripStopsSec(result.stages)).toBe(result.remaining.stopsSec)
  })
})
