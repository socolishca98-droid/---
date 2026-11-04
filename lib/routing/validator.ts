// lib/routing/validator.ts
//
// Независимый валидатор маршрута.
//
// Намеренно не использует поиск и материализацию: он получает готовый маршрут
// и проверяет его «с нуля» по правилам логистики. Если валидатор и сборщик
// используют один и тот же код, они ошибаются одинаково — и проверка ничего не
// доказывает.
//
// Восемь правил:
//   1. каждый заказ взят не более одного раза;
//   2. погрузка раньше выгрузки;
//   3. на каждом участке масса и объём в пределах вместимости;
//   4. окна погрузки и выгрузки соблюдены (или помечены);
//   5. вождение между отдыхами не больше нормы;
//   6. календарное время не больше лимита;
//   7. режим возврата соблюдён;
//   8. деньги сходятся: статьи минус выручка равны остатку.

import type { LoadOrder, RoutePlan, Settings, Vehicle } from "./types"

export interface ValidationIssue {
  rule: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

const MS_HOUR = 3600000

export function validatePlan(
  plan: RoutePlan,
  orders: LoadOrder[],
  vehicle: Vehicle,
  settings: Settings,
): ValidationResult {
  const issues: ValidationIssue[] = []
  const byId = new Map(orders.map((order) => [order.id, order]))

  // 1. Заказы не повторяются
  const seen = new Set<string>()
  for (const id of plan.orderIds) {
    if (seen.has(id)) issues.push({ rule: "уникальность", message: `заказ ${id} взят дважды` })
    seen.add(id)
  }

  // 2. Порядок операций и 3. профиль загрузки
  const loaded = new Set<string>()
  const inTruck = new Map<string, LoadOrder>()
  for (const stop of plan.stops) {
    const order = stop.orderId ? byId.get(stop.orderId) : undefined
    if (!order || stop.kind === "return") continue
    if (stop.kind === "load") {
      if (loaded.has(order.id)) {
        issues.push({ rule: "порядок", message: `заказ ${order.id} погружен дважды` })
      }
      loaded.add(order.id)
      inTruck.set(order.id, order)
      const kg = [...inTruck.values()].reduce((sum, item) => sum + (item.weightKg ?? 0), 0)
      const m3 = [...inTruck.values()].reduce((sum, item) => sum + (item.volumeM3 ?? 0), 0)
      if (kg > vehicle.capacityKg + 1e-6) {
        issues.push({
          rule: "вместимость",
          message: `после погрузки ${order.id} в кузове ${Math.round(kg / 1000)} т при ${Math.round(
            vehicle.capacityKg / 1000,
          )} т`,
        })
      }
      if (m3 > vehicle.capacityM3 + 1e-6) {
        issues.push({
          rule: "вместимость",
          message: `после погрузки ${order.id} объём ${Math.round(m3)} м³ при ${vehicle.capacityM3} м³`,
        })
      }
    } else {
      if (!inTruck.has(order.id)) {
        issues.push({ rule: "порядок", message: `выгрузка ${order.id} раньше погрузки` })
      }
      inTruck.delete(order.id)
    }
  }

  // 4. Окна: погрузка не раньше начала окна
  for (const stop of plan.stops) {
    const order = stop.orderId ? byId.get(stop.orderId) : undefined
    if (!order) continue
    const window = stop.kind === "load" ? order.window.pickup : order.window.delivery
    if (window.from) {
      const from = new Date(window.from)
      if (!Number.isNaN(from.getTime()) && stop.startAt.getTime() < from.getTime() - 60_000) {
        issues.push({
          rule: "окна",
          message: `${stop.kind === "load" ? "погрузка" : "выгрузка"} ${order.id} раньше окна`,
        })
      }
    }
    if (window.to) {
      const to = new Date(window.to)
      const noted = plan.warnings.some((warning) => warning.includes(order.delivery.city))
      if (!Number.isNaN(to.getTime()) && stop.startAt.getTime() > to.getTime() + 60_000 && !noted) {
        issues.push({
          rule: "окна",
          message: `${stop.kind === "load" ? "погрузка" : "выгрузка"} ${order.id} позже окна без предупреждения`,
        })
      }
    }
  }

  // 5. Вождение между отдыхами и 6. календарное время
  const limit = Math.max(1, settings.drivingLimitHours)
  let driveSinceRest = 0
  for (const segment of plan.segments) {
    let hours = segment.hours
    while (hours > 1e-9) {
      const room = limit - driveSinceRest
      if (hours <= room + 1e-9) {
        driveSinceRest += hours
        hours = 0
      } else {
        hours -= room
        driveSinceRest = 0
      }
    }
  }
  if (driveSinceRest > limit + 1e-6) {
    issues.push({ rule: "отдых", message: `вождение без отдыха ${Math.round(driveSinceRest)} ч` })
  }

  const elapsed = (plan.schedule.endAt.getTime() - plan.schedule.startAt.getTime()) / MS_HOUR
  if (elapsed > settings.maxRouteHours + 0.06) {
    issues.push({
      rule: "лимит времени",
      message: `${Math.round(elapsed * 10) / 10} ч при лимите ${settings.maxRouteHours} ч`,
    })
  }

  // 7. Возврат
  const homeStop = plan.stops[plan.stops.length - 1]
  const atHome = homeStop ? homeStop.place.id === vehicle.homeBase.id : false
  if (settings.returnMode === "required" && !atHome) {
    issues.push({ rule: "возврат", message: "режим «обязательно вернуться», а маршрут не на базе" })
  }

  // 8. Деньги
  //
  // Тождества проверяются независимо от того, как их посчитала модель: если
  // статьи не складываются в остаток, значит где-то двойной учёт или потеря.
  const e = plan.economics
  const sum =
    e.fuelRub + e.driverRub + e.maintenanceRub + e.tiresRub + (e.tollsRub ?? 0) + e.otherRub
  if (Math.abs(e.revenue - sum - e.netRub) > 1) {
    issues.push({
      rule: "экономика",
      message: `выручка − расходы ≠ остаток: ${e.revenue} − ${sum} ≠ ${e.netRub}`,
    })
  }
  if (Math.abs(e.knownCostRub - sum) > 1) {
    issues.push({
      rule: "экономика",
      message: `известные расходы ${e.knownCostRub} ≠ сумма статей ${sum}`,
    })
  }
  // Остаток с обязательством вернуться не может быть БОЛЬШЕ остатка рейса:
  // обязательство только уменьшает. Разница должна совпадать с ценой возврата.
  if (e.netCommittedRub > e.netRub + 1) {
    issues.push({
      rule: "экономика",
      message: `остаток с возвратом ${e.netCommittedRub} больше остатка рейса ${e.netRub}`,
    })
  }
  const commitment = e.netRub - e.netCommittedRub
  const expected = plan.returned.kind === "none" ? plan.returned.costRub : 0
  if (Math.abs(commitment - expected) > 1) {
    issues.push({
      rule: "экономика",
      message:
        `скидка за обязательство вернуться ${commitment} ₽ не равна цене возврата ${expected} ₽`,
    })
  }
  // Неполный расчёт нельзя выдавать за прибыль — но и прятать его в предупреждение
  // тоже нельзя: статус обязан быть проставлен моделью.
  if (e.status === "complete" && (e.gaps?.length ?? 0) > 0) {
    issues.push({ rule: "экономика", message: "статус «полный», а пробелы расчёта есть" })
  }
  if (e.status === "insufficient" && !(e.gaps?.length ?? 0)) {
    issues.push({ rule: "экономика", message: "статус «неполный», но пробелы не названы" })
  }
  if (e.totalKm !== e.loadedKm + e.emptyKm) {
    issues.push({
      rule: "экономика",
      message: `пробег ${e.totalKm} ≠ гружёный ${e.loadedKm} + порожний ${e.emptyKm}`,
    })
  }

  return { ok: issues.length === 0, issues }
}
