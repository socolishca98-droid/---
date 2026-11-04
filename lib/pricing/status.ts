// lib/pricing/status.ts
//
// Разбор «сырой» цены из ATI.SU в статус.
//
// Почему это отдельный модуль, а не `Number(price) || 0`:
//
//   · на бирже ноль означает «цена не указана», а не «бесплатно». Раньше ноль
//     попадал в экономику как доход 0, и маршрут выглядел убыточным по причине,
//     которой не существует;
//   · `Number("договорная")` даёт NaN, а `NaN || 0` — снова ноль, то есть
//     нераспознанный формат молча превращался в «бесплатно»;
//   · отрицательная цена — не цена, а ошибка выгрузки;
//   · «0» строкой и `0` числом — одно и то же, а `null` и отсутствие поля —
//     тоже одно и то же: «не указана».
//
// Поэтому здесь одна точка правды: любое значение из ATI превращается в пару
// (статус, сумма) плюс сохраняется исходное значение и источник.

import type { PriceStatus } from "../routing/types"

export type PriceSource = "ati" | "order" | "manual" | "estimate" | "unknown"

export interface ParsedPrice {
  /**
   * Что делать с ценой:
   *   CONFIRMED — положительное число;
   *   NEGOTIATION_REQUIRED — пусто, ноль, «договорная»;
   *   UNKNOWN — значение есть, но понять его нельзя (мусор, отрицательное).
   */
  status: PriceStatus
  /** Сумма в рублях. Для не-CONFIRMED статусов всегда 0 — и это НЕ доход. */
  amountRub: number
  /** Исходное значение, как пришло из источника */
  raw: unknown
  source: PriceSource
  /** Почему цена получила этот статус — словами, для экрана и логов */
  note: string
}

/** Значения, которыми ATI и перевозчики обозначают «цена договорная». */
const NEGOTIABLE_WORDS = [
  "договорн",
  "по договор",
  "торг",
  "обсужда",
  "уточня",
  "звоните",
  "negotiable",
  "upon agreement",
]

const EMPTY_WORDS = ["", "-", "—", "n/a", "na", "null", "undefined", "none", "не указана", "не указано"]

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

/**
 * Разобрать цену из ATI.SU.
 *
 * Правило простое и намеренно строгое: сомнительное значение — не цена.
 * Лучше честно потребовать звонок, чем посчитать экономику по выдуманному нулю.
 */
export function parseRawPrice(input: unknown, source: PriceSource = "ati"): ParsedPrice {
  const raw = input

  // Нет поля, null, undefined, пустая строка — «не указана».
  if (input === null || input === undefined) {
    return {
      status: "NEGOTIATION_REQUIRED",
      amountRub: 0,
      raw,
      source,
      note: "цена не указана",
    }
  }

  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return { status: "UNKNOWN", amountRub: 0, raw, source, note: "цена не является числом" }
    }
    if (input < 0) {
      return { status: "UNKNOWN", amountRub: 0, raw, source, note: `отрицательная цена (${input})` }
    }
    if (input === 0) {
      // Ноль на бирже — «не указана». Отличать его от бесплатной перевозки
      // нечем: бесплатных междугородних рейсов не бывает, а «0» в выгрузке
      // ATI встречается именно у заявок без ставки.
      return { status: "NEGOTIATION_REQUIRED", amountRub: 0, raw, source, note: "цена 0 — не указана" }
    }
    return { status: "CONFIRMED", amountRub: Math.round(input), raw, source, note: "цена из источника" }
  }

  if (typeof input === "string") {
    const text = normalizeText(input)
    if (EMPTY_WORDS.includes(text)) {
      return { status: "NEGOTIATION_REQUIRED", amountRub: 0, raw, source, note: "цена не указана" }
    }
    if (NEGOTIABLE_WORDS.some((word) => text.includes(word))) {
      return {
        status: "NEGOTIATION_REQUIRED",
        amountRub: 0,
        raw,
        source,
        note: "цена договорная",
      }
    }
    // «45 000», "45000 руб.", "45000.50" — цифры с разделителями.
    const digits = text.replace(/[^\d.,-]/g, "").replace(/\s/g, "")
    if (!digits) {
      return { status: "UNKNOWN", amountRub: 0, raw, source, note: "в цене нет цифр" }
    }
    // Разделители тысяч: «45.000» и «45,000» — это 45000, а не 45.
    const cleaned = digits.replace(/(?<=\d)[.,](?=\d{3}\b)/g, "")
    const value = Number(cleaned.replace(",", "."))
    if (!Number.isFinite(value) || value < 0) {
      return { status: "UNKNOWN", amountRub: 0, raw, source, note: `не разобрать цену «${input}»` }
    }
    if (value === 0) {
      return { status: "NEGOTIATION_REQUIRED", amountRub: 0, raw, source, note: "цена 0 — не указана" }
    }
    return { status: "CONFIRMED", amountRub: Math.round(value), raw, source, note: "цена из источника" }
  }

  return { status: "UNKNOWN", amountRub: 0, raw, source, note: "непонятный тип цены" }
}

