// lib/routing/reference.ts
//
// НЕЗАВИСИМЫЙ эталон качества: полный перебор без доминирования, без верхних
// границ и без бюджета состояний.
//
// Утверждение «оптимум доказан» проверить можно только тем, что считает иначе.
// Здесь другой алгоритм и другой код: прямой перебор всех допустимых
// последовательностей и чередований операций. Общая с движком только функция
// `materialize` — она считает маршрут, а не ищет его.
//
// Прода этот модуль не вызывает: он растёт факториально. Это инструмент
// проверки (тесты и scripts/optimizer-ref.mjs).

import { materialize, type BuildContext } from "./builder"
import type { CapacityMove } from "./capacity"
import type { LoadOrder, RoutePlan } from "./types"

export interface ReferenceResult {
  best: RoutePlan | null
  checked: number
  skipped: number
  refused: string | null
}

const MAX_ORDERS_SEQUENTIAL = 7
const MAX_ORDERS_CONSOLIDATED = 4

/** Все подмножества заказов размером 1..maxSize. */
function* subsets<T>(items: T[], maxSize: number): Generator<T[]> {
  const n = items.length
  for (let mask = 1; mask < 1 << n; mask += 1) {
    const picked: T[] = []
    for (let i = 0; i < n; i += 1) if (mask & (1 << i)) picked.push(items[i])
    if (picked.length >= 1 && picked.length <= maxSize) yield picked
  }
}

/** Все перестановки массива. */
function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items]
    return
  }
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const tail of permutations(rest)) yield [items[i], ...tail]
  }
}

/**
 * Все допустимые последовательности операций для набора заказов.
 *
 * «Допустимая» — погрузка раньше выгрузки своего заказа, в кузове не больше
 * разрешённого числа грузов и не больше вместимости. То же физическое условие,
 * что в расчёте, но проверяется здесь заново, по шагам.
 */
function* moveSequences(orders: LoadOrder[], context: BuildContext): Generator<CapacityMove[]> {
  const { vehicle, settings } = context
  const n = orders.length
  const picked = new Array<boolean>(n).fill(false)
  const done = new Array<boolean>(n).fill(false)
  let kg = 0
  let m3 = 0
  let count = 0
  const moves: CapacityMove[] = []

  const walk = function* (): Generator<CapacityMove[]> {
    if (moves.length === n * 2) {
      yield [...moves]
      return
    }
    for (let i = 0; i < n; i += 1) {
      const order = orders[i]
      if (!picked[i]) {
        const nextKg = kg + (order.weightKg ?? 0)
        const nextM3 = m3 + (order.volumeM3 ?? 0)
        const nextCount = count + 1
        if (nextKg > vehicle.capacityKg + 1e-6) continue
        if (vehicle.capacityM3 > 0 && nextM3 > vehicle.capacityM3 + 1e-6) continue
        if (nextCount > settings.maxConcurrentOrders) continue
        const before = { kg, m3, count }
        picked[i] = true
        kg = nextKg
        m3 = nextM3
        count = nextCount
        moves.push({ kind: "load", order })
        yield* walk()
        moves.pop()
        picked[i] = false
        kg = before.kg
        m3 = before.m3
        count = before.count
      } else if (!done[i]) {
        const before = { kg, m3, count }
        done[i] = true
        kg -= order.weightKg ?? 0
        m3 -= order.volumeM3 ?? 0
        count -= 1
        moves.push({ kind: "unload", order })
        yield* walk()
        moves.pop()
        done[i] = false
        kg = before.kg
        m3 = before.m3
        count = before.count
      }
    }
  }

  yield* walk()
}

function better(candidate: RoutePlan | null, best: RoutePlan | null): boolean {
  if (!best) return true
  return candidate!.economics.netCommittedRub > best.economics.netCommittedRub
}

/** Эталон модели А: все подмножества × все перестановки пар. */
export function referenceSequential(context: BuildContext): ReferenceResult {
  const { orders, settings } = context
  if (orders.length > MAX_ORDERS_SEQUENTIAL) {
    return {
      best: null,
      checked: 0,
      skipped: 0,
      refused: `эталон модели А считает не больше ${MAX_ORDERS_SEQUENTIAL} грузов, а их ${orders.length}`,
    }
  }
  const includeReturn = settings.returnMode !== "free"
  let checked = 0
  let best: RoutePlan | null = null
  for (const group of subsets(orders, Math.max(1, settings.maxLegs))) {
    for (const order of permutations(group)) {
      const moves: CapacityMove[] = []
      for (const item of order) {
        moves.push({ kind: "load", order: item }, { kind: "unload", order: item })
      }
      checked += 1
      const result = materialize(context, moves, { model: "sequential", includeReturn, exact: false })
      if (!result.plan) continue
      if (better(result.plan, best)) best = result.plan
      if (settings.returnMode === "preferred") {
        const open = materialize(context, moves, {
          model: "sequential",
          includeReturn: false,
          exact: false,
        })
        if (open.plan && better(open.plan, best)) best = open.plan
      }
    }
  }
  if (best) best.optimality = "feasible"
  return { best, checked, skipped: 0, refused: null }
}

/** Эталон модели Б: все наборы × все допустимые чередования операций. */
export function referenceConsolidated(context: BuildContext): ReferenceResult {
  const { orders, settings } = context
  if (orders.length > MAX_ORDERS_CONSOLIDATED) {
    return {
      best: null,
      checked: 0,
      skipped: 0,
      refused:
        `эталон модели Б считает не больше ${MAX_ORDERS_CONSOLIDATED} грузов, ` +
        `а их ${orders.length}`,
    }
  }
  const includeReturn = settings.returnMode !== "free"
  let checked = 0
  let skipped = 0
  let best: RoutePlan | null = null
  for (const group of subsets(
    orders,
    Math.min(MAX_ORDERS_CONSOLIDATED, settings.maxConcurrentOrders),
  )) {
    if (group.length < 2) {
      skipped += 1
      continue
    }
    for (const moves of moveSequences(group, context)) {
      checked += 1
      const result = materialize(context, moves, {
        model: "consolidated",
        includeReturn,
        exact: false,
      })
      if (!result.plan) continue
      if (better(result.plan, best)) best = result.plan
      if (settings.returnMode === "preferred") {
        const open = materialize(context, moves, {
          model: "consolidated",
          includeReturn: false,
          exact: false,
        })
        if (open.plan && better(open.plan, best)) best = open.plan
      }
    }
  }
  if (best) best.optimality = "feasible"
  return { best, checked, skipped, refused: null }
}

/** Эталон по обеим моделям: лучшее из двух полных переборов. */
export function referencePlan(context: BuildContext): {
  best: RoutePlan | null
  sequential: ReferenceResult
  consolidated: ReferenceResult
} {
  const sequential = referenceSequential(context)
  const consolidated = referenceConsolidated(context)
  const candidates = [sequential.best, consolidated.best].filter(Boolean) as RoutePlan[]
  let best: RoutePlan | null = null
  for (const plan of candidates) if (better(plan, best)) best = plan
  return { best, sequential, consolidated }
}
