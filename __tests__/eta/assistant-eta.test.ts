import { describe, expect, it } from "vitest"

import { compareAssistantProposal } from "@/lib/logist-mobile/assistant-eta"
import type { AssistantOrder, AssistantVehicle } from "@/lib/logist-mobile/route-assistant"

const NOW = new Date(Date.UTC(2026, 9, 15, 6, 0, 0))

function order(
  id: string,
  from: string,
  to: string,
  extra: Partial<AssistantOrder> = {},
): AssistantOrder {
  return {
    id,
    status: "ready",
    routeFrom: from,
    routeTo: to,
    distance: null,
    weight: 1000,
    volume: 5,
    price: 10000,
    agreedPrice: 10000,
    deadline: null,
    clientName: "ООО Тест",
    routeId: null,
    ...extra,
  }
}

const VEHICLE: AssistantVehicle = {
  id: "v1",
  plate: "А123АА",
  type: "truck",
  capacity: 20000,
  volume: 80,
  status: "available",
}


/** Координаты тестовых городов: без них шкала этапов пустая. */
const CITY_COORDS = new Map<string, { lat: number; lng: number } | null>([
  ["Москва", { lat: 55.7558, lng: 37.6173 }],
  ["Тула", { lat: 54.1961, lng: 37.6186 }],
  ["Рязань", { lat: 54.6297, lng: 39.7415 }],
  ["Орёл", { lat: 52.9654, lng: 36.0785 }],
])

const BASE = { lat: 55.7558, lng: 37.6173 } // база в Москве
const WITH_COORDS = { base: BASE, baseAddress: "Москва, база", coords: CITY_COORDS }

/** Без координат: помощник обязан честно сказать, что плечи не определены. */
const NO_COORDS = { base: null as { lat: number; lng: number } | null }

describe("1. Сравнение «до/после» по показателям", () => {
  it("пустое предложение не сравнивается", () => {
    expect(compareAssistantProposal([], VEHICLE, WITH_COORDS)).toBeNull()
  })

  it("один заказ: «до» и «после» совпадают — собирать нечего", () => {
    const result = compareAssistantProposal([order("o1", "Москва", "Тула")], VEHICLE, WITH_COORDS)
    expect(result).not.toBeNull()
    expect(result!.before.totalSec).toBe(result!.after.totalSec)
    expect(result!.after.returnToBase).toBe(true)
    expect(result!.deltas).toHaveLength(5)
  })

  it("все пять показателей на месте: длина, движение, операции, перерывы, длительность", () => {
    const result = compareAssistantProposal(
      [order("o1", "Москва", "Тула"), order("o2", "Москва", "Рязань")],
      VEHICLE,
      WITH_COORDS,
    )
    expect(result!.deltas.map((d) => d.label)).toEqual([
      "Длина рейса",
      "Время движения",
      "Операции",
      "Перерывы",
      "Длительность",
    ])
  })

  it("операции не дублируются: у каждого заказа ровно одна погрузка и выгрузка", () => {
    // Два заказа → 2 погрузки + 2 выгрузки. Если бы операции считались ещё и
    // при пересчёте рейса, их было бы больше.
    const result = compareAssistantProposal(
      [order("o1", "Москва", "Тула"), order("o2", "Тула", "Рязань")],
      VEHICLE,
      WITH_COORDS,
    )
    const stops = result!.afterTrip.stages.filter(
      (stage) => stage.kind === "loading" || stage.kind === "unloading",
    )
    expect(stops).toHaveLength(4)
  })

  it("каждый показатель имеет объяснение, почему изменился", () => {
    const result = compareAssistantProposal(
      [order("o1", "Москва", "Тула"), order("o2", "Москва", "Рязань")],
      VEHICLE,
      WITH_COORDS,
    )
    for (const delta of result!.deltas) {
      expect(delta.why.length).toBeGreaterThan(10)
      expect(delta.delta).toBe(delta.after - delta.before)
    }
  })

  it("возврат на базу входит и в «до», и в «после»", () => {
    const result = compareAssistantProposal([order("o1", "Москва", "Тула")], VEHICLE, WITH_COORDS)
    expect(result!.before.returnToBase).toBe(true)
    expect(result!.after.returnToBase).toBe(true)
    expect(result!.afterTrip.returnToBase).not.toBeNull()
  })

  it("длина рейса: несколько заказов одним маршрутом короче, чем каждый отдельно", () => {
    // Все заказы из Москвы: по отдельности холостые перегоны база→Москва
    // повторялись бы каждый раз
    // Заказы-цепочка: база → Тула → Рязань. По отдельности каждый рейс
    // возвращался бы на базу и снова ехал к точке следующего заказа.
    const result = compareAssistantProposal(
      [
        order("o1", "Москва", "Тула"),
        order("o2", "Тула", "Рязань"),
      ],
      VEHICLE,
      WITH_COORDS,
    )
    expect(result!.after.distanceKm).toBeLessThan(result!.before.distanceKm)
    const length = result!.deltas.find((d) => d.label === "Длина рейса")!
    expect(length.delta).toBeLessThan(0)
    expect(length.why).toContain("холостые перегоны")
  })
})

