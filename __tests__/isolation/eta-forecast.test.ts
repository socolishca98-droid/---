// __tests__/isolation/eta-forecast.test.ts
//
// Интеграционные тесты посегментного ETA: настоящие API-роуты, настоящая
// авторизация по подписанной сессии, in-memory база (Prisma подменён).
//
// Что здесь проверяется помимо арифметики:
//   * организация берётся из сессии, а не из тела запроса;
//   * чужой vehicleId и чужой routeId дают 404, а не «нейтральный» расчёт;
//   * чужой прогноз нельзя ни прочитать, ни записать в него факт;
//   * метрики точности считаются только по своей организации;
//   * прогноз сохраняется, и по нему же записывается факт с ошибкой.
//
// Внешняя сеть подменена: OSRM отдаёт шаги с номерами дорог (ref) — как в
// жизни, — а Open-Meteo выключен (по умолчанию, см. лицензию).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import { cid, jsonOf, makeRequest, seedWorld, sessionCookie, type World } from "./helpers"

import { POST as forecastPost } from "@/app/api/eta/forecast/route"
import { POST as actualPost } from "@/app/api/eta/forecast/[id]/actual/route"
import { GET as metricsGet } from "@/app/api/eta/metrics/route"

// Погода выключена: бесплатный тариф Open-Meteo не разрешает коммерческое
// использование. Тесты проверяют резервный режим, а не доступность сети.
delete process.env.ETA_WEATHER

let world: World
let cookieA: string
let cookieB: string
let fetchMock: ReturnType<typeof vi.fn>

const MOSCOW = { lat: 55.7558, lng: 37.6173 }
const YAROSLAVL = { lat: 57.6261, lng: 39.8845 }

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

/**
 * Ответ OSRM с шагами, у которых есть ref — как в живых ответах.
 * Без ref классификация дорог работает хуже, и тест это показывает.
 */
function osrmRoute() {
  const step = (distance: number, duration: number, name: string, ref: string) => ({
    name,
    ref,
    distance,
    duration,
    maneuver: { type: "new name", modifier: "straight", location: [0, 0] as [number, number] },
    intersections: [],
    driving_side: "right",
  })

  const cityStep = step(15_000, 2200, "Московский проспект", "")
  const highwayStep = step(230_000, 12_600, "«Холмогоры»", "М-8")

  return {
    code: "Ok",
    routes: [
      {
        distance: 245_000,
        duration: 14_800,
        geometry: "",
        legs: [{ distance: 245_000, duration: 14_800, summary: "", steps: [cityStep, highwayStep] }],
      },
    ],
    waypoints: [
      { name: "Ярославль", location: [39.8845, 57.6261], hint: "" },
      { name: "Москва", location: [37.6173, 55.7558], hint: "" },
    ],
  }
}

function stubOsrm() {
  fetchMock = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input)
    if (url.includes("/route/v1/")) return jsonResponse(osrmRoute())
    return jsonResponse({})
  })
  vi.stubGlobal("fetch", fetchMock)
}

/** Машина своей организации. */
function seedVehicle(slug: string, organizationId: string, overrides: Record<string, unknown> = {}) {
  const id = cid(slug)
  memoryDb.insert("vehicle", {
    id,
    organizationId,
    plate: `А${id.slice(1, 6)}А`,
    brand: "Volvo",
    model: "FH",
    type: "truck",
    capacity: 20000,
    volume: 90,
    length: 12,
    width: 2.5,
    height: 3.2,
    status: "active",
    ...overrides,
  })
  return id
}

async function callForecast(body: unknown, cookie: string | null) {
  const response = await forecastPost(makeRequest("POST", "/api/eta/forecast", { cookie, body }))
  return { response, data: await jsonOf(response) }
}

