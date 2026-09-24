// lib/ocr/parse.ts
//
// Разбор текста, распознанного с фото (задача 7).
//
// OCR отдаёт «сырой» текст: строки рвутся, цифры склеиваются с буквами,
// суммы пишутся и «1 234,56», и «1234.56». Здесь из этого текста достаются
// конкретные поля: сумма чека, литры и цена литра, дата, номер документа,
// поставщик, вес груза и маршрут накладной.
//
// Модуль чистый: без Prisma, Next и самого OCR — на вход текст, на выход поля.
// Поэтому правила проверяются тестами на настоящих образцах чеков и ТТН.

export type ParsedReceipt = {
  kind: "receipt"
  /** Итоговая сумма к оплате, ₽ (целые). */
  total: number | null
  /** Сумма прописью с разделителями — как её видно в чеке. */
  totalRaw: string | null
  date: string | null
  time: string | null
  /** Номер чека/документа, если его удалось найти. */
  number: string | null
  liters: number | null
  pricePerLiter: number | null
  fuelType: string | null
  odometer: number | null
  vendor: string | null
  /** Поля, которые стоит перепроверить человеком. */
  warnings: string[]
}

export type ParsedWaybill = {
  kind: "waybill"
  number: string | null
  date: string | null
  cargo: string | null
  weightKg: number | null
  from: string | null
  to: string | null
  vehiclePlate: string | null
  driverName: string | null
  warnings: string[]
}

export type ParsedDocument = ParsedReceipt | ParsedWaybill

/**
 * Граница «после слова» для кириллицы.
 *
 * \b в JavaScript работает только с латиницей и цифрами (\w = [A-Za-z0-9_]),
 * поэтому после русского слова он не срабатывает вообще. Здесь явно требуем,
 * чтобы за словом не шла буква или цифра.
 */
const NOT_LETTER_AFTER = "(?![\\dA-Za-zА-Яа-яЁё])"

const FUEL_TYPES = [
  "АИ-98",
  "АИ-95",
  "АИ-92",
  "АИ-80",
  "ДТ",
  "ДТЛ",
  "ГАЗ",
  "СУГ",
  "метан",
  "пропан",
]

const RECEIPT_TOTAL_LABELS = [
  "итого к оплате",
  "всего к оплате",
  "итого",
  "к оплате",
  "всего",
  "сумма",
  "total",
]

const WAYBILL_MARKERS = [
  "транспортная накладная",
  "товарно-транспортная",
  "товарная накладная",
  "путевой лист",
  "ттн",
  "накладная",
]

const RECEIPT_MARKERS = [
  "чек",
  "кассовый",
  "ккт",
  "фискальн",
  "смена",
  "итог",
  "к оплате",
  "азс",
  "бензин",
  "топливо",
  "литр",
]

/** Приводит «1 234,56 ₽» к числу 1234.56; мусор — к null. */
export function parseAmount(raw: string | null | undefined): number | null {
  if (!raw) return null

  // убираем всё, кроме цифр, разделителей и минуса
  let text = String(raw).replace(/[^\d.,\s-]/g, " ").replace(/\s+/g, "")
  if (!text) return null

  // 1.234,56 → 1234.56; 1,234.56 → 1234.56
  const lastComma = text.lastIndexOf(",")
  const lastDot = text.lastIndexOf(".")
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) text = text.replace(/\./g, "").replace(",", ".")
    else text = text.replace(/,/g, "")
  } else if (lastComma > -1) {
    // «1,5» — десятичная запятая; «1,234» — разделитель тысяч
    const after = text.length - lastComma - 1
    const digits = text.replace(",", "").replace(/[^\d]/g, "").length
    text = after === 3 && digits > 3 ? text.replace(/,/g, "") : text.replace(",", ".")
  }

  const value = Number.parseFloat(text)
  return Number.isFinite(value) ? value : null
}

/** Сумма в рублях целым числом: копейки бухгалтерии в расходах рейса лишние. */
export function toRubles(value: number | null): number | null {
  if (value === null) return null
  return Math.round(value)
}

function normalizeLines(text: string): string[] {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
}

