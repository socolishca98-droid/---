// lib/eta/vehicle-profile.ts
//
// Профиль транспортного средства.
//
// По ТЗ §7 приоритет такой:
//   1. фактические данные по этому автомобилю;
//   2. исторические данные по аналогичному ТС;
//   3. модель по категории;
//   4. базовые значения.
//
// Важно: если маршрут НЕДОПУСТИМ для этого ТС (например, низкий мост или
// запрет для негабарита), это ошибка допустимости маршрута, а не «увеличим
// время коэффициентом». Поэтому функция возвращает violations, и вызывающий
// код обязан их показать, а не замазать поправкой.
//
// Ограничения по мостам, тоннелям и въездам бесплатный OSRM профилем «car» не
// учитывает — это известное ограничение бесплатного варианта, оно честно
// перечислено в отчёте как недоступное без платных данных.

export interface VehicleInput {
  /** Тип из карточки ТС: truck | van | car | ... */
  type?: string
  /** Грузоподъёмность, кг */
  capacity?: number
  /** Объём кузова, м³ */
  volume?: number
  /** Габариты, метры */
  length?: number
  width?: number
  height?: number
  /** Опасный груз */
  hazmat?: boolean
  /** Негабарит */
  oversized?: boolean
  /** Прицеп */
  trailer?: boolean
}

export type VehicleCategory = "light" | "van" | "truck" | "articulated" | "special"

export interface VehicleProfile {
  category: VehicleCategory
  label: string
  /** Коэффициент времени относительно базовой скорости класса дороги */
  speedFactor: number
  /** Насколько профиль доверенный */
  confidence: number
  /** Недостающие данные, из-за которых уверенность ниже */
  missing: string[]
}

/** Модель по категории: тяжёлому и длинному ТС нужно больше времени на манёврах. */
const CATEGORY_FACTORS: Record<VehicleCategory, { factor: number; label: string }> = {
  light: { factor: 1.0, label: "легковой" },
  van: { factor: 1.05, label: "фургон" },
  truck: { factor: 1.12, label: "грузовой автомобиль" },
  articulated: { factor: 1.2, label: "автопоезд" },
  special: { factor: 1.3, label: "спецтехника" },
}

/** Тип ТС из карточки → категория. */
const TYPE_TO_CATEGORY: Record<string, VehicleCategory> = {
  car: "light",
  passenger: "light",
  van: "van",
  minivan: "van",
  truck: "truck",
  грузовой: "truck",
  фургон: "van",
  тягач: "articulated",
  трал: "articulated",
  автопоезд: "articulated",
  эвакуатор: "special",
  кран: "special",
  спецтехника: "special",
}

/** Разрешённая высота ТС по категории, метры — для проверки ограничений. */
const MAX_HEIGHT: Record<VehicleCategory, number> = {
  light: 2.0,
  van: 2.5,
  truck: 3.2,
  articulated: 3.4,
  special: 3.8,
}

export interface RouteRestriction {
  code: string
  /** Текст для интерфейса */
  message: string
  /**
   * Числовое значение ограничения (метры, килограммы), если оно известно.
   *
   * Приоритетнее разбора текста: строка «не выше 3.5 м» парсится регуляркой и
   * легко ломается на другом формате. Вызывающий код, у которого ограничение
   * хранится числом, должен передавать его сюда.
   */
  value?: number
  /** К какому сегменту относится (для объяснения) */
  onSegmentIndex?: number
}

/**
 * Строит профиль ТС из карточки.
 *
 * Не придумывает характеристик: чего нет в данных — то в missing, и уверенность
 * падает. Категория выводится из типа ТС, а при отсутствии типа — из
 * грузоподъёмности (тяжёлое → truck).
 */
