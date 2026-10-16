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

// ---------------------------------------------------------------------------
// Ложные координаты: провайдер ответил 200 и валидной точкой, но это ОТКАЗ
// ---------------------------------------------------------------------------

describe("геокодер не возвращает ложные координаты", () => {
  /** Ответ Яндекса, которым он «находит» несуществующий адрес: центр страны. */
  function yandexCountryFallback() {
    return {
      ok: true,
      json: async () => ({
        response: {
          GeoObjectCollection: {
            // found !== "0": Яндекс считает, что нашёл. Узнать обман можно
            // только по kind у самого объекта.
            metaDataProperty: { GeocoderResponseMetaData: { found: "1" } },
            featureMember: [
              {
                GeoObject: {
                  Point: { pos: "99.505405 61.698657" },
                  metaDataProperty: {
                    GeocoderMetaData: {
                      kind: "country",
                      precision: "other",
                      Address: { formatted: "Россия" },
                    },
                  },
                },
              },
            ],
          },
        },
      }),
    }
  }

  /** Тот же ответ, но с настоящим совпадением (kind: "locality"). */
  function yandexRealMatch() {
    return {
      ok: true,
      json: async () => ({
        response: {
          GeoObjectCollection: {
            metaDataProperty: { GeocoderResponseMetaData: { found: "1" } },
            featureMember: [
              {
                GeoObject: {
                  Point: { pos: "37.6173 54.1931" },
                  metaDataProperty: {
                    GeocoderMetaData: {
                      kind: "locality",
                      precision: "other",
                      Address: { formatted: "Россия, Тула" },
                    },
                  },
                },
              },
            ],
          },
        },
      }),
    }
  }

  /** Nominatim отвечает «страна» на заведомо несуществующий адрес. */
  function nominatimCountry() {
    return {
      ok: true,
      json: async () => [
        { lat: "61.698657", lon: "99.505405", class: "place", type: "country" },
      ],
    }
  }

  it("Яндекс «нашёл» только страну — это отказ, координаты не отдаются", async () => {
    process.env.YANDEX_GEOCODER_API_KEY = "ключ-геокодера"
    // Оба провайдера отказывают: иначе Nominatim доберёт координаты и смысл
    // проверки потеряется.
    stubFetch((url) =>
      url.includes("geocode-maps.yandex.ru") ? yandexCountryFallback() : nominatimCountry(),
    )

    const result = await geocodeAddresses(["Хреново-Никудаево, несуществующая область"])
    // Точка центра страны не должна считаться найденным адресом
    expect(result.get("Хреново-Никудаево, несуществующая область")).toBeNull()
  })

  it("Яндекс отказал, но Nominatim нашёл — fallback работает", async () => {
    process.env.YANDEX_GEOCODER_API_KEY = "ключ-геокодера"
    stubFetch((url) =>
      url.includes("geocode-maps.yandex.ru")
        ? yandexCountryFallback()
        : nominatimResponse(54.1932, 37.6176),
    )

    const result = await geocodeAddresses(["Тула"])
    expect(result.get("Тула")).toEqual({ lat: 54.1932, lng: 37.6176 })
    expect(calls).toHaveLength(2)
  })

  it("Яндекс с настоящим совпадением (kind: locality) работает как прежде", async () => {
    process.env.YANDEX_GEOCODER_API_KEY = "ключ-геокодера"
    stubFetch((url) =>
      url.includes("geocode-maps.yandex.ru")
        ? yandexRealMatch()
        : nominatimResponse(0, 0),
    )

    const result = await geocodeAddresses(["Тула"])
    expect(result.get("Тула")).toEqual({ lat: 54.1931, lng: 37.6173 })
  })

  it("Яндекс сообщил found = 0 — это отказ, падаем на Nominatim", async () => {
    process.env.YANDEX_GEOCODER_API_KEY = "ключ-геокодера"
    stubFetch((url) =>
      url.includes("geocode-maps.yandex.ru")
        ? {
            ok: true,
            json: async () => ({
              response: {
                GeoObjectCollection: {
                  metaDataProperty: { GeocoderResponseMetaData: { found: "0" } },
                  featureMember: [],
                },
              },
            }),
          }
        : nominatimResponse(54.1932, 37.6176),
    )

    const result = await geocodeAddresses(["Тула"])
    expect(result.get("Тула")).toEqual({ lat: 54.1932, lng: 37.6176 })
    expect(calls).toHaveLength(2)
  })

  it("Nominatim ответил «страна» — координаты не отдаются", async () => {
    stubFetch(() => nominatimCountry())

    const result = await geocodeAddresses(["Хреново-Никудаево"])
    expect(result.get("Хреново-Никудаево")).toBeNull()
  })

  it("недостоверный результат не попадает в GeoCache", async () => {
    process.env.YANDEX_GEOCODER_API_KEY = "ключ-геокодера"
    stubFetch((url) =>
      url.includes("geocode-maps.yandex.ru") ? yandexCountryFallback() : nominatimCountry(),
    )

    const result = await geocodeAddresses(["Хреново-Никудаево"])
    expect(result.get("Хреново-Никудаево")).toBeNull()
    // Ни один провайдер не дал пригодного ответа — значит и писать нечего
    expect(prismaMock.geoCache.create).not.toHaveBeenCalled()
  })

  it("User-Agent для Nominatim — только ASCII (иначе fetch падает на кириллице)", async () => {
    // Регрессия: в User-Agent была кириллица, и fetch в Node бросал
    // TypeError «Cannot convert argument to a ByteString». Ошибка
    // перехватывалась, и ВСЕ адреса становились «негеокодированными».
    let seenUserAgent = ""
    vi.stubGlobal(
      "fetch",
      async (input: string | URL, init?: { headers?: Record<string, string> }) => {
        const url = String(input)
        calls.push(url)
        if (url.includes("nominatim.openstreetmap.org")) {
          seenUserAgent = init?.headers?.["User-Agent"] ?? ""
        }
        return nominatimResponse(54.1932, 37.6176)
      },
    )

    await geocodeAddresses(["Тула"])

    expect(seenUserAgent).not.toBe("")
    expect(/^[\x20-\x7e]+$/.test(seenUserAgent)).toBe(true)
  })
})
