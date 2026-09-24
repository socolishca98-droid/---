// __tests__/isolation/route-optimizer.test.ts
//
// Сценарии рейса (POST /api/routes/optimizer) — задача 3, пункт 2.
//
// Главное, что здесь проверяется: цифры действительно приходят от сервиса
// маршрутизации (OSRM), а не выдумываются. Внешняя сеть подменена, поэтому
// в тесте видно, откуда взялось расстояние, и что «пробок» провайдер-заглушка
// не подмешивает (у нас TRAFFIC_PROVIDER=mock — и в ответе честно стоит
// traffic:"estimate", а не сгенерированные ДТП).
//
// Запуск: npm run test:isolation

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import { clearCache } from "@/lib/eta/cache"
import { cid, jsonOf, makeRequest, seedWorld, sessionCookie, type World } from "./helpers"

import { POST as optimizerPost } from "@/app/api/routes/optimizer/route"

// пауза между запросами к Nominatim (политика «не чаще 1 раза в секунду»)
process.env.GEOCODE_PAUSE_MS = "0"
// демо-провайдер пробок: сценарии обязаны игнорировать его выдумки
process.env.TRAFFIC_PROVIDER = "mock"
delete process.env.YANDEX_ROUTING_API_KEY

const GEO: Record<string, [number, number]> = {
  "москва, россия": [55.7558, 37.6173],
  "тула, россия": [54.1961, 37.6182],
  "казань, россия": [55.7963, 49.1088],
  "пермь, россия": [58.0105, 56.2502],
}

/** Расстояние и время, которые «отдаст» OSRM на любой маршрут. */
const OSRM_DISTANCE_M = 820_000
const OSRM_DURATION_S = 45_000

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

/** Подменяет сеть: Nominatim даёт координаты, OSRM — дорогу (или отказ). */
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
      const coordsPart = url.split("/route/v1/")[1]?.split("?")[0] || ""
      const count = coordsPart.split(";").length
      const legs = Array.from({ length: Math.max(1, count - 1) }, () => ({
        distance: OSRM_DISTANCE_M / Math.max(1, count - 1),
        duration: OSRM_DURATION_S / Math.max(1, count - 1),
        summary: "",
        steps: [],
      }))
      return jsonResponse({
        code: "Ok",
        routes: [{ distance: OSRM_DISTANCE_M, duration: OSRM_DURATION_S, geometry: "", legs }],
        waypoints: Array.from({ length: count }, (_, index) => ({
          name: `Точка ${index + 1}`,
          location: [0, 0],
          hint: "",
        })),
      })
    }

    return jsonResponse({})
  })
  vi.stubGlobal("fetch", fetchMock)
}

function seedOrder(slug: string, overrides: Record<string, unknown> = {}) {
  const id = cid(slug)
  memoryDb.insert("order", {
    id,
    organizationId: world.orgA,
    routeId: null,
    routeSequence: null,
    routeFrom: "Москва",
    routeTo: "Тула",
    status: "agreed",
    distance: 111,
    weight: 5000,
    price: 40000,
    cargoType: "Груз",
    clientContact: "",
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  })
  return id
}

async function callOptimizer(body: unknown, cookie: string | null) {
  const response = await optimizerPost(
    makeRequest("POST", "/api/routes/optimizer", { cookie, body }),
  )
  return { response, data: await jsonOf(response) }
}