function findAll(text: string, regex: RegExp): RegExpMatchArray[] {
  return [...text.matchAll(regex)]
}

/** Дата в тексте чека: и «12.09.2026», и «12/09/26», и «2026-09-12». */
export function parseDate(text: string): string | null {
  const dotted = text.match(/\b(\d{2})[.\-/](\d{2})[.\-/](\d{2,4})\b/)
  if (dotted) {
    const [, day, month, rawYear] = dotted
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear
    if (Number(day) >= 1 && Number(day) <= 31 && Number(month) >= 1 && Number(month) <= 12) {
      return `${year}-${month}-${day}`
    }
  }

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const words = text.match(/\b(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})\b/i)
  if (words) {
    const months = [
      "января",
      "февраля",
      "марта",
      "апреля",
      "мая",
      "июня",
      "июля",
      "августа",
      "сентября",
      "октября",
      "ноября",
      "декабря",
    ]
    const month = months.indexOf(words[2].toLowerCase()) + 1
    if (month > 0) {
      return `${words[3]}-${String(month).padStart(2, "0")}-${String(Number(words[1])).padStart(2, "0")}`
    }
  }

  return null
}

export function parseTime(text: string): string | null {
  const build = (hoursRaw: string, minutesRaw: string): string | null => {
    const hours = Number(hoursRaw)
    const minutes = Number(minutesRaw)
    if (hours > 23 || minutes > 59) return null
    return `${String(hours).padStart(2, "0")}:${minutesRaw}`
  }

  // время обычно пишут через двоеточие: «14:32» или «14:32:07»
  const colon = text.match(/(?<![\d.])(\d{1,2}):(\d{2})(?::\d{2})?(?!\d)/)
  if (colon) {
    const value = build(colon[1], colon[2])
    if (value) return value
  }

  // «14.32» — но только когда это не часть даты «07.09.2026»
  const dotted = text.match(/(?<![\d.])(\d{1,2})\.(\d{2})(?!\.?\d)/)
  if (dotted) return build(dotted[1], dotted[2])

  return null
}

/** Похоже ли, что это чек, а не накладная. */
export function detectDocumentKind(text: string): "receipt" | "waybill" | "unknown" {
  const lower = String(text || "").toLowerCase()
  if (!lower.trim()) return "unknown"

  const waybillScore = WAYBILL_MARKERS.filter((marker) => lower.includes(marker)).length
  if (waybillScore > 0) return "waybill"

  const receiptScore = RECEIPT_MARKERS.filter((marker) => lower.includes(marker)).length
  if (receiptScore > 0) return "receipt"

  return "unknown"
}

function findFuelType(text: string): string | null {
  const upper = text.toUpperCase()
  for (const fuel of FUEL_TYPES) {
    if (upper.includes(fuel.toUpperCase())) return fuel
  }
  return null
}

/** Литры: «25,60 л», «25.6 ЛИТР», «25,60л» — но не «25 л/100км» и не объём бака. */
export function parseLiters(text: string): number | null {
  const patterns = [
    new RegExp(`(\\d{1,3}(?:[.,]\\d{1,2})?)\\s*(?:л|l)${NOT_LETTER_AFTER}(?!\\s*\\/)`, "gi"),
    new RegExp(`(\\d{1,3}(?:[.,]\\d{1,2})?)\\s*(?:литр|литров)${NOT_LETTER_AFTER}`, "gi"),
  ]

  for (const pattern of patterns) {
    for (const match of findAll(text, pattern)) {
      const value = parseAmount(match[1])
      // литры в чеке — от 1 до 1000; «20» из «20 л/100 км» отсекает (?!\s*\/)
      if (value !== null && value >= 1 && value <= 1000) return value
    }
  }

  return null
}

/** Показание одометра с чека АЗС: «одометр 123456», «пробег: 123 456 км». */
export function parseOdometer(text: string): number | null {
  const match = text.match(
    /(?:одометр|пробег|odometer|счётчик|счетчик)[^\d]{0,10}(\d[\d\s]{3,9}\d)/i,
  )
  if (!match) return null

  const digits = match[1].replace(/\s/g, "")
  const value = Number.parseInt(digits, 10)
  return Number.isFinite(value) && value > 0 && value < 10_000_000 ? value : null
}

