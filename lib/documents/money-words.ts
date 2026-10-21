// lib/documents/money-words.ts
//
// Сумма прописью для платёжных документов (счёт, акт).
//
// Чистая функция: без дат, без базы, без Next — проверяется тестами
// (tests/documents-money.test.mjs). Нужна, потому что «45000 ₽» в счёте
// недопустимо: бухгалтерия принимает только сумму прописью, а расхождение
// цифр и слов — повод вернуть документ.

const ONES_M = [
  "",
  "один",
  "два",
  "три",
  "четыре",
  "пять",
  "шесть",
  "семь",
  "восемь",
  "девять",
]

const ONES_F = [
  "",
  "одна",
  "две",
  "три",
  "четыре",
  "пять",
  "шесть",
  "семь",
  "восемь",
  "девять",
]

const TEENS = [
  "десять",
  "одиннадцать",
  "двенадцать",
  "тринадцать",
  "четырнадцать",
  "пятнадцать",
  "шестнадцать",
  "семнадцать",
  "восемнадцать",
  "девятнадцать",
]

const TENS = [
  "",
  "",
  "двадцать",
  "тридцать",
  "сорок",
  "пятьдесят",
  "шестьдесят",
  "семьдесят",
  "восемьдесят",
  "девяносто",
]

const HUNDREDS = [
  "",
  "сто",
  "двести",
  "триста",
  "четыреста",
  "пятьсот",
  "шестьсот",
  "семьсот",
  "восемьсот",
  "девятьсот",
]

/** Формы слова по последним цифрам: 1 → форма для 1, 2-4 → форма для 2, иначе форма для 5. */
function pluralForm(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100
  if (abs >= 11 && abs <= 14) return forms[2]
  const last = abs % 10
  if (last === 1) return forms[0]
  if (last >= 2 && last <= 4) return forms[1]
  return forms[2]
}

function groupWords(value: number, feminine: boolean): string {
  const ones = feminine ? ONES_F : ONES_M
  const parts: string[] = []

  const hundreds = Math.floor(value / 100)
  const tens = Math.floor((value % 100) / 10)
  const rest = value % 10

  if (hundreds > 0) parts.push(HUNDREDS[hundreds])
  if (tens === 1) {
    parts.push(TEENS[rest])
    return parts.join(" ")
  }
  if (tens > 1) parts.push(TENS[tens])
  if (rest > 0) parts.push(ones[rest])

  return parts.join(" ")
}

const GROUPS: { unit: number; feminine: boolean; forms: [string, string, string] }[] = [
  { unit: 1_000_000_000, feminine: false, forms: ["миллиард", "миллиарда", "миллиардов"] },
  { unit: 1_000_000, feminine: false, forms: ["миллион", "миллиона", "миллионов"] },
  // тысячи — женского рода: «одна тысяча», «две тысячи»
  { unit: 1_000, feminine: true, forms: ["тысяча", "тысячи", "тысяч"] },
]

/**
 * Целое число прописью: 2000000 → «два миллиона», 1001 → «одна тысяча один».
 * Ноль — «ноль» (считать нуль «рублей» — задача вызывающей стороны).
 */
export function numberInWords(value: number): string {
  if (!Number.isFinite(value)) return ""
  const abs = Math.abs(Math.trunc(value))

  if (abs === 0) return "ноль"

  let rest = abs
  const parts: string[] = []

  for (const group of GROUPS) {
    const count = Math.floor(rest / group.unit)
    if (count > 0) {
      parts.push(`${groupWords(count, group.feminine)} ${pluralForm(count, group.forms)}`)
      rest %= group.unit
    }
  }

  if (rest > 0) {
    parts.push(groupWords(rest, false))
  }

  return parts.join(" ").trim()
}

/**
 * Сумма прописью в рублях и копейках: 2000000.05 →
 * «два миллиона рублей 05 копеек».
 *
 * Копейки считаем от округления до двух знаков (как в платёжке: в документах
 * копейки не отбрасываются, а округляются арифметически).
 */
export function amountInWords(amount: number): string {
  if (!Number.isFinite(amount)) return ""

  const rounded = Math.round(amount * 100) / 100
  const rubles = Math.trunc(rounded)
  const kopecks = Math.round((rounded - rubles) * 100)

  // 0.9999 при округлении может дать 100 копеек — переносим в рубли
  let rub = rubles
  let kop = kopecks
  if (kop === 100) {
    rub += 1
    kop = 0
  }

  const rubleWords = numberInWords(rub)
  const rubleForm = pluralForm(rub, ["рубль", "рубля", "рублей"])
  const kopeckForm = pluralForm(kop, ["копейка", "копейки", "копеек"])
  const kopeckText = `${String(kop).padStart(2, "0")} ${kopeckForm}`

  if (rubleWords === "") return kopeckText
  return `${rubleWords} ${rubleForm} ${kopeckText}`.replace(/\s+/g, " ").trim()
}