beforeEach(async () => {
  world = seedWorld()
  // кэш ETA живёт 5 минут и общий на процесс: без сброса тест «OSRM упал»
  // получил бы результат, посчитанный предыдущим тестом
  clearCache()
  // заказ из seedWorld не должен попадать в расчёт по умолчанию
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

describe("сценарии рейса (POST /api/routes/optimizer)", () => {
  it("без сессии — 401, пустой список — 400", async () => {
    const anonymous = await callOptimizer({ orderIds: [world.orderA] }, null)
    expect(anonymous.response.status).toBe(401)

    const empty = await callOptimizer({ orderIds: [] }, cookieA)
    expect(empty.response.status).toBe(400)
  })

  it("чужой заказ — 404, и он не попадает в расчёт", async () => {
    const { response, data } = await callOptimizer({ orderIds: [world.orderB] }, cookieA)
    expect(response.status).toBe(404)
    expect(data.code).toBe("orders_not_found")
  })

  it("километры и время берутся у OSRM, а не из поля заказа", async () => {
    const orderId = seedOrder("opt1", { distance: 111 })

    const { response, data } = await callOptimizer({ orderIds: [orderId] }, cookieA)

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.variants).toHaveLength(3)

    const variant = data.variants[0]
    expect(variant.orderedOrderIds).toEqual([orderId])
    // 820 км — из ответа OSRM, хотя в заказе лежит 111 км
    expect(variant.metrics.distanceKm).toBe(820)
    expect(variant.sources.routing).toBe("osrm")
  })

  it("заглушка пробок не используется: в ответе честная оценка по времени суток", async () => {
    const orderId = seedOrder("opt2")
    const { data } = await callOptimizer({ orderIds: [orderId] }, cookieA)

    expect(data.sources.traffic).toBe("estimate")
    for (const variant of data.variants) {
      expect(variant.sources.traffic).toBe("estimate")
      expect(variant.sources.tolls).toBe("estimate")
      expect(variant.sources.trafficNote).toMatch(/оценка/i)
      // ни одного выдуманного ДТП/перекрытия в объяснениях
      expect(variant.why.join(" ")).not.toMatch(/ДТП|перекрыт/i)
    }
  })

  it("три сценария отличаются порядком точек и считают реальный пробег", async () => {
    const now = Date.now()
    // цепочка Москва → Тула → Казань → Пермь: перегонов без груза быть не должно
    const first = seedOrder("optA", {
      routeFrom: "Москва",
      routeTo: "Тула",
      distance: 180,
      price: 20000,
    })
    const second = seedOrder("optB", {
      routeFrom: "Тула",
      routeTo: "Казань",
      distance: 700,
      price: 90000,
    })
    const third = seedOrder("optC", {
      routeFrom: "Казань",
      routeTo: "Пермь",
      distance: 500,
      price: 30000,
      deadline: new Date(now + 4 * 3600 * 1000),
    })

    const { data } = await callOptimizer({ orderIds: [second, third, first] }, cookieA)

    expect(data.success).toBe(true)
    expect(data.variants).toHaveLength(3)

    for (const variant of data.variants) {
      expect([...variant.orderedOrderIds].sort()).toEqual([first, second, third].sort())
      // порядок непрерывный: выгрузка одного = погрузка следующего
      expect(variant.orderedOrderIds[0]).toBe(first)
      expect(variant.orderedOrderIds[1]).toBe(second)
      expect(variant.orderedOrderIds[2]).toBe(third)
      // точки схлопнуты: 4 уникальных города вместо 6 «погрузка/выгрузка»
      expect(variant.points.map((point: any) => point.city)).toEqual([
        "Москва",
        "Тула",
        "Казань",
        "Пермь",
      ])
      expect(variant.metrics.distanceKm).toBe(820)
      expect(variant.metrics.revenueRub).toBe(140000)
    }
  })

  it("город без координат — в списке проблем, а не выброшен молча", async () => {
    const ok = seedOrder("optOk")
    const unknown = seedOrder("optUnknown", { routeFrom: "Москва", routeTo: "Зажопинск" })

    const { response, data } = await callOptimizer({ orderIds: [ok, unknown] }, cookieA)

    expect(response.status).toBe(200)
    expect(data.problems).toContain("Зажопинск")
    expect(data.skipped).toBe(1)
    for (const variant of data.variants) {
      expect(variant.orderedOrderIds).toEqual([ok])
    }
  })

  it("если координат нет ни у кого — 422 без выдуманных цифр", async () => {
    const unknown = seedOrder("optNowhere", { routeFrom: "Москва", routeTo: "Зажопинск" })
    const { response, data } = await callOptimizer({ orderIds: [unknown] }, cookieA)

    expect(response.status).toBe(422)
    expect(data.code).toBe("no_coordinates")
    expect(data.variants).toBeUndefined()
  })

  it("OSRM недоступен — считаем по прямой и честно это помечаем", async () => {
    const orderId = seedOrder("optFallback")
    stubExternal({ osrmWorks: false })

    const { response, data } = await callOptimizer({ orderIds: [orderId] }, cookieA)

    expect(response.status).toBe(200)
    expect(data.sources.routing).toBe("fallback")
    expect(data.variants[0].sources.routing).toBe("fallback")
    expect(data.variants[0].why.join(" ")).toMatch(/по прямой/)
  })

  it("завершённые заказы в сценарии не берутся", async () => {
    const done = seedOrder("optDone", { status: "delivered" })
    const { response, data } = await callOptimizer({ orderIds: [done] }, cookieA)

    expect(response.status).toBe(400)
    expect(data.code).toBe("orders_final")
    // в сеть за координатами не ходили: считать нечего
    const geocodeCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("nominatim"),
    )
    expect(geocodeCalls).toHaveLength(0)
  })

  it("лишние заказы сверх лимита не считаются", async () => {
    const ids = Array.from({ length: 21 }, (_, index) => `order_${index}`)
    const { response, data } = await callOptimizer({ orderIds: ids }, cookieA)
    expect(response.status).toBe(400)
    expect(data.error).toMatch(/не больше/i)
  })
})
