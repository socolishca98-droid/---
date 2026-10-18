// __tests__/eta/coefficients.test.ts
//
// Исторические коэффициенты времени в пути — наш единственный источник «пробок»
// без внешнего сервиса (TRAFFIC_PROVIDER=historical).
//
// Здесь проверяется главное: коэффициенты действительно ВЛИЯЮТ на время, а не
// размываются. Раньше итог считался средневзвешенной суммой, и вечерний пик
// ×1.8 превращался в ×1.28, а снег ×1.35 — в ×1.09: модель почти ничего не
// делала. Тесты фиксируют и это.

import { describe, expect, it } from "vitest"

import {
  calculateAllCoefficients,
  calculateRushHourCoefficient,
  describeCoefficients,
} from "@/lib/eta/coefficients"
import type { ETARequest } from "@/lib/eta/types"

/**
 * Дата с заданными часами в ЛОКАЛЬном времени процесса.
 *
 * Коэффициенты читают часы через getHours(), то есть в часовой поясе процесса.
 * Поэтому в тестах дату строим локальными компонентами — иначе на машине в UTC
 * «московские» 8:30 превращаются в 5:30 и тест ловит ночной коэффициент.
 *
 * 2026-10-14 — среда, 2026-10-16 — пятница.
 */
function at(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 9, day, hour, minute)
}

/**
 * Запрос для коэффициентов. ETARequest требует координаты, но коэффициентам они
 * не нужны — подставляем нули, чтобы тип был честным.
 */
function request(overrides: Partial<ETARequest> = {}): ETARequest {
  return {
    origin: { lat: 0, lng: 0 },
    destination: { lat: 0, lng: 0 },
    ...overrides,
  } as ETARequest
}

/** Среда, 14:00 — все факторы нейтральны. */
const NEUTRAL = request({ departureTime: at(14, 14) })

describe("коэффициент часа пик", () => {
  it("утро 8:30 — пик, коэффициент заметно больше 1", () => {
    const k = calculateRushHourCoefficient(at(14, 8, 30))
    expect(k).toBeGreaterThan(1.5)
    expect(k).toBeLessThanOrEqual(1.6)
  })

  it("вечер 18:30 — пик сильнее утреннего", () => {
    const evening = calculateRushHourCoefficient(at(14, 18, 30))
    const morning = calculateRushHourCoefficient(at(14, 8, 30))
    expect(evening).toBeGreaterThan(morning)
    expect(evening).toBeLessThanOrEqual(1.8)
  })

  it("ночь 3:00 — движение свободнее единицы", () => {
    expect(calculateRushHourCoefficient(at(14, 3))).toBeCloseTo(0.85, 5)
  })

  it("день 14:00 — нейтрально", () => {
    expect(calculateRushHourCoefficient(at(14, 14))).toBeCloseTo(1.0, 5)
  })

  it("симметричен относительно пика: 7:30 и 9:30 дают одно и то же", () => {
    const before = calculateRushHourCoefficient(at(14, 7, 30))
    const after = calculateRushHourCoefficient(at(14, 9, 30))
    expect(before).toBeCloseTo(after, 5)
  })
})

