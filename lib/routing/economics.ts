// lib/routing/economics.ts
//
// Economics Engine: сколько остаётся по статьям и без двойного учёта.
//
// Прежний расчёт «выручка − топливо − работа машины (24 ₽/км)» был удобен, но
// прятал внутри одной цифры всё: водителя, износ, шины, платные дороги. Из-за
// этого нельзя было ни увидеть причину, ни настроить под свою компанию, ни
// заметить, что простой под дату загрузки не стоит ничего, хотя водителю платят.
//
// Здесь каждая статья — владелец ровно одной строки:
//   топливо   — только из расхода и цены литра;
//   водитель  — только из правила оплаты организации (смена / км / час / рейс / смешанная);
//   износ, ТО, шины, платные, прочие — только из ₽/км;
//   постоянные — в отдельной строке «сколько рейс покрывает», НЕ вычитаются.
//
// Исключение — правило `includedInPerKm`: когда организация не разделяет
// водителя и машину, отдельной статьи водителя не появляется. Иначе 24 ₽/км
// FleetSettings посчитались бы и как «работа машины», и как «водитель».
//
// Проверка на двойной учёт — тест «убери статью, сумма изменится ровно на неё».

import type { CostProfile, Economics, PayRule, Schedule } from "./types"

export interface EconomicsInput {
  revenue: number
  totalKm: number
  loadedKm: number
  /** Литры по участкам: гружёные и порожние считаются по-разному */
  fuelLiters: number
  /** Сколько потрачено на платных участках; null — данных нет */
  tollsRub: number | null
  schedule: Pick<
    Schedule,
    "drivingHours" | "waitingHours" | "handlingHours" | "shifts" | "startAt" | "endAt"
  >
  cost: CostProfile
}

/** Часы работы водителя за рейс: движение + погрузка/выгрузка + ожидание. */
export function workingHours(schedule: EconomicsInput["schedule"]): number {
  return schedule.drivingHours + schedule.handlingHours + schedule.waitingHours
}

/** Оплата водителя по правилу КОНКРЕТНОЙ организации. */
export function driverPay(rule: PayRule, input: EconomicsInput): number {
  switch (rule.kind) {
    case "perShift":
      return Math.round(rule.perShift * Math.max(1, input.schedule.shifts))
    case "perKm":
      return Math.round(rule.perKm * input.totalKm)
    case "perHour":
      return Math.round(rule.perHour * workingHours(input.schedule))
    case "perTrip":
      return Math.round(rule.perTrip)
    case "mixed":
      return Math.round(
        rule.basePerShift * Math.max(1, input.schedule.shifts) + rule.perKm * input.totalKm,
      )
    case "includedInPerKm":
      return 0
    default:
      return 0
  }
}

export function computeEconomics(input: EconomicsInput): Economics {
  const cost = input.cost
  const emptyKm = Math.max(0, input.totalKm - input.loadedKm)
  const fuelRub = Math.round(input.fuelLiters * cost.fuelPricePerL)
  const driverRub = driverPay(cost.driverPay, input)
  const maintenanceRub = Math.round(cost.maintenancePerKm * input.totalKm)
  const tiresRub = Math.round(cost.tiresPerKm * input.totalKm)
  const otherRub = Math.round(cost.otherPerKm * input.totalKm)
  const tollsRub = input.tollsRub

  const days = Math.max(
    1,
    Math.ceil((input.schedule.endAt.getTime() - input.schedule.startAt.getTime()) / 86400000),
  )
  const fixedContributionRub = Math.round(cost.fixedPerDay * days)

  const unknown: string[] = []
  // Платные дороги: если данных нет, не выдумываем — говорим, что не знаем.
  if (tollsRub === null && cost.tollsPerKm > 0) {
    unknown.push("платные участки не размечены — в остатке их нет")
  }
  const tolls = tollsRub ?? 0

  const netRub = Math.round(
    input.revenue - fuelRub - driverRub - maintenanceRub - tiresRub - tolls - otherRub,
  )

  return {
    revenue: Math.round(input.revenue),
    fuelRub,
    driverRub,
    maintenanceRub,
    tiresRub,
    tollsRub,
    otherRub,
    fixedContributionRub,
    netRub,
    netCommittedRub: netRub,
    netPerKm: input.totalKm > 0 ? Math.round(netRub / input.totalKm) : null,
    netPerHour:
      input.schedule.endAt.getTime() > input.schedule.startAt.getTime()
        ? Math.round(
            netRub /
              ((input.schedule.endAt.getTime() - input.schedule.startAt.getTime()) / 3600000),
          )
        : null,
    // Пробег складывается ровно: порожний — это остаток после гружёного, а не
    // независимо округлённая величина. Иначе на длинном рейсе сумма частей
    // расходится с целым на километр — и независимая проверка справедливо
    // ругается «пробег ≠ гружёный + порожний».
    ...(() => {
      const whole = Math.round(input.totalKm)
      const loaded = Math.min(Math.round(input.loadedKm), whole)
      return { totalKm: whole, loadedKm: loaded, emptyKm: whole - loaded }
    })(),
    emptyShare: input.totalKm > 0 ? Math.round((emptyKm / input.totalKm) * 100) / 100 : 0,
    unknown,
  }
}
