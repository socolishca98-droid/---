// __tests__/isolation/route-map.test.ts
//
// Линия рейса на карте (GET /api/routes/[routeId]/map): один рейс — цветные
// сегменты по заказам.
//
// Внешние сервисы (Nominatim — координаты городов, OSRM — дорога) подменены:
// тест не ходит в сеть, но проверяет и удачный сценарий, и поведение при
// недоступном OSRM (тогда линия рисуется по прямой и помечается source:"line").
//
// Запуск: npm run test:isolation

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import {
  cid,
  jsonOf,
  makeRequest,
  routeContext,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers"

import { GET as routeMapGet } from "@/app/api/routes/[routeId]/map/route"

// пауза между запросами к Nominatim (политика «не чаще 1 раза в секунду») в тестах не нужна
process.env.GEOCODE_PAUSE_MS = "0"

/** Координаты, которые «вернёт» Nominatim. Ключ — адрес так, как его шлёт геокодер. */
const GEO: Record<string, [number, number]> = {
  "москва, россия": [55.7558, 37.6173],
  "казань, россия": [55.7963, 49.1088],
  "тула, россия": [54.1961, 37.6182],
}

/** Закодированная полилиния Москва → Казань (алгоритм Google polyline). */
const POLYLINE = "wxhsIccrdFc|F{lceA"

let world: World
let cookieA: string
let cookieB: string
let fetchMock: ReturnType<typeof vi.fn>

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

/** Подменяет сеть: Nominatim отдаёт координаты, OSRM — дорогу (или отказ). */
function stubExternal(options: { osrmWorks?: boolean } = {}) {
  const { osrmWorks = true } = options
  fetchMock = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input)

    if (url.includes("nominatim")) {
      const query = decodeURIComponent(new URL(url).searchParams.get("q") || "").toLowerCase()
      const hit = GEO[query]
      if (!hit) return jsonResponse([])
      return jsonResponse([{ lat: String(hit[0]), lon: String(hit[1]) }])
    }

    if (url.includes("/route/v1/")) {
      if (!osrmWorks) return jsonResponse({ code: "NoRoute", routes: [] })
      return jsonResponse({
        code: "Ok",
        routes: [{ distance: 820000, duration: 45000, geometry: POLYLINE, legs: [] }],
      })
    }

    return jsonResponse({})
  })
  vi.stubGlobal("fetch", fetchMock)
}

/** Сколько раз спрашивали координаты у Nominatim. */
function geocodeCalls(): number {
  return fetchMock.mock.calls.filter((call) => String(call[0]).includes("nominatim")).length
}

function seedRouteOrder(
  slug: string,
  overrides: Record<string, unknown> = {},
) {
  const id = cid(slug)
  memoryDb.insert("order", {
    id,
    organizationId: world.orgA,
    routeId: world.routeA,
    routeFrom: "Москва",
    routeTo: "Казань",
    status: "in_route",
    distance: 800,
    weight: 5000,
    price: 45000,
    cargoType: "Груз",
    clientContact: "",
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  })
  return id
}

async function callMap(routeId: string, cookie: string) {
  const response = await routeMapGet(
    makeRequest("GET", `/api/routes/${routeId}/map`, { cookie }),
    routeContext({ routeId }),
  )
  return { response, data: await jsonOf(response) }
}