/**
 * Цена из выгрузки ATI: три поля, порядок — с НДС, без НДС, общее.
 *
 * Порядок важен: если заполнено `priceNds`, это окончательная сумма для
 * перевозчика. `price` без НДС — тоже цена, но её нельзя мешать с первой.
 */
export function parseAtiRate(
  rate: { priceNds?: unknown; priceNoNds?: unknown; price?: unknown } | null | undefined,
): ParsedPrice & { vatIncluded: boolean } {
  if (!rate) {
    return { ...parseRawPrice(null, "ati"), vatIncluded: false }
  }
  if (rate.priceNds !== null && rate.priceNds !== undefined && rate.priceNds !== 0 && rate.priceNds !== "") {
    return { ...parseRawPrice(rate.priceNds, "ati"), vatIncluded: true }
  }
  if (rate.priceNoNds !== null && rate.priceNoNds !== undefined && rate.priceNoNds !== 0 && rate.priceNoNds !== "") {
    return { ...parseRawPrice(rate.priceNoNds, "ati"), vatIncluded: false }
  }
  if (rate.price !== null && rate.price !== undefined && rate.price !== 0 && rate.price !== "") {
    return { ...parseRawPrice(rate.price, "ati"), vatIncluded: false }
  }
  // Все три пустые или нулевые. Статус — «не указана», но исходное значение
  // сохраняем, если оно БЫЛО: ноль и пустая строка — это тоже данные, и по
  // ним потом видно, что ATI прислала именно ноль, а не не заполнила поле.
  const present = [rate.priceNds, rate.priceNoNds, rate.price].find(
    (value) => value !== null && value !== undefined && value !== "",
  )
  return { ...parseRawPrice(present ?? null, "ati"), vatIncluded: false }
}

/** Статус цены заказа, если он не задан явно (совместимость со старыми данными). */
export function derivePriceStatus(amount: number | null | undefined, explicit?: PriceStatus | null): PriceStatus {
  if (explicit) return explicit
  if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) return "CONFIRMED"
  return "NEGOTIATION_REQUIRED"
}

/** Идёт ли сумма в гарантированный доход. Только подтверждённая. */
export function isConfirmed(amount: number | null | undefined, explicit?: PriceStatus | null): boolean {
  return derivePriceStatus(amount, explicit) === "CONFIRMED" && typeof amount === "number" && amount > 0
}

/** Идёт ли сумма в расчётный (не гарантированный) доход. */
export function isEstimated(amount: number | null | undefined, explicit?: PriceStatus | null): boolean {
  return derivePriceStatus(amount, explicit) === "ESTIMATED" && typeof amount === "number" && amount > 0
}

/**
 * Статус ставки заказа с учётом совместимости со старыми данными.
 *
 * Правило одно и то же для сборщика, интерфейса и API:
 *   · статус задан — он и главный, но ESTIMATED без положительной суммы
 *     невозможен (расчёт без числа — это не расчёт);
 *   · статуса нет — положительная сумма считается подтверждённой, а ноль и
 *     пустое значение — «не указана».
 */
export function rateStatus(rate: { amount?: number | null; status?: PriceStatus | null } | null | undefined): PriceStatus {
  if (!rate) return "UNKNOWN"
  const amount = rate.amount
  const status = derivePriceStatus(amount, rate.status ?? null)
  if (status === "ESTIMATED" && !(typeof amount === "number" && amount > 0)) {
    return "NEGOTIATION_REQUIRED"
  }
  if (status === "CONFIRMED" && !(typeof amount === "number" && amount > 0)) {
    return "NEGOTIATION_REQUIRED"
  }
  return status
}

/** Человеческая подпись статуса для экрана и отчётов. */
export function priceStatusLabel(status: PriceStatus): string {
  switch (status) {
    case "CONFIRMED":
      return "Подтверждённая стоимость"
    case "ESTIMATED":
      return "Расчётная стоимость"
    case "NEGOTIATION_REQUIRED":
      return "Стоимость не указана — требуется согласование"
    case "UNKNOWN":
      return "Стоимость не распознана"
  }
}
