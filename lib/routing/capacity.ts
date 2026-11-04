// lib/routing/capacity.ts
//
// Capacity Engine: что находится в кузове на каждом участке маршрута.
//
// Зачем отдельным движком: при последовательной модели (один груз за раз)
// проверка «влезает ли груз» — арифметика. Как только появляется сборный рейс,
// вопрос меняется: важна не масса груза, а масса ВСЕХ грузов, которые сейчас
// едут, на каждом участке между погрузками и выгрузками. Именно здесь ловятся
// ошибки вида «два по 12 тонн в 20-тонник, потому что каждый по отдельности
// влезает».

import type { CapacityUse, LoadOrder, Vehicle } from "./types"

export interface CapacityProfile {
  perSegment: CapacityUse[]
  feasible: boolean
  /** Первое превышение — словами, чтобы экран объяснил отказ */
  violation: string | null
  /**
   * Что осталось непроверенным: у груза не указана масса или объём.
   *
   * Раньше неизвестное молча считалось нулём, и профиль выглядел «влезает» с
   * уверенностью, которой нет. Ноль в арифметике остаётся (иначе груз нельзя
   * посчитать вообще), но факт неизвестности обязан доехать до экрана.
   */
  unknown: string[]
}

export interface CapacityStep {
  kind: "load" | "unload"
  orderId: string
}

export interface CapacityCheck {
  feasible: boolean
  /** Доказательство: порядок операций, при котором вместимость не превышена */
  order: CapacityStep[] | null
  /** Наибольшая загрузка на участках этого порядка */
  peakKg: number
  peakM3: number
  /** Чего не хватает в исходных данных, чтобы проверка была полной */
  unknown: string[]
  /** Почему нельзя — словами */
  violation: string | null
}

/** Ограничения машины и настройки организации для проверки исполнимости. */
export interface CapacityLimits {
  /** Сколько грузов может ехать одновременно (настройка организации) */
  maxConcurrent?: number | null
}

/**
 * Проверка «эти грузы можно перевезти одной машиной в одном рейсе».
 *
 * Ставит вопрос правильно: не «сумма масс меньше вместимости», а «существует
 * ли порядок погрузок и выгрузок, при котором в кузове в каждый момент не
 * больше вместимости». Разница не теоретическая: два груза по 4 т в 5-тонник
 * по сумме не проходят (8 т), а рейс исполнимо — взял первый, выгрузил, взял
 * второй. Раньше такие наборы выбрасывались до расчёта.
 *
 * Решение точное, не эвристика: перебираются состояния «что уже погружено /
 * что уже выгружено» (3^n состояний, при n ≤ 6 это 729), и для каждого
 * проверяется, можно ли дойти до конца, не превысив вместимость. Если путь
 * найден — он же служит доказательством (порядок возвращается в `order`).
 */
export function canCarryTogether(
  orders: LoadOrder[],
  vehicle: Vehicle,
  limits: CapacityLimits = {},
): CapacityCheck {
  const n = orders.length
  const unknown: string[] = []
  for (const order of orders) {
    if (order.weightKg === null || order.weightKg === undefined) {
      unknown.push(`масса груза ${order.id} не указана — проверка по массе неполная`)
    }
    if (order.volumeM3 === null || order.volumeM3 === undefined) {
      unknown.push(`объём груза ${order.id} не указан — проверка по объёму неполная`)
    }
  }
  const empty: CapacityCheck = {
    feasible: true,
    order: [],
    peakKg: 0,
    peakM3: 0,
    unknown,
    violation: null,
  }
  if (n === 0) return empty
  if (n > 20) {
    // 3^n состояний: за этим пределом проверка не «точная», а долгая, и
    // выдавать её за доказательство нельзя.
    return {
      ...empty,
      feasible: false,
      violation: "слишком много грузов для точной проверки вместимости",
    }
  }

  const kg = orders.map((order) => order.weightKg ?? 0)
  const m3 = orders.map((order) => order.volumeM3 ?? 0)
  const maxConcurrent =
    limits.maxConcurrent === null || limits.maxConcurrent === undefined
      ? null
      : Math.max(1, Math.floor(limits.maxConcurrent))

  // Быстрый путь: если и суммарно всё влезает, и грузов не больше разрешённого
  // числа, порядок искать незачем — любой порядок исполнимо. Это самая частая
  // ситуация в отборе наборов.
  const sumKg = kg.reduce((sum, value) => sum + value, 0)
  const sumM3 = m3.reduce((sum, value) => sum + value, 0)
  const allTogether =
    sumKg <= vehicle.capacityKg + 1e-6 &&
    (vehicle.capacityM3 <= 0 || sumM3 <= vehicle.capacityM3 + 1e-6) &&
    (maxConcurrent === null || n <= maxConcurrent)
  if (allTogether) {
    const order: CapacityStep[] = []
    for (const item of orders) order.push({ kind: "load", orderId: item.id })
    for (const item of orders) order.push({ kind: "unload", orderId: item.id })
    return { feasible: true, order, peakKg: sumKg, peakM3: sumM3, unknown, violation: null }
  }

  const full = (1 << n) - 1

  const limitOf = (picked: number, done: number) => {
    let sumKgHere = 0
    let sumM3Here = 0
    let count = 0
    for (let i = 0; i < n; i += 1) {
      const bit = 1 << i
      if (picked & bit && !(done & bit)) {
        sumKgHere += kg[i]
        sumM3Here += m3[i]
        count += 1
      }
    }
    return { sumKg: sumKgHere, sumM3: sumM3Here, count }
  }

  // Ключ состояния: picked и done лежат в разных половинах числа.
  const keyOf = (picked: number, done: number) => picked * 2 ** n + done
  const failed = new Set<number>()
  const steps: CapacityStep[] = []
  let worst: { kg: number; m3: number; count: number } | null = null

  const dfs = (picked: number, done: number): boolean => {
    if (picked === full && done === full) return true
    const key = keyOf(picked, done)
    if (failed.has(key)) return false
    for (let i = 0; i < n; i += 1) {
      const bit = 1 << i
      const canLoad = !(picked & bit)
      const canUnload = Boolean(picked & bit) && !(done & bit)
      const kind: CapacityStep["kind"] | null = canLoad ? "load" : canUnload ? "unload" : null
      if (!kind) continue
      const nextPicked = kind === "load" ? picked | bit : picked
      const nextDone = kind === "unload" ? done | bit : done
      const use = limitOf(nextPicked, nextDone)
      const overKg = use.sumKg > vehicle.capacityKg + 1e-6
      const overM3 = vehicle.capacityM3 > 0 && use.sumM3 > vehicle.capacityM3 + 1e-6
      const overCount = maxConcurrent !== null && use.count > maxConcurrent
      if (overKg || overM3 || overCount) {
        if (!worst || use.sumKg > worst.kg) {
          worst = { kg: use.sumKg, m3: use.sumM3, count: use.count }
        }
        continue
      }
      steps.push({ kind, orderId: orders[i].id })
      if (dfs(nextPicked, nextDone)) return true
      steps.pop()
    }
    failed.add(key)
    return false
  }

  const feasible = dfs(0, 0)
  if (feasible) {
    // Пик по найденному порядку считаем заново, чтобы он был по факту.
    let picked = 0
    let done = 0
    let peakKg = 0
    let peakM3 = 0
    for (const step of steps) {
      const index = orders.findIndex((order) => order.id === step.orderId)
      const bit = 1 << index
      if (step.kind === "load") picked |= bit
      else done |= bit
      const use = limitOf(picked, done)
      peakKg = Math.max(peakKg, use.sumKg)
      peakM3 = Math.max(peakM3, use.sumM3)
    }
    return { feasible: true, order: [...steps], peakKg, peakM3, unknown, violation: null }
  }

  const reason = worst
    ? overReason(worst, vehicle, maxConcurrent)
    : "порядок погрузок и выгрузок, при котором вместимость соблюдается, не существует"
  return { feasible: false, order: null, peakKg: 0, peakM3: 0, unknown, violation: reason }
}

