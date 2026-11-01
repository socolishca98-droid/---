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

  const snapshot = (index: number) => {
    let kg = 0
    let m3 = 0
    const items: string[] = []
    for (const order of inTruck.values()) {
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

  return { perSegment, feasible: violation === null, violation }
}
