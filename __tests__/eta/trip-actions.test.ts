import { describe, expect, it } from "vitest"

import { availableTripActions, checkTripCommand } from "@/lib/eta/trip-actions"
import { calculateTripEta, buildRouteStages, type TripStageInput } from "@/lib/eta/trip"

const NOW = new Date(Date.UTC(2026, 9, 15, 10, 0, 0))

/** Точка операции: плоские координаты (TripStageInput.point / from / to). */
function at(lat: number, lng: number) {
  return { lat, lng }
}

/** Точка отправления/возврата рейса: { point, address }. */
function point(address: string, lat: number, lng: number) {
  return { point: { lat, lng }, address }
}

/** Погрузка в Ярославле, выгрузка в Москве — рейс из одной точки. */
function singleOrderTrip(): TripStageInput[] {
  return buildRouteStages(
    [
      {
        id: "o1",
        routeFrom: "Ярославль",
        routeTo: "Москва",
        from: at(57.6, 39.85),
        to: at(55.75, 37.62),
        routeSequence: 1,
      },
    ],
    { origin: point("База Ярославль", 57.62, 39.89) },
  )
}

function trip() {
  return calculateTripEta(singleOrderTrip(), {
    now: NOW,
    vehicle: { type: "truck" },
    // Перерыв не мешает проверкам команд
    restRules: { maxDrivingMinutes: 100000 },
  })
}

describe("1. Доступные действия по этапам рейса", () => {
  it("рейс не начат — только «начать рейс» и «сообщить о проблеме»", () => {
    const state = availableTripActions(trip(), false)
    expect(state.available.map((a) => a.command)).toEqual(["start_trip", "report_problem"])
    expect(state.blocked).toEqual([
      { command: "start_driving", reason: "Сначала начните рейс" },
    ])
  })

  it("не начавшийся рейс не даёт отмечать прибытие", () => {
    const result = checkTripCommand(trip(), false, "arrive_point")
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("Рейс не начат")
  })

  it("начатый рейс: первая кнопка — «начать движение»", () => {
    const state = availableTripActions(trip(), true)
    expect(state.available.map((a) => a.command)).toEqual(["start_driving", "report_problem"])
    expect(state.available[0].primary).toBe(true)
    expect(state.blocked.some((b) => b.command === "arrive_point")).toBe(true)
  })

  it("движение начато — вместо него «прибыл»", () => {
    const stages = singleOrderTrip()
    stages[0].actualStartAt = NOW
    const state = availableTripActions(
      calculateTripEta(stages, { now: NOW, restRules: { maxDrivingMinutes: 100000 } }),
      true,
    )
    expect(state.available.map((a) => a.command)).toEqual(["arrive_point", "report_problem"])
    expect(state.blocked.some((b) => b.command === "start_driving")).toBe(false)
  })

  it("на операции показывается «начать погрузку»", () => {
    const stages = singleOrderTrip()
    stages[0].actualStartAt = NOW
    stages[0].actualEndAt = new Date(NOW.getTime() + 5 * 60_000)
    const state = availableTripActions(
      calculateTripEta(stages, { now: NOW, restRules: { maxDrivingMinutes: 100000 } }),
      true,
    )
    expect(state.currentStageIndex).toBe(1)
    expect(state.available.map((a) => a.label)).toContain("Начать погрузку")
  })

  it("операция начата — «завершить операцию» вместо «начать»", () => {
    const stages = singleOrderTrip()
    stages[0].actualStartAt = NOW
    stages[0].actualEndAt = new Date(NOW.getTime() + 5 * 60_000)
    stages[1].actualStartAt = new Date(NOW.getTime() + 6 * 60_000)
    const state = availableTripActions(
      calculateTripEta(stages, { now: NOW, restRules: { maxDrivingMinutes: 100000 } }),
      true,
    )
    expect(state.available.map((a) => a.label)).toContain("Погрузка завершена")
    expect(state.blocked).toEqual([])
  })

  it("все этапы закрыты — доступно только «завершить рейс»", () => {
    const stages = singleOrderTrip()
    for (const stage of stages) {
      stage.actualStartAt = new Date(NOW.getTime() - 60 * 60_000)
      stage.actualEndAt = new Date(NOW.getTime() - 30 * 60_000)
    }
    const state = availableTripActions(
      calculateTripEta(stages, { now: NOW, restRules: { maxDrivingMinutes: 100000 } }),
      true,
    )
    expect(state.finished).toBe(true)
    expect(state.available.map((a) => a.command)).toEqual(["finish_trip", "report_problem"])
  })
})

