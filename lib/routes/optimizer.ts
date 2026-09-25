// lib/routes/optimizer.ts
//
// Чистая логика трёх сценариев рейса: «быстрее», «дешевле», «сбалансировано».
//
// Здесь только то, что можно посчитать по данным самих заказов: порядок объезда
// точек и политика сценария. Никаких «примерных» километров, часов и рублей —
// реальные пробег, время в пути и стоимость считает сервер (lib/eta → OSRM)
// в app/api/routes/optimizer/route.ts. Модуль не ходит в сеть и не читает БД,
// поэтому его можно проверять юнит-тестами (tests/route-optimizer.test.mjs).

import { normalizeOrderStatus } from "../orders/stages"

export type OptimizerVariantId = "fast" | "cheap" | "balanced"

/** Порядок сценариев в ответе и в интерфейсе. */
export const OPTIMIZER_VARIANTS: readonly OptimizerVariantId[] = ["fast", "cheap", "balanced"]

export interface OptimizerOrderLike {
  id: string
  routeFrom: string
  routeTo: string
  distance?: number | null
  weight?: number | null
  price?: number | null
  deadline?: Date | string | null
  status?: string | null
}

/** Статусы, при которых заказ уже не участвует в сборке рейса. */
const FINAL_STATUSES = new Set(["delivered", "cancelled", "rejected", "expired"])

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Город для сравнения точек: «Москва, Россия» и «москва» — один город.
 * Значение до первой запятой, без лишних пробелов, в нижнем регистре, ё → е.
 */
export function normalizeCity(value: unknown): string {
  if (typeof value !== "string") return ""
  return (
    value
      .trim()
      .split(",")[0]
      ?.trim()
      .toLowerCase()
      .replace(/ё/g, "е") || ""
  )
}

export function parseDeadline(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "string") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

/** Заказы, которые вообще можно ставить в сценарии рейса. */
export function filterOptimizableOrders<T extends { status?: string | null }>(orders: readonly T[]): T[] {
  return orders.filter((order) => {
    const status = normalizeOrderStatus(order.status)
    // Неизвестный статус не выдумываем: считаем заказ рабочим.
    if (!status) return true
    return !FINAL_STATUSES.has(status)
  })
}

/**
 * Порядок объезда заказов для одного сценария.
 *
 * Жадный алгоритм «ближайший подходящий»: сначала заказы, у которых город
 * погрузки совпадает с городом выгрузки предыдущего заказа (меньше порожних
 * перегонов), при равенстве — по политике сценария (сроки, доход на километр,
 * общий пробег). Пробег и сроки берутся из самих заказов, ничего не выдумывается.
 */