function findVendor(lines: string[]): string | null {
  const skip = /(чек|кассов|ккт|фискал|смена|инн|адрес|тел|итог|сумма|к оплате|nds|ндс)/i
  for (const line of lines.slice(0, 8)) {
    const letters = line.replace(/[^А-Яа-яЁёA-Za-z]/g, "")
    if (letters.length < 3) continue
    if (skip.test(line)) continue
    // «ООО Ромашка», «ИП Петров», «Лукойл-АЗС №12» — названия поставщика
    if (/(ооо|оао|зао|пао|ип|азс|лтд|ltd|llc|inc)/i.test(line) || /[А-ЯЁ]{3,}/.test(line)) {
      return line.slice(0, 120)
    }
  }
  return null
}

function totalFromLabel(lines: string[]): { value: number | null; raw: string | null } {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    const lower = line.toLowerCase()
    const label = RECEIPT_TOTAL_LABELS.find((candidate) => lower.includes(candidate))
    if (!label) continue

    // сумма в той же строке
    const sameLine = line.slice(lower.indexOf(label) + label.length)
    const sameValue = pickAmount(sameLine)
    if (sameValue !== null) return { value: sameValue, raw: sameLine.trim() || null }

    // сумма в следующей строке (частый случай: «ИТОГО» и число под ним)
    const next = lines[index + 1]
    if (next) {
      const nextValue = pickAmount(next)
      if (nextValue !== null) return { value: nextValue, raw: next.trim() }
    }
  }

  return { value: null, raw: null }
}

/** Берёт из строки самое правдоподобное число-сумму (без служебных чисел вроде ИНН). */
function pickAmount(line: string): number | null {
  if (!line) return null

  const matches = findAll(line, /\d[\d\s]{2,12}(?:[.,]\d{1,2})?/g)
  let best: number | null = null

  for (const match of matches) {
    const raw = match[0].trim()
    // ИНН/КПП/номера телефонов и даты сюда не годятся
    if (/^\d{10,}$/.test(raw.replace(/[\s.,]/g, "")) && !/[.,]\d{2}$/.test(raw)) continue

    const value = parseAmount(raw)
    if (value === null || value <= 0) continue
    if (value > 1_000_000) continue
    if (best === null || value > best) best = value
  }

  return best !== null ? toRubles(best) : null
}

/**
 * Разбор чека (в первую очередь топливного).
 *
 * Порядок важен: итог ищем от конца документа — в чеках «ИТОГО» стоит внизу,
 * а выше идут цены за литр и промежуточные суммы.
 */
export function parseReceipt(text: string): ParsedReceipt {
  const lines = normalizeLines(text)
  const warnings: string[] = []

  const { value: total, raw: totalRaw } = totalFromLabel(lines)
  const liters = parseLiters(text)
  const fuelType = findFuelType(text)
  const odometer = parseOdometer(text)
  const date = parseDate(text)
  const time = parseTime(text)

  const numberMatch = text.match(
    /(?:чек|документ|№|номер)\s*[:\-]?\s*([\w\-/]*\d[\w\-/]{0,19})/i,
  )
  const number = numberMatch ? numberMatch[1] : null

  const pricePerLiter = (() => {
    const match = text.match(
      /(?:цена|price)[^\d]{0,10}(\d{1,3}(?:[.,]\d{1,2})?)/i,
    )
    if (match) {
      const value = parseAmount(match[1])
      if (value !== null && value > 0) return value
    }
    if (total !== null && liters !== null && liters > 0) {
      const computed = total / liters
      if (computed > 5 && computed < 300) return Math.round(computed * 100) / 100
    }
    return null
  })()

  if (total === null) warnings.push("Не нашли итоговую сумму — введите её вручную")
  if (liters === null && fuelType !== null) warnings.push("Не нашли литры")
  if (date === null) warnings.push("Не нашли дату")

  return {
    kind: "receipt",
    total,
    totalRaw,
    date,
    time,
    number,
    liters,
    pricePerLiter,
    fuelType,
    odometer,
    vendor: findVendor(lines),
    warnings,
  }
}