describe("2. Серверная проверка команд", () => {
  it("двойное «начать движение» отклоняется", () => {
    const stages = singleOrderTrip()
    stages[0].actualStartAt = NOW
    const result = checkTripCommand(
      calculateTripEta(stages, { now: NOW, restRules: { maxDrivingMinutes: 100000 } }),
      true,
      "start_driving",
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("уже начато")
  })

  it("двойное «прибыл» отклоняется", () => {
    const stages = singleOrderTrip()
    stages[0].actualStartAt = NOW
    stages[0].actualEndAt = new Date(NOW.getTime() + 5 * 60_000)
    const result = checkTripCommand(
      calculateTripEta(stages, { now: NOW, restRules: { maxDrivingMinutes: 100000 } }),
      true,
      "arrive_point",
    )
    expect(result.ok).toBe(false)
  })

  it("«прибыл» без начатого движения отклоняется", () => {
    const result = checkTripCommand(trip(), true, "arrive_point")
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("Движение не начато")
  })

  it("«завершить операцию» без её начала отклоняется", () => {
    const stages = singleOrderTrip()
    stages[0].actualStartAt = NOW
    stages[0].actualEndAt = new Date(NOW.getTime() + 5 * 60_000)
    const result = checkTripCommand(
      calculateTripEta(stages, { now: NOW, restRules: { maxDrivingMinutes: 100000 } }),
      true,
      "finish_operation",
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("не начата")
  })

  it("команда на чужой этап отклоняется — точки нельзя пропускать", () => {
    const stages = singleOrderTrip()
    stages[0].actualStartAt = NOW
    stages[0].actualEndAt = new Date(NOW.getTime() + 5 * 60_000)
    // Этап 2 — плечо до Москвы, он ещё НЕ текущий
    const result = checkTripCommand(
      calculateTripEta(stages, { now: NOW, restRules: { maxDrivingMinutes: 100000 } }),
      true,
      "start_driving",
      2,
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("не является текущим")
  })

  it("«завершить рейс» с незакрытыми этапами отклоняется", () => {
    const result = checkTripCommand(trip(), true, "finish_trip")
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("незавершённые этапы")
  })

  it("«завершить рейс» без этапов — разрешён", () => {
    const stages = singleOrderTrip()
    for (const stage of stages) {
      stage.actualStartAt = new Date(NOW.getTime() - 60 * 60_000)
      stage.actualEndAt = new Date(NOW.getTime() - 30 * 60_000)
    }
    const result = checkTripCommand(
      calculateTripEta(stages, { now: NOW, restRules: { maxDrivingMinutes: 100000 } }),
      true,
      "finish_trip",
    )
    expect(result.ok).toBe(true)
  })

  it("«сообщить о проблеме» работает на любом этапе начавшегося рейса", () => {
    const result = checkTripCommand(trip(), true, "report_problem")
    expect(result.ok).toBe(true)
  })

  it("«возвращение на базу» недоступно, если в рейсе его нет", () => {
    const result = checkTripCommand(trip(), true, "return_to_base")
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("В рейсе нет возврата на базу")
  })

  it("«возвращение на базу» недоступно, пока не выполнены точки", () => {
    // Рейс с возвратом: пока точки не закрыты, команда на последнем плече
    // недействительна
    const stages = buildRouteStages(
      [
        {
          id: "o1",
          routeFrom: "Ярославль",
          routeTo: "Москва",
          from: at(57.6, 39.85),
          to: at(55.75, 37.62),
          routeSequence: 1,
        },
      ],
      {
        origin: point("База", 57.62, 39.89),
        returnToBase: point("База", 57.62, 39.89),
      },
    )
    const result = checkTripCommand(
      calculateTripEta(stages, { now: NOW, restRules: { maxDrivingMinutes: 100000 } }),
      true,
      "return_to_base",
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("после выполнения всех точек")
  })

  it("«возвращение на базу» доступно на последнем плече", () => {
    const stages = buildRouteStages(
      [
        {
          id: "o1",
          routeFrom: "Ярославль",
          routeTo: "Москва",
          from: at(57.6, 39.85),
          to: at(55.75, 37.62),
          routeSequence: 1,
        },
      ],
      {
        origin: point("База", 57.62, 39.89),
        returnToBase: point("База", 57.62, 39.89),
      },
    )
    for (const stage of stages.slice(0, -1)) {
      stage.actualStartAt = new Date(NOW.getTime() - 60 * 60_000)
      stage.actualEndAt = new Date(NOW.getTime() - 30 * 60_000)
    }
    const result = checkTripCommand(
      calculateTripEta(stages, { now: NOW, restRules: { maxDrivingMinutes: 100000 } }),
      true,
      "return_to_base",
    )
    expect(result.ok).toBe(true)
  })
})

describe("3. Показанная кнопка не может быть отклонена", () => {
  it("каждая доступная команда проходит проверку на том же состоянии рейса", () => {
    // Рейс не начат
    const t1 = trip()
    for (const action of availableTripActions(t1, false).available) {
      expect(checkTripCommand(t1, false, action.command).ok).toBe(true)
    }

    // Рейс начат, движение не начато
    const t2 = trip()
    for (const action of availableTripActions(t2, true).available) {
      expect(checkTripCommand(t2, true, action.command).ok).toBe(true)
    }

    // Движение начато
    const stages3 = singleOrderTrip()
    stages3[0].actualStartAt = NOW
    const t3 = calculateTripEta(stages3, { now: NOW, restRules: { maxDrivingMinutes: 100000 } })
    for (const action of availableTripActions(t3, true).available) {
      expect(checkTripCommand(t3, true, action.command).ok).toBe(true)
    }

    // Операция начата
    const stages4 = singleOrderTrip()
    stages4[0].actualStartAt = NOW
    stages4[0].actualEndAt = new Date(NOW.getTime() + 5 * 60_000)
    stages4[1].actualStartAt = new Date(NOW.getTime() + 6 * 60_000)
    const t4 = calculateTripEta(stages4, { now: NOW, restRules: { maxDrivingMinutes: 100000 } })
    for (const action of availableTripActions(t4, true).available) {
      expect(checkTripCommand(t4, true, action.command).ok).toBe(true)
    }
  })
})
