// lib/fuel/ledger.ts
//
// Расчёты топливной ведомости: цена литра по чеку, итоги за период и
// сводка по машинам (факт против оценки). Чистые функции без БД —
// их использует API /api/fuel и тесты.
//
// Правило проекта: Number(null) === 0, поэтому все опциональные числа
// проверяем на null до арифметики.

import { fuelAuditDiffPct, fuelAuditFlag } from "@/lib/fleet/fuel-audit"

export interface LedgerEntryLike {
  amount: number | null
  liters: number | null
}

/** Цена литра по одному чеку; без литров или суммы — null (не «ноль»!). */
export function entryPricePerL(entry: LedgerEntryLike): number | null {
  if (entry.liters === null || !Number.isFinite(entry.liters) || entry.liters <= 0) return null
  if (entry.amount === null || !Number.isFinite(entry.amount)) return null
  return Math.round((entry.amount / entry.liters) * 10) / 10
}

/** Итоги ведомости за период: чеки, литры, рубли, средняя цена литра. */
export function ledgerTotals(entries: readonly LedgerEntryLike[]) {
  let liters = 0
  let amountRub = 0
  let withLiters = false
  for (const entry of entries) {
    if (entry.liters !== null && Number.isFinite(entry.liters)) {
      liters += entry.liters
      withLiters = true
    }
    if (entry.amount !== null && Number.isFinite(entry.amount)) amountRub += entry.amount
  }
  return {
    count: entries.length,
    liters: withLiters ? Math.round(liters * 10) / 10 : null,
    amountRub: Math.round(amountRub),
    pricePerL: withLiters && liters > 0 ? Math.round((amountRub / liters) * 10) / 10 : null,
  }
}

/** Вход сводки по машинам: аудит топлива одного рейса. */
export interface RouteFuelAuditLike {
  vehicleId: string | null
  factL: number | null
  estimatedL: number | null
  amountRub: number
}

export interface VehicleFuelRow {
  vehicleId: string
  routes: number
  liters: number | null
  amountRub: number
  pricePerL: number | null
  estimatedL: number | null
  diffPct: number | null
  flag: boolean
}

/**
 * Сводка по машинам: литры и рубли из чеков, оценка из паспортного расхода
 * и отклонение факта от оценки. Машины без рейсов в выборку не попадают.
 */
export function vehicleRollup(routes: readonly RouteFuelAuditLike[]): VehicleFuelRow[] {
  const byVehicle = new Map<
    string,
    { routes: number; liters: number; withLiters: boolean; amountRub: number; estimated: number; withEstimate: boolean; flagged: number }
  >()

  for (const route of routes) {
    if (!route.vehicleId) continue
    const acc = byVehicle.get(route.vehicleId) ?? {
      routes: 0,
      liters: 0,
      withLiters: false,
      amountRub: 0,
      estimated: 0,
      withEstimate: false,
      flagged: 0,
    }
    acc.routes += 1
    if (route.factL !== null && Number.isFinite(route.factL)) {
      acc.liters += route.factL
      acc.withLiters = true
    }
    if (route.estimatedL !== null && Number.isFinite(route.estimatedL)) {
      acc.estimated += route.estimatedL
      acc.withEstimate = true
    }
    if (Number.isFinite(route.amountRub)) acc.amountRub += route.amountRub
    if (fuelAuditFlag(route.factL, route.estimatedL)) acc.flagged += 1
    byVehicle.set(route.vehicleId, acc)
  }

  const rows: VehicleFuelRow[] = []
  for (const [vehicleId, acc] of byVehicle) {
    const factL = acc.withLiters ? Math.round(acc.liters * 10) / 10 : null
    const estimatedL = acc.withEstimate ? Math.round(acc.estimated * 10) / 10 : null
    const diffPct = fuelAuditDiffPct(factL, estimatedL)
    rows.push({
      vehicleId,
      routes: acc.routes,
      liters: factL,
      amountRub: Math.round(acc.amountRub),
      pricePerL: factL !== null && factL > 0 ? Math.round((acc.amountRub / factL) * 10) / 10 : null,
      estimatedL,
      diffPct,
      // флаг — если отклонение по сумме литров машины превысило допуск
      // или хотя бы один рейс машины уже под флагом
      flag: acc.flagged > 0 || fuelAuditFlag(factL, estimatedL),
    })
  }
  rows.sort((a, b) => Number(b.flag) - Number(a.flag) || b.amountRub - a.amountRub)
  return rows
}