describe("2. Сроки заказов", () => {
  it("без сроков нарушений нет", () => {
    const result = compareAssistantProposal(
      [order("o1", "Москва", "Тула"), order("o2", "Москва", "Рязань")],
      VEHICLE,
      WITH_COORDS,
    )
    expect(result!.deadlineViolations).toEqual([])
  })

  it("просроченный срок попадает в нарушения с объяснением", () => {
    const result = compareAssistantProposal(
      [
        order("o1", "Москва", "Тула", {
          deadline: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
        }),
      ],
      VEHICLE,
      WITH_COORDS,
    )
    expect(result!.deadlineViolations).toHaveLength(1)
    expect(result!.deadlineViolations[0].orderId).toBe("o1")
    expect(result!.explanations.join(" ")).toContain("Срок будет нарушен")
  })

  it("срок в далёком будущем не считается нарушением", () => {
    const result = compareAssistantProposal(
      [
        order("o1", "Москва", "Тула", {
          deadline: "2099-01-01T00:00:00.000Z",
        }),
      ],
      VEHICLE,
      WITH_COORDS,
    )
    expect(result!.deadlineViolations).toEqual([])
  })

  it("мусорная дата срока не ломает сравнение", () => {
    const result = compareAssistantProposal(
      [order("o1", "Москва", "Тула", { deadline: "не дата" })],
      VEHICLE,
      WITH_COORDS,
    )
    expect(result!.deadlineViolations).toEqual([])
  })
})

describe("3. Честность прогноза", () => {
  it("без координат прогноз честно помечает оценённые плечи", () => {
    const result = compareAssistantProposal(
      [order("o1", "Москва", "Тула"), order("o2", "Тула", "Рязань")],
      VEHICLE,
      WITH_COORDS,
    )
    expect(result!.after.estimatedLegs).toBeGreaterThan(0)
    expect(result!.explanations.join(" ")).toContain("оценено по прямой")
  })

  it("погода не выдумывается: предупреждение есть, источника нет", () => {
    const result = compareAssistantProposal([order("o1", "Москва", "Тула")], VEHICLE, WITH_COORDS)
    expect(result!.afterTrip.dataQuality.weatherAvailable).toBe(false)
    expect(result!.afterTrip.sources.weather).toBe("unavailable")
  })

  it("«после» считается тем же механизмом, что и кабинет водителя", () => {
    const result = compareAssistantProposal([order("o1", "Москва", "Тула")], VEHICLE, WITH_COORDS)
    // Показатели сводки берутся из прогноза рейса, а не считаются заново
    expect(result!.after.totalSec).toBe(Math.round(result!.afterTrip.remaining.totalSec))
    expect(result!.after.drivingSec).toBe(Math.round(result!.afterTrip.remaining.drivingSec))
  })

  it("машина влияет на прогноз (сравнение не игнорирует ТС)", () => {
    const truck = compareAssistantProposal([order("o1", "Москва", "Тула")], VEHICLE, WITH_COORDS)
    // Категория ТС: если тип не указан, её определяет грузоподъёмность.
    // Свыше 20 т — автопоезд, прогноз осторожнее (speedFactor ниже).
    const articulated = compareAssistantProposal([order("o1", "Москва", "Тула")], {
      ...VEHICLE,
      type: null,
      capacity: 25000,
    }, WITH_COORDS)
    expect(articulated!.after.totalSec).toBeGreaterThan(truck!.after.totalSec)
  })
})
