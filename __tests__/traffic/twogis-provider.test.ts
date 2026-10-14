// __tests__/traffic/twogis-provider.test.ts
//
// Провайдер пробок 2ГИС: альтернатива Яндексу.
//
// Зачем он вообще есть: у Яндекса API Маршрутизации стоит от 120 000 ₽ в год
// (минимальный платёж за 1000 запросов в сутки), а у TomTom в таблице покрытия
// Traffic API России нет — расчёт маршрута есть, пробок нет. 2ГИС считает
// маршрут «с учётом пробок» (traffic_mode: "jam") и умеет базовый вариант по
// статистике ("stat"), поэтому разница двух запросов и есть величина пробок.
//
// Тесты проверяют форму запроса (POST + тело) и разбор ответа — без сети.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getRouteTraffic, resetRoutingKeyRejection } from "@/lib/traffic/service"

// lib/traffic работает с кортежами [широта, долгота]
const WAYPOINTS: Array<[number, number]> = [
  [55.7558, 37.6173],
  [54.1932, 37.6176],
]

type Captured = { url: string; init: RequestInit | undefined }

let captured: Captured[] = []
let responses: Array<{ ok: boolean; status: number; body: unknown }> = []

/** Ответ 2ГИС: набор вариантов маршрута. */
function okResponse(totalDuration: number, algorithm = "с учётом пробок") {
  return {
    ok: true,
    status: 200,
    body: {
      status: "OK",
      type: "result",
      result: [
        {
          id: "1",
          algorithm,
          total_distance: 185_000,
          total_duration: totalDuration,
        },
      ],
    },
  }
}

