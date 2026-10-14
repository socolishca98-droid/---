// __tests__/geo/geocode-providers.test.ts
//
// Приоритет провайдеров координат: Яндекс.Геокодер → Nominatim.
//
// Зачем: ключ геокодера Яндекса даёт российские адресы заметно лучше
// OpenStreetMap и не упирается в лимит «1 запрос в секунду», который сильно
// тормозит оптимизатор маршрута. Но ключ может быть не задан, отозван или
// отдать пустоту — тогда должен работать прежний Nominatim, а не падать.
//
// Отдельно проверяем GeoCache: общий для платформы кэш не должен превращаться
// в хранилище чужих организаций (в нём только справочные адреса).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { geocodeAddresses } from "@/lib/geo/geocode"

/** Строка GeoCache в объёме, который использует geocode.ts. */
type GeoCacheRow = { address: string; lat: number; lng: number }

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    geoCache: {
      findMany: vi.fn(async (): Promise<GeoCacheRow[]> => []),
      create: vi.fn(async () => ({})),
    },
  },
}))

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

/** Ответ Яндекс.Геокодера в его формате: Point.pos = "долгота широта". */
function yandexResponse(lng: number, lat: number) {
  return {
    ok: true,
    json: async () => ({
      response: {
        GeoObjectCollection: {
          featureMember: [{ GeoObject: { Point: { pos: `${lng} ${lat}` } } }],
        },
      },
    }),
  }
}

function nominatimResponse(lat: number, lng: number) {
  return {
    ok: true,
    json: async () => [{ lat: String(lat), lon: String(lng) }],
  }
}

let calls: string[] = []

function stubFetch(handler: (url: string) => unknown) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input)
    calls.push(url)
    return handler(url)
  })
}

beforeEach(() => {
  calls = []
  prismaMock.geoCache.findMany.mockClear()
  prismaMock.geoCache.create.mockClear()
  process.env.GEOCODE_PAUSE_MS = "0" // без пауз между запросами
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.YANDEX_GEOCODER_API_KEY
  delete process.env.GEOCODE_PAUSE_MS
})

describe("когда ключ Яндекса задан", () => {
  beforeEach(() => {
    process.env.YANDEX_GEOCODER_API_KEY = "ключ-геокодера"
  })

  it("координаты берутся у Яндекса, Nominatim не трогаем", async () => {
    stubFetch((url) => (url.includes("geocode-maps.yandex.ru") ? yandexResponse(37.6173, 55.7558) : nominatimResponse(0, 0)))

    const result = await geocodeAddresses(["Москва"])

    expect(result.get("Москва")).toEqual({ lat: 55.7558, lng: 37.6173 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("geocode-maps.yandex.ru")
  })

  it("Яндекс ограничивает поиск Россией", async () => {
    stubFetch(() => yandexResponse(37.6173, 55.7558))
    await geocodeAddresses(["Москва"])

    // bbox по России: без него «Минск» и «Москва» уезжают не туда
    expect(calls[0]).toContain("bbox=")
  })

  it("Яндекс не ответил — добираем координаты у Nominatim", async () => {
    stubFetch((url) =>
      url.includes("geocode-maps.yandex.ru")
        ? { ok: false, json: async () => ({}) }
        : nominatimResponse(55.7558, 37.6173),
    )

    const result = await geocodeAddresses(["Москва"])
    expect(result.get("Москва")).toEqual({ lat: 55.7558, lng: 37.6173 })
    expect(calls).toHaveLength(2)
  })

  it("Яндекс вернул пустоту — тоже fallback на Nominatim", async () => {
    stubFetch((url) =>
      url.includes("geocode-maps.yandex.ru")
        ? { ok: true, json: async () => ({ response: { GeoObjectCollection: { featureMember: [] } } }) }
        : nominatimResponse(55.7558, 37.6173),
    )

    const result = await geocodeAddresses(["Москва"])
    expect(result.get("Москва")).toEqual({ lat: 55.7558, lng: 37.6173 })
  })
})

describe("ключа Яндекса нет", () => {
  it("работает Nominatim, как раньше", async () => {
    stubFetch(() => nominatimResponse(54.1932, 37.6176))

    const result = await geocodeAddresses(["Тула"])

    expect(result.get("Тула")).toEqual({ lat: 54.1932, lng: 37.6176 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("nominatim.openstreetmap.org")
  })
})

describe("кэш", () => {
  it("найденный в кэше адрес не запрашивается у провайдеров", async () => {
    prismaMock.geoCache.findMany.mockResolvedValueOnce([
      { address: "москва", lat: 55.7558, lng: 37.6173 },
    ])
    stubFetch(() => {
      throw new Error("в сеть ходить не должны")
    })

    const result = await geocodeAddresses(["Москва"])
    expect(result.get("Москва")).toEqual({ lat: 55.7558, lng: 37.6173 })
    expect(calls).toHaveLength(0)
  })

  it("неопределившийся адрес честно отдаёт null", async () => {
    stubFetch(() => ({ ok: false, json: async () => ({}) }))

    const result = await geocodeAddresses(["Какая-то неизвестная деревня"])
    expect(result.get("Какая-то неизвестная деревня")).toBeNull()
  })
})