/** Объяснение отказа словами: какое именно ограничение сработало. */
function overReason(
  use: { kg: number; m3: number; count: number },
  vehicle: Vehicle,
  maxConcurrent: number | null,
): string {
  const parts: string[] = []
  if (use.kg > vehicle.capacityKg + 1e-6) {
    parts.push(
      `масса ${Math.round(use.kg / 100) / 10} т при вместимости ` +
        `${Math.round(vehicle.capacityKg / 100) / 10} т`,
    )
  }
  if (vehicle.capacityM3 > 0 && use.m3 > vehicle.capacityM3 + 1e-6) {
    parts.push(`объём ${Math.round(use.m3)} м³ при кузове ${Math.round(vehicle.capacityM3)} м³`)
  }
  if (maxConcurrent !== null && use.count > maxConcurrent) {
    parts.push(`${use.count} груза одновременно при пределе ${maxConcurrent}`)
  }
  return parts.length > 0
    ? `все грузы набора не перевезти за один рейс: ${parts.join(", ")}`
    : "все грузы набора не перевезти за один рейс"
}


export interface CapacityMove {
  kind: "load" | "unload"
  order: LoadOrder
}

/**
 * Профиль загрузки по ходу маршрута.
 *
 * `moves` — последовательность погрузок и выгрузок в порядке исполнения.
 * Профиль пересчитывается после каждого события: это и есть «на любом участке
 * не больше вместимости».
 */
export function capacityProfile(moves: CapacityMove[], vehicle: Vehicle): CapacityProfile {
  const perSegment: CapacityUse[] = []
  const inTruck = new Map<string, LoadOrder>()
  const unknown = new Set<string>()

  const snapshot = (index: number) => {
    let kg = 0
    let m3 = 0
    const items: string[] = []
    for (const order of inTruck.values()) {
      // Неизвестное в арифметике остаётся нулём (иначе счёт невозможен), но
      // перестаёт быть невидимым: см. `unknown` ниже.
      if (order.weightKg === null || order.weightKg === undefined) {
        unknown.add(`масса груза ${order.id} не указана — профиль загрузки проверен не полностью`)
      }
      if (order.volumeM3 === null || order.volumeM3 === undefined) {
        unknown.add(`объём груза ${order.id} не указан — профиль загрузки проверен не полностью`)
      }
      kg += order.weightKg ?? 0
      m3 += order.volumeM3 ?? 0
      items.push(order.id)
    }
    perSegment.push({ index, kg, m3, items })
  }

  let violation: string | null = null
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index]
    if (move.kind === "load") inTruck.set(move.order.id, move.order)
    else inTruck.delete(move.order.id)
    snapshot(index)
    const use = perSegment[perSegment.length - 1]
    if (violation === null && use.kg > vehicle.capacityKg + 1e-6) {
      violation =
        `на участке ${index + 1} в кузове ${Math.round(use.kg / 1000)} т ` +
        `при вместимости ${Math.round(vehicle.capacityKg / 1000)} т`
    }
    if (violation === null && use.m3 > vehicle.capacityM3 + 1e-6) {
      violation =
        `на участке ${index + 1} в кузове ${Math.round(use.m3)} м³ ` +
        `при вместимости ${Math.round(vehicle.capacityM3)} м³`
    }
  }

  return { perSegment, feasible: violation === null, violation, unknown: [...unknown] }
}