beforeEach(() => {
  captured = []
  responses = []
  resetRoutingKeyRejection()
  process.env.TRAFFIC_PROVIDER = "2gis"
  process.env.TWOGIS_API_KEY = "демо-ключ-2gis"

  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    captured.push({ url: String(input), init })
    const next = responses.shift() ?? okResponse(7200)
    return {
      ok: next.ok,
      status: next.status,
      text: async () => (typeof next.body === "string" ? next.body : JSON.stringify(next.body)),
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("2ГИС: форма запроса", () => {
  it("шлёт POST на /routing/7.0.0/global с ключом в query", async () => {
    responses = [okResponse(7200), okResponse(6600)]

    await getRouteTraffic({ routeId: "2gis-1", coordinates: WAYPOINTS })

    expect(captured.length).toBe(2)
    const { url, init } = captured[0]
    expect(url).toContain("routing.api.2gis.com/routing/7.0.0/global")
    expect(url).toContain("key=%D0%B4%D0%B5%D0%BC%D0%BE-%D0%BA%D0%BB%D1%8E%D1%87-2gis")
    expect(init?.method).toBe("POST")
  })

  it("тело содержит точки в порядке lon,lat и режим пробок jam", async () => {
    responses = [okResponse(7200), okResponse(6600)]

    await getRouteTraffic({ routeId: "2gis-2", coordinates: WAYPOINTS })

    const body = JSON.parse(String(captured[0].init?.body))
    expect(body.points).toEqual([
      { type: "stop", lon: 37.6173, lat: 55.7558 },
      { type: "stop", lon: 37.6176, lat: 54.1932 },
    ])
    expect(body.transport).toBe("driving")
    expect(body.route_mode).toBe("fastest")
    expect(body.traffic_mode).toBe("jam")
    expect(body.locale).toBe("ru")
  })

  it("базовый запрос без пробок уходит с traffic_mode=stat", async () => {
    responses = [okResponse(7200), okResponse(6600)]

    await getRouteTraffic({ routeId: "2gis-3", coordinates: WAYPOINTS })

    const base = JSON.parse(String(captured[1].init?.body))
    expect(base.traffic_mode).toBe("stat")
  })
})

describe("2ГИС: разбор ответа", () => {
  it("считает добавленные пробки из разницы «jam» и «stat»", async () => {
    // 7200 с с пробками, 6600 с без → +600 с = 10 мин, ratio 1.09
    responses = [okResponse(7200), okResponse(6600)]

    const result = await getRouteTraffic({ routeId: "2gis-4", coordinates: WAYPOINTS })

    expect(result.provider).toBe("2gis")
    expect(result.summary?.delayMin).toBe(10)
    expect(result.summary?.ratio).toBe(1.091)
    expect(result.segments.length).toBeGreaterThan(0)
    expect(result.mock).toBeUndefined()
  })

  it("берёт первый вариант маршрута из набора", async () => {
    responses = [
      {
        ok: true,
        status: 200,
        body: {
          status: "OK",
          type: "result",
          result: [
            { id: "1", total_duration: 7200 },
            { id: "2", total_duration: 8100 },
          ],
        },
      },
      okResponse(6600),
    ]

    const result = await getRouteTraffic({ routeId: "2gis-5", coordinates: WAYPOINTS })

    expect(result.summary?.delayMin).toBe(10)
  })

  it("пропускает варианты без total_duration", async () => {
    responses = [
      {
        ok: true,
        status: 200,
        body: {
          status: "OK",
          type: "result",
          result: [{ id: "1" }, { id: "2", total_duration: 5400 }],
        },
      },
      okResponse(6600),
    ]

    const result = await getRouteTraffic({ routeId: "2gis-6", coordinates: WAYPOINTS })

    // 5400 < 6600 → пробок нет, задержка 0
    expect(result.summary?.delayMin).toBe(0)
  })

  it("ошибка расчёта (type=error) пробрасывается понятным текстом", async () => {
    responses = [
      { ok: true, status: 200, body: { status: "FAIL", type: "error", message: "Route not found" } },
      okResponse(6600),
    ]

    await expect(
      getRouteTraffic({ routeId: "2gis-7", coordinates: WAYPOINTS }),
    ).rejects.toThrow(/Route not found/)
  })

  it("пустой результат — ошибка, а не молчаливый ноль", async () => {
    responses = [{ ok: true, status: 200, body: { status: "OK", type: "result", result: [] } }]

    await expect(
      getRouteTraffic({ routeId: "2gis-8", coordinates: WAYPOINTS }),
    ).rejects.toThrow(/duration not found/)
  })
})

describe("2ГИС: защита от мёртвого ключа", () => {
  it("без ключа в сеть не ходит вовсе", async () => {
    delete process.env.TWOGIS_API_KEY

    await expect(
      getRouteTraffic({ routeId: "2gis-9", coordinates: WAYPOINTS }),
    ).rejects.toThrow(/TWOGIS_API_KEY is not set/)

    expect(captured.length).toBe(0)
  })

  it("реальный формат отказа 2ГИС {type:forbidden,message:invalid_key} тоже ловится", async () => {
    responses = [{ ok: false, status: 403, body: { type: "forbidden", message: "invalid_key" } }]

    await expect(
      getRouteTraffic({ routeId: "2gis-real-error", coordinates: WAYPOINTS }),
    ).rejects.toThrow(/Ключ 2ГИС отклонён/)

    // Два запроса ушли параллельно («jam» и «stat») — и оба получили отказ
    expect(captured.length).toBe(2)
  })

  it("отказ по ключу запоминается: второй вызов в сеть не идёт", async () => {
    responses = [
      { ok: false, status: 403, body: { message: "Invalid key" } },
      { ok: false, status: 403, body: { message: "Invalid key" } },
    ]

    await expect(
      getRouteTraffic({ routeId: "2gis-10", coordinates: WAYPOINTS }),
    ).rejects.toThrow(/Ключ 2ГИС отклонён/)

    const callsAfterFirst = captured.length

    await expect(
      getRouteTraffic({ routeId: "2gis-11", coordinates: WAYPOINTS }),
    ).rejects.toThrow(/Ключ 2ГИС отклонён/)

    expect(captured.length).toBe(callsAfterFirst)
  })

  it("после сброса ключ проверяется заново", async () => {
    responses = [{ ok: false, status: 403, body: { message: "Invalid key" } }]

    await expect(
      getRouteTraffic({ routeId: "2gis-12", coordinates: WAYPOINTS }),
    ).rejects.toThrow(/Ключ 2ГИС отклонён/)

    resetRoutingKeyRejection()
    responses = [okResponse(7200), okResponse(6600)]

    const result = await getRouteTraffic({ routeId: "2gis-13", coordinates: WAYPOINTS })

    expect(result.summary?.delayMin).toBe(10)
  })
})
