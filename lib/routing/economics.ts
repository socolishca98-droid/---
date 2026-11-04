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
// Два остатка, и оба считаются ЗДЕСЬ:
//   netRub          — выручка минус известные расходы рейса, как он исполняется;
//   netCommittedRub — то же минус стоимость обязательства вернуть машину на базу.
// По второму выбирается вариант (оптимизатор, API) и его же показывает экран.
// Раньше netCommittedRub присваивался в builder.ts уже после расчёта, и любой
// другой вызывающий получал `netCommittedRub = netRub` — то есть «уехать и не
// вернуться» всегда выглядело прибыльнее на цену возврата.
//
// Неизвестное не превращается в ноль. Если статью посчитать нельзя, она
// попадает в `gaps` с причиной, а `status` честно говорит, можно ли называть
// netRub прибылью: complete / preliminary / insufficient.
//
// Проверка на двойной учёт — тест «убери статью, сумма изменится ровно на неё».

import type { CostGap, CostProfile, Economics, PayRule, Schedule } from "./types"

export interface EconomicsInput {
  revenue: number
  /**
   * Из этой суммы — подтверждённая часть, ₽.
   *
   * Не задано — вся сумма считается подтверждённой (совместимость со старыми
   * вызовами). Но там, где цена известна лишь расчётом Loginex, заполняется
   * именно подтверждённая часть, и остаток честно называется предварительным.
   */
  revenueConfirmed?: number
  totalKm: number
  loadedKm: number
  /** Литры по участкам: гружёные и порожние считаются по-разному */
  fuelLiters: number
  /** Сколько потрачено на платных участках; null — данных нет */
  tollsRub: number | null
  /**
   * Сколько стоит обязательство вернуть машину на базу, ₽.
   * 0 или не задано — возврата не требуется (или он уже входит в рейс).
   */
  returnCommitmentRub?: number
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
      // Водитель внутри ставки ₽/км — отдельной статьёй его нет.
      return 0
    case "unknown":
      return 0
    default:
      return 0
  }
}

/**
 * Пробелы денежного расчёта.
 *
 * Складываются из двух источников: того, чего не было в настройках (их знает
 * адаптер и кладёт в `cost.gaps`), и того, что выяснилось только при расчёте
 * (например, километры есть, а разметки платных дорог нет).
 */
export function economicsGaps(input: EconomicsInput, driverRub: number): CostGap[] {
  const gaps: CostGap[] = [...(input.cost.gaps ?? [])]

  if (input.cost.driverPay.kind === "unknown") {
    gaps.push({
      article: "водитель",
      reason: "правило оплаты водителя в организации не задано — в остатке его нет",
      estimateRub: null,
      inNet: false,
    })
  }
  // Правило задано, но оплата вышла нулевой при ненулевом пробеге — это тоже
  // повод сказать вслух, а не показывать «водитель 0 ₽» как факт.
  if (
    input.cost.driverPay.kind !== "unknown" &&
    input.cost.driverPay.kind !== "includedInPerKm" &&
    driverRub === 0 &&
    input.totalKm > 0
  ) {
    gaps.push({
      article: "водитель",
      reason: "по заданному правилу оплата водителя за этот рейс получилась 0 ₽ — проверьте ставку",
      estimateRub: null,
      inNet: true,
    })
  }

  // Доход: расчётная часть — тоже «пробел», потому что это не деньги, а
  // ожидание. Остаток по такому рейсу нельзя называть прибылью, а значит
  // расчёт неполный, хотя все расходы известны. `inNet: true`: сама сумма
  // учтена в остатке — вычитать её второй раз нельзя.
  const revenue = input.revenue
  const revenueConfirmed = Math.max(0, Math.min(input.revenueConfirmed ?? revenue, revenue))
  if (revenue - revenueConfirmed > 0) {
    gaps.push({
      article: "доход",
      reason:
        revenueConfirmed > 0
          ? `часть дохода (${Math.round(revenue - revenueConfirmed)} ₽) — расчётная цена, заказчик её не подтверждал`
          : "доход по рейсу — расчётная цена: подтверждённой ставки нет",
      estimateRub: null,
      inNet: true,
    })
  }

  if (input.tollsRub === null && input.cost.tollsPerKm > 0) {
    // Разметки платных участков нет. Оценку сверху дать можно — она и
    // показывается, но в остаток НЕ подставляется: это верхняя граница, а не
    // расход. Поэтому статус будет «неполный», а не «предварительный».
    gaps.push({
      article: "платные дороги",
      reason: "платные участки не размечены — в остатке их нет",
      estimateRub: Math.round(input.cost.tollsPerKm * input.totalKm),
      inNet: false,
    })
  }

  return gaps
}

/** Статус полноты по пробелам: единственное правило, без исключений. */
export function costStatus(gaps: CostGap[]): Economics["status"] {
  if (gaps.length === 0) return "complete"
  return gaps.every((gap) => gap.inNet) ? "preliminary" : "insufficient"
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

  const gaps = economicsGaps(input, driverRub)
  const tolls = tollsRub ?? 0

  const knownCostRub = fuelRub + driverRub + maintenanceRub + tiresRub + tolls + otherRub
  const netRub = Math.round(input.revenue - knownCostRub)
  // Разделение дохода: подтверждённое — деньги, расчётное — ожидание.
  const revenueWhole = Math.round(input.revenue)
  const revenueConfirmed = Math.round(
    Math.max(0, Math.min(input.revenueConfirmed ?? input.revenue, input.revenue)),
  )
  const revenueEstimated = Math.max(0, revenueWhole - revenueConfirmed)
  // Нулевой доход не бывает «подтверждённым»: подтверждать нечего. Иначе
  // рейс без единого груза с ценой выглядел бы полностью проверенным.
  const revenueStatus: Economics["revenueStatus"] =
    revenueWhole <= 0
      ? "unconfirmed"
      : revenueEstimated === 0
        ? "confirmed"
        : revenueConfirmed > 0
          ? "partly-estimated"
          : "unconfirmed"
  const returnCommitmentRub = Math.max(0, Math.round(input.returnCommitmentRub ?? 0))
  const netCommittedRub = netRub - returnCommitmentRub

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
    netCommittedRub,
    // ₽/км и ₽/ч — по тому же числу, по которому выбирается вариант. Иначе
    // «лучший по ₽/км» и «лучший по остатку» оказываются разными рейсами.
    netPerKm: input.totalKm > 0 ? Math.round(netCommittedRub / input.totalKm) : null,
    netPerHour:
      input.schedule.endAt.getTime() > input.schedule.startAt.getTime()
        ? Math.round(
            netCommittedRub /
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
    unknown: gaps.map((gap) =>
      gap.inNet ? `${gap.article}: ${gap.reason}` : `${gap.article}: ${gap.reason} (не вычтено)`,
    ),
    knownCostRub,
    gaps,
    status: costStatus(gaps),
    revenueConfirmed,
    revenueEstimated,
    revenueStatus,
    // Прибыль «зависит от расчётной цены», если она за счёт неподтверждённых
    // денег. Убыток от расчётной цены не зависит по определению — но он и не
    // называется прибылью, поэтому отдельного флага не требует.
    profitDependsOnEstimate: revenueEstimated > 0 && netCommittedRub > 0,
  }
}