describe("итоговый коэффициент", () => {
  it("нейтральный запрос даёт ровно 1.0", () => {
    const { total } = calculateAllCoefficients(NEUTRAL, 200)
    expect(total).toBeCloseTo(1.0, 5)
  })

  it("вечерний пик даёт ровно свой коэффициент, а не средний", () => {
    const peak = calculateAllCoefficients(request({ departureTime: at(14, 18, 30) }), 200)

    // Вечерний пик ×1.8, остальное нейтрально → итог ×1.8 (а не ×1.28, как было)
    expect(peak.rushHour).toBeCloseTo(1.8, 5)
    expect(peak.total).toBeCloseTo(1.8, 5)
  })

  it("ночь против вечернего пика — разница двукратная", () => {
    const night = calculateAllCoefficients(request({ departureTime: at(14, 3) }), 200)
    const peak = calculateAllCoefficients(request({ departureTime: at(14, 18, 30) }), 200)

    expect(night.total).toBeCloseTo(0.85, 5)
    expect(peak.total / night.total).toBeGreaterThan(2.0)
  })

  it("снег тоже сдвигает итог", () => {
    const clear = calculateAllCoefficients(NEUTRAL, 200)
    const snow = calculateAllCoefficients(request({ departureTime: at(14, 14), weather: "snow" }), 200)
    expect(snow.total).toBeCloseTo(1.35, 5)
    expect(snow.total).toBeGreaterThan(clear.total * 1.05)
  })

  it("без данных о погоде она нейтральна (×1.0), а не угадана", () => {
    const { weather } = calculateAllCoefficients(NEUTRAL, 200)
    expect(weather).toBeCloseTo(1.0, 5)
  })

  it("городской участок замедляет, трасса ускоряет", () => {
    const city = calculateAllCoefficients(NEUTRAL, 10)
    const highway = calculateAllCoefficients(NEUTRAL, 500)
    expect(city.roadType).toBeGreaterThan(1.2)
    expect(highway.roadType).toBeLessThan(1.0)
    expect(city.total).toBeGreaterThan(highway.total)
  })

  it("пятница вечером хуже среды", () => {
    const wednesday = calculateAllCoefficients(request({ departureTime: at(14, 18, 30) }), 200)
    const friday = calculateAllCoefficients(request({ departureTime: at(16, 18, 30) }), 200)
    expect(friday.total).toBeGreaterThan(wednesday.total)
  })

  it("негабаритный груз замедляет", () => {
    const plain = calculateAllCoefficients(NEUTRAL, 200)
    const oversized = calculateAllCoefficients(
      request({ departureTime: at(14, 14), cargo: { type: "oversized" } }),
      200,
    )
    expect(oversized.total).toBeCloseTo(1.3, 5)
    expect(oversized.total).toBeGreaterThan(plain.total)
  })

  it("итог не уходит в абсурд даже когда всё плохо сразу", () => {
    const worst = calculateAllCoefficients(
      request({
        departureTime: at(16, 19),
        weather: "storm",
        cargo: { type: "oversized", requiresEscort: true },
      }),
      15,
    )
    expect(worst.total).toBeGreaterThan(1.2)
    // Потолок: план не предполагает больше, чем в 2.5 раза дольше свободного хода
    expect(worst.total).toBeLessThanOrEqual(2.5)
  })

  it("итог не опускается ниже 0.8", () => {
    const best = calculateAllCoefficients(
      request({ departureTime: at(18, 3), weather: "clear" }),
      400,
    )
    expect(best.total).toBeGreaterThanOrEqual(0.8)
  })
})

describe("описание коэффициентов для интерфейса", () => {
  it("вечерний пик называется вечерним", () => {
    const when = at(14, 18, 30)
    const coefficients = calculateAllCoefficients(request({ departureTime: when }), 200)
    const parts = describeCoefficients(coefficients, when)
    expect(parts.join(" ")).toMatch(/вечерний пик/)
    expect(parts.join(" ")).toMatch(/×1\.8/)
  })

  it("нейтральный запрос не порождает список факторов", () => {
    const when = at(14, 14)
    expect(describeCoefficients(calculateAllCoefficients(NEUTRAL, 200), when)).toEqual([])
  })

  it("погода попадает в описание только когда её передали", () => {
    const when = at(14, 14)
    const withSnow = calculateAllCoefficients(request({ departureTime: when, weather: "snow" }), 200)
    expect(describeCoefficients(withSnow, when).join(" ")).toMatch(/погода/)
  })

  it("груз и тип дороги описываются словами", () => {
    const when = at(14, 14)
    const coefficients = calculateAllCoefficients(
      request({ departureTime: when, cargo: { type: "hazmat" } }),
      10,
    )
    const text = describeCoefficients(coefficients, when).join(", ")
    expect(text).toMatch(/городской/)
    expect(text).toMatch(/груз/)
  })

  it("время в пути = базовое × итоговый коэффициент", () => {
    // Связка с тем, как коэффициенты применяются в lib/eta/service.ts
    const when = at(14, 18, 30)
    const coefficients = calculateAllCoefficients(request({ departureTime: when }), 200)
    const baseSeconds = 10_000
    const withTraffic = Math.round(baseSeconds * coefficients.total)
    expect(withTraffic).toBe(18_000)
  })
})