beforeEach(async () => {
  world = seedWorld()
  // заказ из seedWorld уже привязан к рейсу А: отвязываем, чтобы каждый тест
  // сам решал, какие точки в рейсе
  const seeded = memoryDb.find("order", world.orderA)
  if (seeded) {
    seeded.routeId = null
    seeded.routeSequence = null
  }
  cookieA = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
  cookieB = await sessionCookie({ userId: world.adminB, role: "admin", kind: "staff" })
  stubExternal()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("линия рейса на карте (GET /api/routes/[routeId]/map)", () => {
  it("без сессии — 401, чужой рейс — 404", async () => {
    const anonymous = await routeMapGet(
      makeRequest("GET", `/api/routes/${world.routeA}/map`),
      routeContext({ routeId: world.routeA }),
    )
    expect(anonymous.status).toBe(401)

    const foreign = await callMap(world.routeB, cookieA)
    expect(foreign.response.status).toBe(404)
  })

  it("отдаёт по сегменту на заказ с дорогой и порядком точек", async () => {
    const first = seedRouteOrder("mapA1", { routeSequence: 1 })
    const second = seedRouteOrder("mapA2", {
      routeSequence: 2,
      routeFrom: "Казань",
      routeTo: "Тула",
    })

    const { response, data } = await callMap(world.routeA, cookieA)

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.segments).toHaveLength(2)

    const [segmentA, segmentB] = data.segments
    expect(segmentA.orderId).toBe(first)
    expect(segmentA.sequence).toBe(1)
    expect(segmentA.from).toBe("Москва")
    expect(segmentA.to).toBe("Казань")
    expect(segmentA.colorIndex).toBe(0)
    expect(segmentB.colorIndex).toBe(1)
    expect(segmentB.sequence).toBe(2)

    // дорогу отдал OSRM: расстояние — из ответа OSRM (820 км), а не из заказа
    expect(segmentA.source).toBe("osrm")
    expect(segmentA.distanceKm).toBe(820)
    expect(segmentA.durationMin).toBe(750)

    // полилиния раскодирована в координаты: начало — Москва
    expect(segmentA.geometry.length).toBeGreaterThanOrEqual(2)
    expect(segmentA.geometry[0][0]).toBeCloseTo(55.7558, 3)
    expect(segmentA.geometry[0][1]).toBeCloseTo(37.6173, 3)

    // рамка для карты покрывает нарисованные точки (OSRM в тесте всегда отдаёт
    // одну и ту же полилинию Москва — Казань, поэтому координаты такие)
    expect(data.bounds[0][0]).toBeCloseTo(55.7558, 3)
    expect(data.bounds[1][0]).toBeCloseTo(55.7963, 3)
    expect(data.bounds[0][1]).toBeCloseTo(37.6173, 3)
  })

  it("названия заказов не подменяются: статус приходит подписью канона", async () => {
    seedRouteOrder("mapStatus1", { routeSequence: 1, status: "control" })

    const { data } = await callMap(world.routeA, cookieA)
    expect(data.segments[0].status).toBe("control")
    expect(data.segments[0].statusLabel).toBe("На контроле")
  })

  it("если OSRM недоступен — прямая линия с пометкой line", async () => {
    seedRouteOrder("mapLine1", { routeSequence: 1 })
    stubExternal({ osrmWorks: false })

    const { data } = await callMap(world.routeA, cookieA)

    expect(data.segments).toHaveLength(1)
    expect(data.segments[0].source).toBe("line")
    // прямая — ровно две точки: откуда и куда
    expect(data.segments[0].geometry).toHaveLength(2)
    expect(data.segments[0].geometry[1][0]).toBeCloseTo(55.7963, 3)
    // расстояние остаётся из заказа, а не выдумывается
    expect(data.segments[0].distanceKm).toBe(800)
  })

  it("город без координат не выдумывается: сегмент без линии и список проблем", async () => {
    seedRouteOrder("mapNoGeo1", { routeSequence: 1, routeFrom: "Москва", routeTo: "Затерянный город" })

    const { data } = await callMap(world.routeA, cookieA)

    expect(data.segments).toHaveLength(1)
    expect(data.segments[0].source).toBe("none")
    expect(data.segments[0].geometry).toHaveLength(0)
    expect(data.problems).toContain("Затерянный город")
  })

  it("координаты кэшируются: второй запрос не идёт в Nominatim", async () => {
    seedRouteOrder("mapCache1", { routeSequence: 1 })

    await callMap(world.routeA, cookieA)
    const first = geocodeCalls()
    expect(first).toBeGreaterThan(0)
    // адрес попал в постоянный кэш
    expect(memoryDb.rows("geoCache").length).toBeGreaterThan(0)

    await callMap(world.routeA, cookieA)
    expect(geocodeCalls()).toBe(first)
  })

  it("в ответе нет чужих идентификаторов, рейс без точек — пустой список", async () => {
    const empty = await callMap(world.routeA, cookieA)
    expect(empty.data.segments).toEqual([])
    expect(empty.data.message).toBe("В рейсе нет точек")

    seedRouteOrder("mapNoLeak", { routeSequence: 1 })
    const { data } = await callMap(world.routeA, cookieA)
    const serialized = JSON.stringify(data)
    for (const id of world.foreignIds) {
      expect(serialized.includes(id)).toBe(false)
    }
  })
})
