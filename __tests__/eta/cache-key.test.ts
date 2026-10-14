// __tests__/eta/cache-key.test.ts
//
// Ключ кэша ETA должен содержать ВСЁ, от чего зависит результат.
//
// Баг, который тут закрывается: в ключе был только час выезда. Два рейса одним
// маршрутом в 15:30 — в четверг и в пятницу — попадали в одну запись, и второй
// получал время первого. Погода и груз не участвовали вовсе: «снег» и
// «негабарит» молча игнорировались, хотя коэффициент их учитывает.

import { describe, expect, it } from "vitest"

import { cargoCacheKey, generateCacheKey } from "@/lib/eta/cache"

const THURSDAY_1530 = new Date(2026, 9, 15, 15, 30)
const FRIDAY_1530 = new Date(2026, 9, 16, 15, 30)
const THURSDAY_1540 = new Date(2026, 9, 15, 15, 40)
const THURSDAY_1600 = new Date(2026, 9, 15, 16, 0)

function key(
  factors: Parameters<typeof generateCacheKey>[4],
  waypointsKey?: string,
) {
  return generateCacheKey(55.75, 37.61, 54.19, 37.62, factors, waypointsKey)
}

describe("ключ кэша ETA", () => {
  it("одинаковый рейс даёт одинаковый ключ (кэш работает)", () => {
    expect(key({ departure: THURSDAY_1530 })).toBe(key({ departure: new Date(+THURSDAY_1530) }))
  })

  it("разный день недели — разный ключ", () => {
    expect(key({ departure: THURSDAY_1530 })).not.toBe(key({ departure: FRIDAY_1530 }))
  })

  it("время в пределах четверти часа — один ключ", () => {
    // 15:30 и 15:40 в одном слоте: кривая пика внутри четверти часа практически
    // линейна, а повторный запрос того же рейса должен попадать в кэш
    expect(key({ departure: THURSDAY_1530 })).toBe(key({ departure: THURSDAY_1540 }))
  })

  it("выход за четверть часа — другой ключ", () => {
    expect(key({ departure: THURSDAY_1530 })).not.toBe(key({ departure: THURSDAY_1600 }))
  })

  it("разный час — разный ключ", () => {
    expect(key({ departure: THURSDAY_1530 })).not.toBe(
      key({ departure: new Date(2026, 9, 15, 19, 30) }),
    )
  })

  it("погода участвует в ключе", () => {
    const clear = key({ departure: THURSDAY_1530, weather: "clear" })
    const snow = key({ departure: THURSDAY_1530, weather: "snow" })
    expect(clear).not.toBe(snow)
  })

  it("погода без данных не расходится с нейтральной", () => {
    expect(key({ departure: THURSDAY_1530 })).toBe(
      key({ departure: THURSDAY_1530, weather: undefined }),
    )
  })

  it("груз участвует в ключе", () => {
    const plain = key({ departure: THURSDAY_1530, cargoKey: cargoCacheKey(undefined) })
    const hazmat = key({
      departure: THURSDAY_1530,
      cargoKey: cargoCacheKey({ type: "hazmat", weight: 25 }),
    })
    expect(plain).not.toBe(hazmat)
  })

  it("подпись груза различает тип, вес и сопровождение", () => {
    expect(cargoCacheKey({ type: "hazmat" })).not.toBe(cargoCacheKey({ type: "fragile" }))
    expect(cargoCacheKey({ type: "hazmat", weight: 10 })).not.toBe(
      cargoCacheKey({ type: "hazmat", weight: 30 }),
    )
    expect(cargoCacheKey({ type: "hazmat", requiresEscort: true })).not.toBe(
      cargoCacheKey({ type: "hazmat" }),
    )
  })

  it("разные координаты — разный ключ", () => {
    const a = generateCacheKey(55.75, 37.61, 54.19, 37.62, { departure: THURSDAY_1530 })
    const b = generateCacheKey(55.75, 37.61, 54.19, 37.63, { departure: THURSDAY_1530 })
    expect(a).not.toBe(b)
  })

  it("разный порядок объезда — разный ключ", () => {
    const a = key({ departure: THURSDAY_1530 }, "55.0,37.0~56.0,38.0")
    const b = key({ departure: THURSDAY_1530 }, "56.0,38.0~55.0,37.0")
    expect(a).not.toBe(b)
  })
})