export function sequenceOrders(
  orders: readonly OptimizerOrderLike[],
  variant: OptimizerVariantId,
): string[] {
  if (orders.length === 0) return []
  if (orders.length === 1) return [orders[0].id]

  const remaining = [...orders]
  const now = Date.now()

  // Сколько заказов выгружается там, где мы грузимся: чем больше, тем больше
  // грузов рядом и тем выгоднее начать с этого направления.
  const unloadsByCity = new Map<string, number>()
  for (const order of remaining) {
    const city = normalizeCity(order.routeTo)
    unloadsByCity.set(city, (unloadsByCity.get(city) || 0) + 1)
  }

  const urgencyOf = (order: OptimizerOrderLike): number => {
    const deadline = parseDeadline(order.deadline)
    if (!deadline) return 0
    const days = (deadline.getTime() - now) / (24 * 3600 * 1000)
    return clamp(1 / Math.max(0.2, days), 0, 3) * 120
  }

  const profitPerKmOf = (order: OptimizerOrderLike): number => {
    const distance = Math.max(0, Number(order.distance) || 0)
    const price = typeof order.price === "number" ? order.price : 0
    return distance > 0 ? clamp(price / distance, 0, 200) * 2 : 0
  }

  /**
   * Оценка «с чего начать». Именно здесь сценарии расходятся по-настоящему:
   * «быстрее» стартует с самого срочного заказа, «дешевле» — с самого выгодного
   * по километру и короткого, «сбалансировано» — смесь. Без этого все три
   * сценария начинались бы с одного и того же заказа и совпадали.
   */
  const startScore = (order: OptimizerOrderLike): number => {
    const direction = (unloadsByCity.get(normalizeCity(order.routeFrom)) || 0) * 60
    const urgency = urgencyOf(order)
    const profit = profitPerKmOf(order)
    const distance = Math.max(0, Number(order.distance) || 0)

    if (variant === "fast") {
      return direction + urgency + profit * 0.2 - distance * 0.1
    }
    if (variant === "cheap") {
      return direction + urgency * 0.3 + profit - distance * 0.4
    }
    return direction + urgency * 0.6 + profit * 0.7 - distance * 0.25
  }

  // Начинать выгоднее с «начала цепочки»: заказа, в город погрузки которого
  // никто из выбранных не везёт. Иначе первый же перегон будет порожним.
  // Политика сценария решает уже между равными кандидатами.
  const destinations = new Set(remaining.map((order) => normalizeCity(order.routeTo)))
  const chainHeads = remaining.filter(
    (order) => !destinations.has(normalizeCity(order.routeFrom)),
  )
  const startPool = chainHeads.length > 0 ? chainHeads : remaining

  const sortedByStart = [...startPool].sort((a, b) => startScore(b) - startScore(a))
  const first = sortedByStart[0]
  remaining.splice(
    remaining.findIndex((order) => order.id === first.id),
    1,
  )

  const scoreCandidate = (order: OptimizerOrderLike, continuesRoute: boolean): number => {
    const distance = Math.max(0, Number(order.distance) || 0)
    const urgency = urgencyOf(order)
    const profit = profitPerKmOf(order)

    // Продолжение маршрута из той же точки всегда лучше порожнего перегона.
    const continuityScore = continuesRoute ? 1000 : 0
    const distancePenalty = distance * 0.25

    if (variant === "fast") {
      return continuityScore + urgency + profit - distancePenalty
    }
    if (variant === "cheap") {
      return continuityScore + profit * 0.6 - distancePenalty * 1.4 + urgency * 0.4
    }
    return continuityScore + urgency * 0.7 + profit * 0.7 - distancePenalty
  }

  const result: string[] = []
  result.push(first.id)
  let currentCity = normalizeCity(first.routeTo)

  while (remaining.length > 0) {
    const matching = remaining.filter((order) => normalizeCity(order.routeFrom) === currentCity)
    const pool = matching.length > 0 ? matching : remaining

    let best = pool[0]
    let bestScore = Number.NEGATIVE_INFINITY
    for (const order of pool) {
      const score = scoreCandidate(order, normalizeCity(order.routeFrom) === currentCity)
      if (score > bestScore) {
        bestScore = score
        best = order
      }
    }

    result.push(best.id)
    currentCity = normalizeCity(best.routeTo)
    remaining.splice(
      remaining.findIndex((order) => order.id === best.id),
      1,
    )
  }

  return result
}

export interface OptimizerVariantPolicy {
  title: string
  subtitle: string
  /** Чем сценарий отличается — показывается пользователю как есть. */
  notes: string[]
}

export function variantPolicy(variant: OptimizerVariantId): OptimizerVariantPolicy {
  if (variant === "fast") {
    return {
      title: "Быстрее",
      subtitle: "Минимизируем время в пути, готовы к платным участкам",
      notes: [
        "Приоритет времени: меньше порожних перегонов и раньше закрываются срочные заказы.",
        "Время в пути и километры — по дорогам (OSRM), с учётом времени суток.",
      ],
    }
  }
  if (variant === "cheap") {
    return {
      title: "Дешевле",
      subtitle: "Минимизируем пробег и платные участки, терпим рост времени",
      notes: [
        "Приоритет затрат: меньше общий пробег, ниже расход топлива.",
        "Время может вырасти — это осознанный обмен времени на деньги.",
      ],
    }
  }
  return {
    title: "Сбалансировано",
    subtitle: "Компромисс времени, затрат и рисков",
    notes: [
      "Компромисс: удерживаем затраты под контролем без резкого роста времени.",
      "Сроки учитываются, но за скорость не переплачиваем всегда.",
    ],
  }
}
