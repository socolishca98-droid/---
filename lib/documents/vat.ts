// lib/documents/vat.ts
//
// НДС в платёжных документах (счёт на оплату, акт выполненных работ).
//
// Отдельный модуль, потому что счёт и акт считают НДС одинаково, а делать это
// нужно ровно так, как требует форма: ставка, сумма налога и строка подписи.
// Модуль чистый — проверяется тестами без базы.

/**
 * Ставки НДС РФ. ЕДИНСТВЕННОЕ место, где заданы ставки: закон меняется —
 * правим здесь, и подпись обновляется во всех документах сразу.
 *
 * Актуальность на 2026-10: 20% (основная), 10% (продукты, детские товары,
// периодика), 0% (экспорт). В расчётных документах указывать актуальные
// ставки — требование формы; перед сдачей в налоговую проверить, не менялось
 * ли законодательство.
 */
export const VAT_RATES: Record<"vat20" | "vat10", number> = {
  vat20: 0.2,
  vat10: 0.1,
}

/** НДС включён в стоимость — выделяем по основной ставке. */
const INCLUDED_RATE: number = VAT_RATES.vat20

/** Виды налогообложения из заказа (vatType) → ставка, по которой считаем. */
export type VatBreakdown = {
  /** Код из заказа: none | vat20 | vat10 | included | другое/не задано. */
  vatType: string | null
  /** Ставка доли (0.2 = 20%). 0 — «без НДС». */
  rate: number
  /** Сумма НДС в рублях (0 — налога нет). */
  vatAmount: number
  /** Цена без НДС. */
  netAmount: number
  /** Итого к оплате. */
  grossAmount: number
  /** Строка для документа: «НДС 20% — 9 000 ₽» / «Без НДС» / «НДС включён…». */
  label: string
  /** НДС включён в стоимость (сумма задана «с налогом»). */
  included: boolean
}

function fmt(value: number): string {
  return value.toLocaleString("ru-RU").replace(/\u00a0/g, " ")
}

/**
 * Разбор НДС по vatType заказа.
 *
 * unknown / не задано → «без НДС»: врать в платёжном документе нельзя, а
 * угадывать ставку — тем более. Отсутствие vatType означает, что условие по
 * налогу не согласовано, и счёт печатается без налога (при необходимости
 * логист правит условие в заказе до печати).
 */
export function vatBreakdown(vatType: string | null | undefined, gross: number): VatBreakdown {
  const raw = (vatType ?? "").trim().toLowerCase()
  const amount = Math.max(0, Number.isFinite(gross) ? Math.round(gross * 100) / 100 : 0)

  const withoutVat = {
    vatType: raw || null,
    rate: 0,
    vatAmount: 0,
    netAmount: amount,
    grossAmount: amount,
    label: "Без НДС",
    included: false,
  }

  if (raw === "none" || raw === "without_vat" || raw === "0" || raw === "") {
    return withoutVat
  }

  if (raw === "included" || raw === "with_vat") {
    // НДС включён в стоимость: net = gross / (1 + ставка)
    const net = Math.round((amount / (1 + INCLUDED_RATE)) * 100) / 100
    const vatAmount = Math.round((amount - net) * 100) / 100
    return {
      vatType: raw,
      rate: INCLUDED_RATE,
      vatAmount,
      netAmount: net,
      grossAmount: amount,
      label: `НДС включён в стоимость (ставка ${Math.round(INCLUDED_RATE * 100)}%) — ${fmt(vatAmount)} ₽`,
      included: true,
    }
  }

  const rate =
    raw === "vat20" || raw === "20"
      ? VAT_RATES.vat20
      : raw === "vat10" || raw === "10"
        ? VAT_RATES.vat10
        : null

  if (rate === null) return withoutVat

  // Цена без НДС: налог сверху
  const vatAmount = Math.round(amount * rate * 100) / 100
  const grossAmount = Math.round((amount + vatAmount) * 100) / 100
  return {
    vatType: raw,
    rate,
    vatAmount,
    netAmount: amount,
    grossAmount,
    label: `НДС ${Math.round(rate * 100)}% — ${fmt(vatAmount)} ₽`,
    included: false,
  }
}
