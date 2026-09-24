// lib/clients/normalize.ts
//
// Приведение названий клиентов к сравнимому виду (задача 5).
//
// Главная задача — узнать одного и того же клиента, записанного по-разному:
//   «ООО "Ромашка"», «ООО Ромашка», «ромашка», «ООО  РОМАШКА  »
// При импорте базы это решает, обновлять карточку или заводить дубль.

/** Правовые формы и служебные слова, которые не отличают одного клиента от другого. */
const LEGAL_FORMS = [
  "ооо",
  "оао",
  "зао",
  "пао",
  "ао",
  "ип",
  "тоо",
  "нао",
  "гуп",
  "муп",
  "фгуп",
  "нко",
  "анпо",
  "спк",
  "кфх",
  "ltd",
  "llc",
  "inc",
  "gmbh",
]

/**
 * Ключ сравнения названий: нижний регистр, без правовой формы, кавычек и
 * лишних знаков, ё → е. Пустая строка означает, что от названия ничего не
 * осталось (например, в колонке было только «ООО»).
 */
export function clientNameKey(value: unknown): string {
  if (typeof value !== "string") return ""

  let text = value
    .toLowerCase()
    .replace(/ё/g, "е")
    // кавычки всех видов и прочая типографика
    .replace(/[«»"'`„“”‚‘’]/g, " ")
    .replace(/[.,;:()\[\]{}*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  // правовая форма может стоять в начале или в конце («Ромашка ООО»)
  const words = text.split(" ").filter(Boolean)
  const meaningful = words.filter((word) => !LEGAL_FORMS.includes(word))

  text = meaningful.join(" ").trim()
  return text
}

/** Название так, как его показываем: одна строка, без лишних пробелов. */
export function cleanClientName(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.replace(/\s+/g, " ").trim()
}

/** Телефон в одном виде: только цифры и ведущий «+», чтобы «8 900» и «+7 900» сравнились. */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const digits = trimmed.replace(/[^\d]/g, "")
  if (digits.length === 0) return null

  // 8XXXXXXXXXX и 7XXXXXXXXXX — один и тот же российский номер
  if (digits.length === 11 && (digits.startsWith("8") || digits.startsWith("7"))) {
    return `+7${digits.slice(1)}`
  }
  if (digits.length === 10) return `+7${digits}`

  return trimmed.startsWith("+") ? `+${digits}` : digits
}

/** ИНН — только цифры; иначе null (чтобы «б/н» и прочее не попали в реквизиты). */
export function normalizeInn(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const digits = String(value).replace(/[^\d]/g, "")
  if (digits.length === 10 || digits.length === 12) return digits
  return null
}

/** КПП — ровно 9 цифр, иначе null. */
export function normalizeKpp(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const digits = String(value).replace(/[^\d]/g, "")
  return digits.length === 9 ? digits : null
}

/** Отсрочка в днях: «14 дней», «отсрочка 14», «14» → 14. Отрицательное и мусор — null. */
export function normalizeDeferredDays(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= 365 ? Math.round(value) : null
  }
  if (typeof value !== "string") return null

  const match = value.match(/\d+/)
  if (!match) return null

  const days = Number(match[0])
  if (!Number.isFinite(days) || days < 0 || days > 365) return null
  return days
}

/** Форма оплаты из свободного текста: «безнал», «наличные», «по счёту». */
export function normalizePaymentType(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.toLowerCase().replace(/ё/g, "е")

  if (/наличн|кэш|cash|(^|\s)нал(\s|$)/.test(text) && !/безнал/.test(text)) return "cash"
  if (/безнал|по\s*сч|счет|счёт|перечислен|платеж|банк|bank/.test(text)) return "bank"
  if (/карт|card/.test(text)) return "card"
  return null
}

/** НДС из свободного текста: «без НДС», «НДС 20%», «с НДС». */
export function normalizeVatType(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.toLowerCase().replace(/ё/g, "е")

  // Порядок важен: «НДС 20%» содержит «0%», поэтому конкретные ставки
  // проверяем раньше общего «0%». Плюс \b не работает с кириллицей —
  // границы слов задаём явно.
  if (/(^|\s)0\s*%|без\s*ндс|не\s*облага/.test(text)) return "none"
  if (/20\s*%/.test(text)) return "vat20"
  if (/10\s*%/.test(text)) return "vat10"
  if (/(^|\s)ндс(\s|$)|с\s*ндс/.test(text)) return "included"
  return null
}