/** Вес в килограммах: «25 000 кг», «25 т», «масса брутто 25т». */
export function parseWeightKg(text: string): number | null {
  const tons = text.match(
    new RegExp(`(\\d{1,3}(?:[.,]\\d{1,3})?)\\s*(?:т|тонн|тонны)${NOT_LETTER_AFTER}`, "gi"),
  )
  if (tons) {
    for (const raw of tons) {
      const value = parseAmount(raw)
      if (value !== null && value >= 1 && value <= 100) return Math.round(value * 1000)
    }
  }

  const kg = text.match(
    new RegExp(`(\\d[\\d\\s]{1,9})\\s*(?:кг|kg)${NOT_LETTER_AFTER}`, "gi"),
  )
  if (kg) {
    for (const raw of kg) {
      const value = parseAmount(raw)
      if (value !== null && value >= 10 && value <= 100_000) return Math.round(value)
    }
  }

  return null
}

/** «Москва» из «Пункт погрузки: Москва» / «Откуда: г. Москва». */
function parsePoint(text: string, labels: string[]): string | null {
  for (const label of labels) {
    // между подписью и значением стоят только знаки («:», «-», пробелы),
    // иначе разделитель съедал первую букву названия города
    const pattern = new RegExp(
      `${label}[^\\n\\dA-Za-zА-Яа-яЁё]{0,3}([^\\n;|]{3,60})`,
      "i",
    )
    const match = text.match(pattern)
    if (match) {
      const value = match[1].replace(/\s+/g, " ").trim()
      if (value.length >= 3) return value.slice(0, 60)
    }
  }
  return null
}

/** Разбор накладной (ТТН): номер, дата, груз, вес, откуда/куда, машина, водитель. */
export function parseWaybill(text: string): ParsedWaybill {
  const warnings: string[] = []

  const numberMatch = text.match(
    /(?:накладная|ттн|№|номер)\s*[:\-]?\s*([\w\-/]*\d[\w\-/]{0,19})/i,
  )
  const cargoMatch = text.match(
    /(?:наименование груза|груз|товар)(?=\s*[:\-]|\s)\s*[:\-]?\s*([^\n;|]{3,80})/i,
  )
  const plateMatch = text.match(
    /(?<![\dA-Za-zА-Яа-яЁё])([А-ЯA-Z]\s?\d{3}\s?[А-ЯA-Z]{2}\s?\d{2,3})(?![\dA-Za-zА-Яа-яЁё])/,
  )
  const driverMatch = text.match(
    /(?:водитель|экспедитор)\s*[:\-]?\s*([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/i,
  )

  const weightKg = parseWeightKg(text)
  const from = parsePoint(text, ["пункт погрузки", "грузоотправитель", "откуда", "погрузка"])
  const to = parsePoint(text, ["пункт разгрузки", "грузополучатель", "куда", "разгрузка"])
  const date = parseDate(text)

  if (!numberMatch) warnings.push("Не нашли номер накладной")
  if (weightKg === null) warnings.push("Не нашли вес груза")
  if (!from || !to) warnings.push("Не нашли пункты погрузки и разгрузки")

  return {
    kind: "waybill",
    number: numberMatch ? numberMatch[1] : null,
    date,
    cargo: cargoMatch ? cargoMatch[1].replace(/\s+/g, " ").trim() : null,
    weightKg,
    from,
    to,
    vehiclePlate: plateMatch ? plateMatch[1].replace(/\s+/g, " ").toUpperCase() : null,
    driverName: driverMatch ? driverMatch[1].trim() : null,
    warnings,
  }
}

/** Разбирает текст тем правилом, которое подходит документу. */
export function parseDocument(text: string, hint?: "receipt" | "waybill"): ParsedDocument {
  const kind = hint ?? detectDocumentKind(text)
  if (kind === "waybill") return parseWaybill(text)
  return parseReceipt(text)
}
