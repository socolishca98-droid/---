// lib/pricing/format.ts
//
// Как цена выглядит на экране — одни и те же слова везде.
//
// Зачем отдельно от React: текст «сколько стоит перевозка» проверяется тестами
// дословно. Требование простое и жёсткое — ноль рублей никогда не показывается
// как стоимость, а расчётная цена всегда подписана как расчётная.

import type { EstimateConfidence, PriceStatus } from "../routing/types"

export interface PriceLike {
  status: PriceStatus
  amountRub: number | null
  raw?: unknown
  note?: string
  source?: string
  /**
   * Себестоимость рейса по расходам организации — нижняя граница.
   * Это НЕ рыночная цена, поэтому показывается отдельной строкой и никогда
   * не подставляется вместо оценки.
   */
  costFloorRub?: number | null
}

export interface EstimateLike {
  amountRub: number
  lowRub: number | null
  highRub: number | null
  perKmRub: number | null
  confidence: EstimateConfidence
  samples: number
  sources: string[]
  basis: string
  measuredAt: string | null
  currency: string
  costFloorRub: number | null
}

export interface PriceDisplay {
  /** Что показываем в верхней строке карточки */
  headline: string
  /** Подпись статуса под суммой */
  statusLabel: string
  /** Пояснения: диапазон, ₽/км, число аналогов, дата данных, источник */
  details: string[]
  /** Можно ли называть это деньгами (для экономики — только true) */
  confirmed: boolean
  /** Есть ли вообще число, которое можно показать */
  hasAmount: boolean
}

const rub = (value: number): string =>
  `${new Intl.NumberFormat("ru-RU").format(Math.round(value))} ₽`

export const SOURCE_LABELS: Record<string, string> = {
  history: "собственная история цен организации",
  "ati-same-direction": "предложения ATI на этом направлении",
  "ati-nearby": "близкие направления ATI с поправкой на километры",
  "cost-model": "экономическая модель расходов Loginex",
}

export const CONFIDENCE_LABELS: Record<EstimateConfidence, string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
}

/** Строка «данные от 03.11.2026». */
export function formatMeasuredAt(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return `данные от ${date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })}`
}

/**
 * Текст цены для карточки.
 *
 * Три честных случая:
 *   1. цена есть в источнике — показываем сумму и «подтверждённая стоимость»;
 *   2. цены нет, но есть аналоги — показываем «ориентировочно» с диапазоном,
 *      числом аналогов, датой данных, источником и уверенностью;
 *   3. данных нет — «Недостаточно данных для достоверной оценки» и НИКАКОЙ
 *      суммы. Ноль рублей в этом случае не показывается.
 */
export function describePrice(price: PriceLike, estimate?: EstimateLike | null): PriceDisplay {
  if (price.status === "CONFIRMED" && typeof price.amountRub === "number" && price.amountRub > 0) {
    return {
      headline: rub(price.amountRub),
      statusLabel: "Подтверждённая стоимость",
      details: [],
      confirmed: true,
      hasAmount: true,
    }
  }

  if (estimate && estimate.amountRub > 0) {
    const details: string[] = []
    // 1. Что было в источнике — прямым текстом. Логист должен видеть, что
    // «0 ₽» на бирже означает «не указана», а не «бесплатно».
    details.push(
      price.status === "UNKNOWN"
        ? `Стоимость ATI.SU: не распознана (${price.note || "значение не читается"})`
        : price.status === "ESTIMATED"
          ? "Стоимость ATI.SU: не указана — ниже расчёт Loginex"
          : "Стоимость ATI.SU: не указана",
    )
    // 2. Рыночный ориентир и 3. расчётная цена (она в заголовке).
    if (estimate.lowRub !== null && estimate.highRub !== null) {
      details.push(`ориентировочная рыночная стоимость: ${rub(estimate.lowRub)} — ${rub(estimate.highRub)}`)
    } else {
      details.push("диапазона нет: аналогов слишком мало, чтобы его показать")
    }
    if (estimate.perKmRub !== null) details.push(`расчётная цена: ${estimate.perKmRub} ₽/км`)
    // 4. На чём основано.
    details.push(
      estimate.samples === 1
        ? "основание: 1 аналогичная перевозка"
        : `основание: ${estimate.samples} аналогичных перевозок`,
    )
    if (estimate.basis) details.push(estimate.basis)
    const date = formatMeasuredAt(estimate.measuredAt)
    if (date) details.push(date)
    const sources = estimate.sources
      .map((item) => SOURCE_LABELS[item] ?? item)
      .join(", ")
    if (sources) details.push(`источник: ${sources}`)
    // 5. Качество оценки.
    details.push(`уверенность: ${CONFIDENCE_LABELS[estimate.confidence]}`)
    if (estimate.costFloorRub && estimate.amountRub < estimate.costFloorRub) {
      details.push(
        `это ниже себестоимости рейса (${rub(estimate.costFloorRub)}) — такой рейс убыточен`,
      )
    }
    // 6. Что с этим делать. Расчёт — не деньги, пока его не подтвердили.
    details.push("статус: требуется подтверждение по телефону")

    return {
      headline: `≈ ${rub(estimate.amountRub)}`,
      statusLabel: "Расчётная стоимость Loginex — по аналогичным перевозкам",
      details,
      confirmed: false,
      hasAmount: true,
    }
  }

  // Данных для оценки нет. Никакой суммы «на глазок» — но если известна
  // себестоимость рейса, она называется прямо и отдельно: это нижняя
  // граница расходов организации, а не рыночная цена (источник 4 из ТЗ,
  // применённый честно). Сумму в заголовок она не даёт.
  const floor = price.costFloorRub && price.costFloorRub > 0 ? price.costFloorRub : null
  const details =
    price.status === "UNKNOWN"
      ? ["цена в источнике не читается — уточните её по телефону, калькулятор её не выдумывает"]
      : ["аналогов на направлении нет — позвоните фрахтователю и введите фактическую стоимость"]
  if (floor) {
    details.push(
      `по расходам организации такой рейс стоит не меньше ${rub(floor)} — это себестоимость, а не рыночная цена`,
    )
  }

  return {
    headline: price.status === "UNKNOWN" ? "Стоимость не распознана" : "Стоимость не указана",
    statusLabel:
      price.status === "UNKNOWN"
        ? price.note || "Стоимость не распознана"
        : "Недостаточно данных для достоверной оценки",
    details,
    confirmed: false,
    hasAmount: false,
  }
}

/** Подпись статуса дохода в экономике маршрута. */
export function revenueStatusLabel(
  status: "confirmed" | "partly-estimated" | "unconfirmed",
): string {
  switch (status) {
    case "confirmed":
      return "Доход подтверждён"
    case "partly-estimated":
      return "Доход частично расчётный"
    case "unconfirmed":
      return "Доход не подтверждён — это расчёт, а не деньги"
  }
}

/**
 * Честная подпись, когда звонить не по чему.
 *
 * Для оценки направления контактов не бывает вовсе: предложений нет, а значит
 * нет и телефона. Придумать его нельзя — ATI.SU запрещает автоматический сбор
 * контактов, да и звонить по выдуманному номеру некуда.
 */
export function contactlessNote(reason: "no-offers" | "no-phone"): string {
  return reason === "no-offers"
    ? "Контактов нет: на этом направлении ATI.SU не вернула ни одного предложения. " +
        "Позвоните заказчику, если он вам известен, и внесите фактическую стоимость — она заменит расчёт."
    : "Контактов в предложении нет — номер нужно найти в ATI вручную."
}