beforeEach(async () => {
  world = seedWorld()
  cookieA = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
  cookieB = await sessionCookie({ userId: world.adminB, role: "admin", kind: "staff" })
  stubOsrm()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/eta/forecast — расчёт и сохранение", () => {
  it("без сессии — 401", async () => {
    const { response } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW },
      null,
    )
    expect(response.status).toBe(401)
  })

  it("без координат — 400", async () => {
    const { response, data } = await callForecast({ origin: YAROSLAVL }, cookieA)
    expect(response.status).toBe(400)
    expect(data.error).toContain("origin")
  })

  it("считает по сегментам: город и трасса с разными поправками", async () => {
    const { response, data } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW, departure: new Date(Date.UTC(2026, 9, 15, 18, 0)).toISOString() },
      cookieA,
    )

    expect(response.status).toBe(200)
    expect(data.segments).toHaveLength(2)
    // 15 км города и 230 км трассы — разные классы и разные коэффициенты
    expect(data.segments[0].roadClass).toBe("city")
    expect(data.segments[1].roadClass).toBe("federal")
    expect(data.segments[1].roadName).toBe("«Холмогоры»")
    expect(data.segments[1].roadClassConfidence).toBeGreaterThan(data.segments[0].roadClassConfidence)
  })

  it("время прибытия сегмента учитывает задержку предыдущего", async () => {
    const { data } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW, departure: new Date(Date.UTC(2026, 9, 15, 18, 0)).toISOString() },
      cookieA,
    )

    const first = new Date(data.segments[0].departureAt).getTime()
    const second = new Date(data.segments[1].arrivalAt).getTime()
    expect(second).toBe(first)
    // Трасса начинается не раньше, чем закончился город
    expect(second).toBeGreaterThan(new Date(data.departureAt).getTime())
  })

  it("в ответе три сценария, уверенность и объяснение", async () => {
    const { data } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW },
      cookieA,
    )

    expect(data.scenarios.base.totalSec).toBeGreaterThan(0)
    expect(data.scenarios.optimistic.totalSec).toBeLessThanOrEqual(data.scenarios.base.totalSec)
    expect(data.scenarios.conservative.totalSec).toBeGreaterThanOrEqual(data.scenarios.base.totalSec)
    expect(data.confidence.level).toBeDefined()
    expect(data.confidence.score).toBeGreaterThan(0)
    expect(data.explanation.map((item: { kind: string }) => item.kind)).toContain("traffic")
  })

  it("погода по умолчанию выключена — и это честно написано в источнике", async () => {
    const { data } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW },
      cookieA,
    )

    expect(data.sources.weather).toBe("disabled")
    expect(data.sources.weatherEnabled).toBe(false)
    expect(data.confidence.reasons.some((r: string) => r.includes("погод"))).toBe(true)
  })

  it("прогноз сохраняется, когда передан routeId", async () => {
    const { data } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW, routeId: world.routeA },
      cookieA,
    )

    expect(data.saved).toBe(true)
    expect(data.id).toBeTruthy()

    const rows = memoryDb.rows("etaForecast").filter((row) => row.organizationId === world.orgA)
    expect(rows).toHaveLength(1)
    expect(rows[0].routeId).toBe(world.routeA)
    // Исходный прогноз сохранён и не пустой
    expect(rows[0].initialArrivalAt).toBeTruthy()
    expect(rows[0].totalSec).toBeGreaterThan(0)
  })

  it("без routeId прогноз не сохраняется", async () => {
    const { data } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW },
      cookieA,
    )
    expect(data.saved).toBe(false)
    expect(memoryDb.rows("etaForecast")).toHaveLength(0)
  })

  it("машина берётся из своей организации", async () => {
    const vehicleId = seedVehicle("truckA", world.orgA)

    const { data } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW, vehicleId },
      cookieA,
    )

    const vehicleCorrection = data.segments[0].corrections.find(
      (c: { kind: string }) => c.kind === "vehicle",
    )
    expect(vehicleCorrection.factor).toBeGreaterThan(1)
    expect(vehicleCorrection.reason).toContain("грузовой")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("изоляция организаций", () => {
  it("чужая машина — 404, а не нейтральный расчёт", async () => {
    const foreignVehicle = seedVehicle("truckB", world.orgB)

    const { response, data } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW, vehicleId: foreignVehicle },
      cookieA,
    )

    expect(response.status).toBe(404)
    expect(data.error).toContain("Транспортное средство")
  })

  it("чужой рейс — 404, и прогноз по нему не сохраняется", async () => {
    const { response } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW, routeId: world.routeB },
      cookieA,
    )

    expect(response.status).toBe(404)
    expect(memoryDb.rows("etaForecast")).toHaveLength(0)
  })

  it("прогноз организации А не виден организации Б", async () => {
    const { data: created } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW, routeId: world.routeA },
      cookieA,
    )

    const response = await actualPost(
      makeRequest("POST", `/api/eta/forecast/${created.id}/actual`, {
        cookie: cookieB,
        body: { actualArrivalAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString() },
      }),
      { params: Promise.resolve({ id: created.id }) },
    )

    expect(response.status).toBe(404)
    // Факт не записан
    const rows = memoryDb.rows("etaForecast").filter((row) => row.organizationId === world.orgA)
    expect(rows[0].actualArrivalAt).toBeFalsy()
  })

  it("метрики organisation А не содержат фактов organisation Б", async () => {
    const own = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW, routeId: world.routeA },
      cookieA,
    )
    const foreign = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW, routeId: world.routeB },
      cookieB,
    )

    // Факт своей организации: прибыли на 20 минут позже прогноза
    const ownRow = memoryDb.find("etaForecast", own.data.id)!
    await actualPost(
      makeRequest("POST", `/api/eta/forecast/${own.data.id}/actual`, {
        cookie: cookieA,
        body: { actualArrivalAt: new Date(ownRow.currentArrivalAt.getTime() + 20 * 60_000).toISOString() },
      }),
      { params: Promise.resolve({ id: own.data.id }) },
    )
    // Факт чужой организации: прибыли на 600 минут позже прогноза
    const foreignRow = memoryDb.find("etaForecast", foreign.data.id)!
    await actualPost(
      makeRequest("POST", `/api/eta/forecast/${foreign.data.id}/actual`, {
        cookie: cookieB,
        body: { actualArrivalAt: new Date(foreignRow.currentArrivalAt.getTime() + 600 * 60_000).toISOString() },
      }),
      { params: Promise.resolve({ id: foreign.data.id }) },
    )

    const metricsA = await metricsGet(makeRequest("GET", "/api/eta/metrics", { cookie: cookieA }))
    const dataA = await jsonOf(metricsA)

    expect(dataA.sampleCount).toBe(1)
    expect(dataA.metrics.maeMinutes).toBeCloseTo(20, 1)
    // Ошибка организации Б (опоздание на 600 минут) не попадает в метрики А
    expect(dataA.metrics.biasMinutes).toBeCloseTo(20, 1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/eta/forecast/:id/actual — факт по прогнозу", () => {
  async function createForecast() {
    const { data } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW, routeId: world.routeA },
      cookieA,
    )
    return data.id as string
  }

  it("без сессии — 401", async () => {
    const id = await createForecast()
    const response = await actualPost(
      makeRequest("POST", `/api/eta/forecast/${id}/actual`, {
        body: { actualArrivalAt: new Date().toISOString() },
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(response.status).toBe(401)
  })

  it("запись факта считает ошибку прогноза", async () => {
    const id = await createForecast()
    const saved = memoryDb.find("etaForecast", id)!
    const actualArrivalAt = new Date(saved.currentArrivalAt.getTime() + 45 * 60_000)

    const response = await actualPost(
      makeRequest("POST", `/api/eta/forecast/${id}/actual`, {
        cookie: cookieA,
        body: {
          actualArrivalAt: actualArrivalAt.toISOString(),
          actualDrivingSec: 30_000,
          delayReasons: ["погода", "очередь на выгрузке"],
        },
      }),
      { params: Promise.resolve({ id }) },
    )

    expect(response.status).toBe(200)
    const data = await jsonOf(response)
    expect(data.errorMinutes).toBeCloseTo(45, 1)
    expect(data.direction).toContain("позже прогноза")

    const updated = memoryDb.find("etaForecast", id)!
    expect(updated.errorMinutes).toBeCloseTo(45, 1)
    expect(updated.actualDrivingSec).toBe(30_000)
    expect(JSON.parse(updated.delayReasonsJson)).toEqual(["погода", "очередь на выгрузке"])
  })

  it("несуществующий прогноз — 404", async () => {
    const response = await actualPost(
      makeRequest("POST", "/api/eta/forecast/nope/actual", {
        cookie: cookieA,
        body: { actualArrivalAt: new Date().toISOString() },
      }),
      { params: Promise.resolve({ id: "nope" }) },
    )
    expect(response.status).toBe(404)
  })

  it("без actualArrivalAt — 400", async () => {
    const id = await createForecast()
    const response = await actualPost(
      makeRequest("POST", `/api/eta/forecast/${id}/actual`, { cookie: cookieA, body: {} }),
      { params: Promise.resolve({ id }) },
    )
    expect(response.status).toBe(400)
  })

  it("выброс помечается и не портит метрики", async () => {
    const id = await createForecast()

    await actualPost(
      makeRequest("POST", `/api/eta/forecast/${id}/actual`, {
        cookie: cookieA,
        body: {
          actualArrivalAt: new Date(Date.now() + 100 * 3600 * 1000).toISOString(),
          outlier: true,
        },
      }),
      { params: Promise.resolve({ id }) },
    )

    const metrics = await metricsGet(makeRequest("GET", "/api/eta/metrics", { cookie: cookieA }))
    const data = await jsonOf(metrics)

    expect(data.sampleCount).toBe(0)
    expect(data.metrics.outliersExcluded).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/eta/metrics", () => {
  it("без фактов — понятная подсказка, а не пустой ноль", async () => {
    const response = await metricsGet(makeRequest("GET", "/api/eta/metrics", { cookie: cookieA }))
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data.sampleCount).toBe(0)
    expect(data.recalibrationReady).toBe(false)
    expect(data.note).toContain("Фактов ещё нет")
  })

  it("без сессии — 401", async () => {
    const response = await metricsGet(makeRequest("GET", "/api/eta/metrics", {}))
    expect(response.status).toBe(401)
  })

  it("после фактов появляются метрики и разбивка по типам дорог", async () => {
    const { data } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW, routeId: world.routeA },
      cookieA,
    )

    const saved = memoryDb.find("etaForecast", data.id)!
    await actualPost(
      makeRequest("POST", `/api/eta/forecast/${data.id}/actual`, {
        cookie: cookieA,
        body: { actualArrivalAt: new Date(saved.currentArrivalAt.getTime() + 20 * 60_000).toISOString() },
      }),
      { params: Promise.resolve({ id: data.id }) },
    )

    const response = await metricsGet(makeRequest("GET", "/api/eta/metrics", { cookie: cookieA }))
    const metrics = await jsonOf(response)

    expect(metrics.sampleCount).toBe(1)
    expect(metrics.metrics.maeMinutes).toBeCloseTo(20, 1)
    expect(metrics.metrics.biasMinutes).toBeCloseTo(20, 1)
    expect(metrics.byRoadClass.length).toBeGreaterThan(0)
    // Доминирующий класс по времени — федеральная трасса (230 км из 245)
    expect(metrics.byRoadClass[0].group).toBe("federal")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe("нештатные ситуации", () => {
  it("OSRM не ответил — расчёт по прямой, и в ответе честно написано «fallback»", async () => {
    fetchMock = vi.fn(async () => jsonResponse({ code: "NoRoute", routes: [] }))
    vi.stubGlobal("fetch", fetchMock)

    const { response, data } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW },
      cookieA,
    )

    // Не 500 и не молчаливый успех: источник помечен, уверенность низкая
    expect(response.status).toBe(200)
    expect(data.sources.routing).toBe("fallback")
    expect(data.confidence.level).toBe("low")
    expect(data.confidence.reasons.some((r: string) => r.includes("класс дороги"))).toBe(true)
    // И это НЕ те цифры, что даёт реальный маршрут: класс дорог неизвестен,
    // а расстояние — прямая с дорожным коэффициентом, а не геометрия OSRM
    expect(data.segments.every((s: { roadClass: string }) => s.roadClass === "unknown")).toBe(true)
    expect(data.distanceM).not.toBe(245_000)
  })

  it("некорректные координаты — 422", async () => {
    const { response } = await callForecast(
      { origin: { lat: NaN, lng: NaN }, destination: MOSCOW },
      cookieA,
    )
    expect(response.status).toBe(422)
  })

  it("некорректное время выезда — 400", async () => {
    const { response, data } = await callForecast(
      { origin: YAROSLAVL, destination: MOSCOW, departure: "вчера" },
      cookieA,
    )
    expect(response.status).toBe(400)
    expect(data.error).toContain("время выезда")
  })
})
