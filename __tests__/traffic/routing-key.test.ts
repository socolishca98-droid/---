// __tests__/traffic/routing-key.test.ts
//
// Защита от заведомо мёртвого ключа Яндекс.Маршрутизации.
//
// Зачем: у Яндекса ключи отдельные на каждый сервис. Ключ геокодера
// Маршрутизацию не открывает — и каждый вызов оптимизатора уходил бы в Яндекс
// двумя заведомо неудачными запросами, а в логах лавиной сыпались бы одни и те
// же ошибки. Первый отказ «Invalid key» должен запоминаться.
//
// Здесь важно не только «бросает ошибку», но и «второй раз в сеть не ходит».

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getRouteTraffic, resetRoutingKeyRejection } from "@/lib/traffic/service"

// lib/traffic работает с кортежами [широта, долгота]
const WAYPOINTS: Array<[number, number]> = [
  [55.7558, 37.6173],
  [54.1932, 37.6176],
]

let fetchCalls: string[] = []

/** Ответ Яндекса: ключ выдан другому сервису. */
function invalidKeyResponse() {
  return {
    ok: false,
    status: 403,
    text: async () => '{"errors":["Invalid key"]}',
  }
}

function successResponse() {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        routes: [
          {
            legs: [{ steps: [{ length: "1000", duration: "600" }] }],
            distance: { value: 1000 },
            duration: { value: 600 },
          },
        ],
      }),
  }
}

beforeEach(() => {
  fetchCalls = []
  resetRoutingKeyRejection()
  process.env.TRAFFIC_PROVIDER = "yandex"
  process.env.YANDEX_ROUTING_API_KEY = "тестовый-ключ"
  vi.stubGlobal("fetch", async (input: string | URL) => {
    fetchCalls.push(String(input))
    return invalidKeyResponse()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetRoutingKeyRejection()
  delete process.env.TRAFFIC_PROVIDER
  delete process.env.YANDEX_ROUTING_API_KEY
})

describe("отклонённый ключ Маршрутизации", () => {
  it("первый вызов доходит до Яндекса и объясняет причину", async () => {
    await expect(getRouteTraffic({ routeId: "r1", coordinates: [...WAYPOINTS] })).rejects.toThrow(
      /Маршрутизац/i,
    )
    // Два запроса: с пробками и без — оба бьют в один и тот же мёртвый ключ
    expect(fetchCalls).toHaveLength(2)
  })

  it("второй вызов в сеть не ходит — ключ запомнен как мёртвый", async () => {
    await expect(
      getRouteTraffic({ routeId: "r2", coordinates: [...WAYPOINTS] }),
    ).rejects.toThrow(/Маршрутизац/i)
    expect(fetchCalls).toHaveLength(2)

    // Новый маршрут, тот же мёртвый ключ: запросов быть не должно
    await expect(
      getRouteTraffic({ routeId: "r3", coordinates: [...WAYPOINTS] }),
    ).rejects.toThrow(/отклонён/i)
    expect(fetchCalls).toHaveLength(2)
  })

  it("после сброса ключ проверяется заново", async () => {
    await expect(
      getRouteTraffic({ routeId: "r4", coordinates: [...WAYPOINTS] }),
    ).rejects.toThrow()
    expect(fetchCalls).toHaveLength(2)

    // Ключ заменили на рабочий — сбрасываем память об отказе
    vi.stubGlobal("fetch", async (input: string | URL) => {
      fetchCalls.push(String(input))
      return successResponse()
    })
    resetRoutingKeyRejection()

    const result = await getRouteTraffic({ routeId: "r5", coordinates: [...WAYPOINTS] })
    expect(result.provider).toBe("yandex")
    expect(fetchCalls.length).toBeGreaterThan(2)
  })
})

describe("ключ без настроек", () => {
  it("без ключа пробки не включаются вовсе", async () => {
    delete process.env.YANDEX_ROUTING_API_KEY
    await expect(
      getRouteTraffic({ routeId: "r6", coordinates: [...WAYPOINTS] }),
    ).rejects.toThrow(/YANDEX_ROUTING_API_KEY/)
    expect(fetchCalls).toHaveLength(0)
  })
})
