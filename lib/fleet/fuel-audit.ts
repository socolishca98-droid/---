// lib/fleet/fuel-audit.ts
//
// Сверка топлива: чеки водителя (расходы рейса с литрами) против оценочного
// расхода рейса. Оценка — из паспорта машины и загрузки (lib/fleet/fuel.ts),
// факт — из литров, которые водитель указал в расходах. Расхождение сверх
// допуска — флаг логисту: проверить чек, одометр или слив.

/** Допуск расхождения факта и оценки, процентов: в пределах — норма. */
export const FUEL_AUDIT_TOLERANCE_PCT = 20

/** Меньше этого объёма чеков сверку не делаем: шум заправки «до горловины». */
export const FUEL_AUDIT_MIN_LITERS = 20

export interface FuelExpenseLike {
  type: string
  liters: number | null
}

/** Фактические литры топлива по расходам рейса (только строки с литрами). */
export function factFuelLiters(expenses: readonly FuelExpenseLike[]): number | null {
  let total = 0
  let hasLiters = false
  for (const expense of expenses) {
    if (expense.type !== "fuel") continue
    const liters = Number(expense.liters)
    if (expense.liters === null || expense.liters === undefined || !Number.isFinite(liters)) {
      continue
    }
    total += liters
    hasLiters = true
  }
  if (!hasLiters) return null
  return Math.round(total * 10) / 10
}

/** Расхождение факта и оценки в процентах: плюс — перерасход. */
export function fuelAuditDiffPct(factL: number | null, estimatedL: number | null): number | null {
  if (factL === null || estimatedL === null || estimatedL <= 0) return null
  return Math.round(((factL - estimatedL) / estimatedL) * 100)
}

/** Флаг перерасхода: расхождение вне допуска и факт не крошечный. */
export function fuelAuditFlag(factL: number | null, estimatedL: number | null): boolean {
  const diff = fuelAuditDiffPct(factL, estimatedL)
  if (diff === null || factL === null) return false
  if (factL < FUEL_AUDIT_MIN_LITERS) return false
  return Math.abs(diff) > FUEL_AUDIT_TOLERANCE_PCT
}
