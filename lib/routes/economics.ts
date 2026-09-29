// lib/routes/economics.ts
//
// Экономика рейса: сколько рейс принёс денег на километр и сколько стоил.
// Факт — по проведенным расходам рейса; пока расходов нет, стоимость
// оценивается топливом (паспорт машины × пробег × загрузка × цена литра
// из топливных чеков). Убыточные рейсы и плечи подсвечиваются.

import { estimateFuelL, loadFactor } from "@/lib/fleet/fuel"

export interface EconomicsExpenseLike {
  type: string
  amount: number | null
  liters: number | null
}

/**
 * Цена литра из топливных чеков: сумма к литрам. Без чеков с литрами —
 * null: программу не устраивает «средняя по больнице» из воздуха.
 */
export function fuelPriceRubPerL(expenses: readonly EconomicsExpenseLike[]): number | null {
  let rub = 0
  let liters = 0
  for (const expense of expenses) {
    if (expense.type !== "fuel") continue
    const l = Number(expense.liters)
    const a = Number(expense.amount)
    if (!Number.isFinite(l) || l <= 0 || !Number.isFinite(a)) continue
    rub += a
    liters += l
  }
  if (liters <= 0) return null
  return Math.round((rub / liters) * 100) / 100
}

export interface RouteEconomics {
  revenueRub: number
  distanceKm: number
  /** Фактическая стоимость по расходам рейса, null — расходов ещё нет */
  factCostRub: number | null
  /** Оценка стоимости топливом, null — не хватает данных машины или цены */
  estimatedCostRub: number | null
  rubPerKmRevenue: number | null
  costPerKm: number | null
  profitRub: number | null
  /** На чём посчитано: на чеках или на оценке */
  basis: "fact" | "estimate" | null
  unprofitable: boolean
}

export function routeEconomics(params: {
  revenueRub: number
  distanceKm: number
  factCostRub: number | null
  estimatedLiters: number | null
  fuelPriceRubPerL: number | null
}): RouteEconomics {
  const { revenueRub, distanceKm, factCostRub } = params
  const estimatedCostRub =
    params.estimatedLiters !== null && params.fuelPriceRubPerL !== null
      ? Math.round(params.estimatedLiters * params.fuelPriceRubPerL)
      : null

  const cost = factCostRub !== null ? factCostRub : estimatedCostRub
  const basis: RouteEconomics["basis"] =
    factCostRub !== null ? "fact" : estimatedCostRub !== null ? "estimate" : null

  const km = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : null
  return {
    revenueRub,
    distanceKm,
    factCostRub,
    estimatedCostRub,
    rubPerKmRevenue: km !== null ? Math.round(revenueRub / km) : null,
    costPerKm: km !== null && cost !== null ? Math.round(cost / km) : null,
    profitRub: cost !== null ? revenueRub - cost : null,
    basis,
    unprofitable: cost !== null && cost > revenueRub,
  }
}

export interface LegEconomics {
  costRub: number
  profitRub: number
  unprofitable: boolean
}

/** Экономика одного плеча: цена заказа против оценочного топлива плеча. */
export function legEconomics(params: {
  priceRub: number | null
  distanceKm: number | null
  consumptionPer100: number | null
  loadKg: number | null
  capacityKg: number | null
  fuelPriceRubPerL: number | null
}): LegEconomics | null {
  // Number(null) === 0: без явных проверок «нет цены» превратилось бы в «ноль»
  if (params.priceRub === null || params.priceRub === undefined) return null
  if (params.fuelPriceRubPerL === null || params.fuelPriceRubPerL === undefined) return null
  if (params.consumptionPer100 === null || params.consumptionPer100 === undefined) return null
  const price = Number(params.priceRub)
  const distance = Number(params.distanceKm)
  const consumption = Number(params.consumptionPer100)
  const pricePerL = Number(params.fuelPriceRubPerL)
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(distance) || distance <= 0 ||
    !Number.isFinite(consumption) || consumption <= 0 ||
    !Number.isFinite(pricePerL) || pricePerL <= 0
  ) {
    return null
  }
  const factor = loadFactor(
    { capacity: params.capacityKg ?? null },
    Number(params.loadKg) || 0,
  )
  const liters = (distance / 100) * consumption * factor
  const costRub = Math.round(liters * pricePerL)
  return {
    costRub,
    profitRub: price - costRub,
    unprofitable: costRub > price,
  }
}