export function buildVehicleProfile(vehicle?: VehicleInput): VehicleProfile {
  const missing: string[] = []
  if (!vehicle) {
    return {
      category: "truck",
      label: CATEGORY_FACTORS.truck.label,
      speedFactor: CATEGORY_FACTORS.truck.factor,
      confidence: 0.4,
      missing: ["карточка ТС не передана"],
    }
  }

  if (!vehicle.type) missing.push("тип ТС")
  if (vehicle.capacity === undefined) missing.push("грузоподъёмность")
  if (vehicle.height === undefined) missing.push("высота")

  let category: VehicleCategory = TYPE_TO_CATEGORY[(vehicle.type || "").toLowerCase()] ?? "truck"

  if (!vehicle.type && typeof vehicle.capacity === "number") {
    // Грузоподъёмность сама по себе не делает машину автопоездом: 20-тонный
    // грузовик — это truck, а автопоезд это тягач С прицепом (флаг trailer).
    // Автопоездом считаем только свыше 20 т — это уже, как правило, сцепка.
    category = vehicle.capacity <= 1500 ? "van" : vehicle.capacity <= 20000 ? "truck" : "articulated"
  }

  let speedFactor = CATEGORY_FACTORS[category].factor

  if (vehicle.hazmat) speedFactor *= 1.05
  if (vehicle.oversized) speedFactor *= 1.1
  if (vehicle.trailer) speedFactor *= 1.06

  const confidence = Math.max(0.3, 0.9 - missing.length * 0.2)

  return {
    category,
    label: CATEGORY_FACTORS[category].label,
    speedFactor: Math.round(speedFactor * 100) / 100,
    confidence,
    missing,
  }
}

/**
 * Проверяет допустимость маршрута для ТС.
 *
 * Возвращает список нарушений. Пустой список — маршрут допустим. Нарушения НЕ
 * компенсируются коэффициентом: вызывающий код обязан вернуть ошибку или
 * предложить альтернативу (ТЗ §7).
 */
export function checkRouteRestrictions(
  vehicle: VehicleInput | undefined,
  restrictions: readonly RouteRestriction[],
): RouteRestriction[] {
  if (!vehicle) return []

  const violations: RouteRestriction[] = []
  const profile = buildVehicleProfile(vehicle)
  const heightLimit = MAX_HEIGHT[profile.category]

  for (const restriction of restrictions) {
    switch (restriction.code) {
      case "max_height": {
        const limit = restriction.value ?? parseNumberFromMessage(restriction.message)
        if (limit !== null && vehicle.height !== undefined && vehicle.height > limit) {
          violations.push({
            code: "max_height",
            message: `высота ТС ${vehicle.height} м выше ограничения ${limit} м`,
          })
        }
        break
      }
      case "max_weight": {
        const limit = restriction.value ?? parseNumberFromMessage(restriction.message)
        const gross = (vehicle.capacity ?? 0) + 8000 // масса ТС + груз (оценочно)
        if (limit !== null && gross > limit) {
          violations.push({
            code: "max_weight",
            message: `полная масса ~${gross} кг выше ограничения ${limit} кг`,
          })
        }
        break
      }
      case "no_trucks": {
        if (profile.category !== "light") {
          violations.push({ code: "no_trucks", message: "движение грузовых ТС запрещено" })
        }
        break
      }
      case "no_hazmat": {
        if (vehicle.hazmat) {
          violations.push({ code: "no_hazmat", message: "проезд с опасным грузом запрещён" })
        }
        break
      }
      case "no_oversized": {
        if (vehicle.oversized) {
          violations.push({ code: "no_oversized", message: "проезд негабаритного ТС запрещён" })
        }
        break
      }
      case "height_over_profile": {
        if (vehicle.height !== undefined && vehicle.height > heightLimit) {
          violations.push({
            code: "height_over_profile",
            message: `высота ${vehicle.height} м выше типовой для «${profile.label}» (${heightLimit} м)`,
          })
        }
        break
      }
      default:
        break
    }
  }

  return violations
}

function parseNumberFromMessage(message: string): number | null {
  const match = /(\d+(?:[.,]\d+)?)/.exec(message)
  if (!match) return null
  return Number(match[1].replace(",", "."))
}
