// lib/orders/parse-request-text.ts
//
// Разбор текста заявки («Заказ из текста») в поля заказа.
// Вынесен из components/orders/text-parse-panel.tsx, чтобы жить под
// прямыми тестами (tests/order-text-parse.test.mjs): разбор — это логика
// продукта, а не деталь экрана.
//
// Как это работает и почему так:
//   * разбор детерминированный (правила и регулярные выражения), без внешних
//     ИИ-сервисов: результат предсказуем, ничего не уходит на сторону, и его
//     можно проверить глазами;
//   * разбор НИЧЕГО не создаёт сам — это совет: поля показываются рядом с
//     исходным текстом, их можно поправить руками;
//   * чего в тексте не нашлось, видно списком предупреждений: сервис не
//     выдумывает города, вес и телефоны.

export type ParsedFields = {
  routeFrom: string
  routeTo: string
  cargoType: string
  weight: string
  volume: string
  price: string
  distance: string
  clientName: string
  clientContact: string
  requirements: string
  deadline: string
}

const EMPTY: ParsedFields = {
  routeFrom: "",
  routeTo: "",
  cargoType: "",
  weight: "",
  volume: "",
  price: "",
  distance: "",
  clientName: "",
  clientContact: "",
  requirements: "",
  deadline: "",
}

/** Строка после «Откуда:», «Куда:», «Груз:» и похожих меток. */
function pickLabeled(text: string, labels: string[]): string {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}\\s*[:—-]\\s*(.+)`, "i"))
    if (match) return match[1].split("\n")[0].trim()
  }
  return ""
}

/** Число рядом с единицей измерения: «18 тонн», «80 куб.м», «45 000 р». */
function pickNumber(text: string, unitPattern: string): string {
  const match = text.match(new RegExp(`(\\d[\\d\\s.,]*)\\s*(?:${unitPattern})`, "i"))
  if (!match) return ""
  return match[1].replace(/[\s]/g, "").replace(",", ".").replace(/\.$/, "")
}

/**
 * Явная дата в тексте: dd.mm(.yyyy) или dd/mm(.yyyy).
 *
 * Две защиты (Д2):
 *   · диапазоны: телефон «555-34-12» даёт кусок «34-12» — раньше он
 *     превращался в «дату» 34-12 (день 34, месяц 12), и мусор уходил в
 *     расписание рейса. Теперь день/месяц/год проверяются, а совпадения
 *     перебираются до первого валидного: в «до 5 числа, телефон 555-34-12,
 *     встреча 03.12.2026» дата — третья, а не «телефонная»;
 *   · год: двухзначный — 20XX, четырёхзначный — как есть, иначе мусор.
 */
function pickExplicitDate(text: string): string | null {
  const pattern = /(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/g
  for (const match of text.matchAll(pattern)) {
    const day = Number(match[1])
    const month = Number(match[2])
    const rawYear = match[3]
    if (day < 1 || day > 31) continue
    if (month < 1 || month > 12) continue
    const year = rawYear
      ? rawYear.length === 2
        ? `20${rawYear}`
        : rawYear
      : String(new Date().getFullYear())
    if (Number(year) < 2000 || Number(year) > 2100) continue

    // Время — в ТОЙ ЖЕ части текста, что и дата (после неё до конца строки):
    // «срочно до 07.11.2026 18:00» — да, «до 18:00 завтра 07.11» — нет.
    const tail = text.slice(match.index ?? 0, (match.index ?? 0) + 40).split("\n")[0]
    const time = tail.match(/(\d{1,2}):(\d{2})/)
    const clock = time ? `T${time[1].padStart(2, "0")}:${time[2]}` : ""
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}${clock}`
  }
  return null
}

/** «завтра до 18:00» → дата; конкретная дата dd.mm(.yyyy) — как есть. */
function pickDeadline(text: string): string {
  const explicit = pickExplicitDate(text)
  if (explicit) return explicit

  // «до пятницы», «в понедельник» — ближайшая такая дата недели.
  // Матчим ОСНОВУ слова: «пятница» не содержится в «пятницы» (родительный
  // падач), а «пятниц» — содержится во всех формах.
  const weekdays = ["воскресень", "понедельник", "вторник", "сред", "четверг", "пятниц", "суббот"]
  for (let index = 0; index < weekdays.length; index += 1) {
    if (!new RegExp(weekdays[index], "i").test(text)) continue
    const date = new Date()
    const delta = (index - date.getDay() + 7) % 7 || 7
    date.setDate(date.getDate() + delta)
    const time = text.match(/(\d{1,2}):(\d{2})/)
    if (time) date.setHours(Number(time[1]), Number(time[2]), 0, 0)
    else date.setHours(18, 0, 0, 0)
    return date.toISOString().slice(0, 16)
  }

  const dayShift = /послезавтра/i.test(text) ? 2 : /завтра/i.test(text) ? 1 : 0
  if (dayShift > 0) {
    const date = new Date(Date.now() + dayShift * 24 * 60 * 60 * 1000)
    const time = text.match(/(\d{1,2}):(\d{2})/)
    if (time) date.setHours(Number(time[1]), Number(time[2]), 0, 0)
    return date.toISOString().slice(0, 16)
  }

  return ""
}

/**
 * Вес: «18 т», «18т» слитно, «18 т.», «18 тонн», «1,5 тонны», «25 000 кг».
 *
 * Д1: после кириллической «т» граница слов \\b не работает (она опирается
 * на [A-Za-z0-9_]), поэтому «18 т» и «18т» не разбирались вовсе, а «18
 * тонн» работало. Теперь вместо \\b — негативный взгляд вперёд: после «т»
 * не должно быть буквы («5 транспорта» — не вес), а точка («18 т.»)
 * допустима.
 */
const TONS_RE = /(\d+[.,]?\d*)\s*(?:тонн[а-яё]*|т(?![а-яёA-Za-z])\.?)/i
const KILOS_RE = /(\d[\d\s]{2,})\s*(?:кг|килограмм)/i

/** Разбор текста заявки в поля заказа. Ничего не создаёт — только предлагает. */
export function parseOrderText(text: string): { fields: ParsedFields; warnings: string[] } {
  const fields: ParsedFields = { ...EMPTY }
  const warnings: string[] = []

  fields.routeFrom = pickLabeled(text, ["откуда", "от", "погрузка", "загрузка", "адрес погрузки"])
  fields.routeTo = pickLabeled(text, ["куда", "до", "выгрузка", "разгрузка", "адрес выгрузки"])

  // Свободный текст без меток: «перевезти из Ярославля в Москву», «из Ростова до Москвы».
  // Служебные слова (в, до, под, с, …) не становятся частью названия города:
  // «в Москву до пятницы» — город «Москву», а не «Москву до».
  if (!fields.routeFrom || !fields.routeTo) {
    const word = "[А-Яа-яЁёA-Za-z\\-]{2,40}"
    const notTail = "(?!(?:в|до|под|с|и|на|по|у|за|к|от)(?![а-яёa-z]))"
    const prose = text.match(
      new RegExp(`из\\s+(${word}(?:\\s+${notTail}${word})?)\\s+(?:в|до|под)\\s+(${word}(?:\\s+${notTail}${word})?)`, "i"),
    )
    if (prose) {
      fields.routeFrom = fields.routeFrom || prose[1].trim()
      fields.routeTo = fields.routeTo || prose[2].trim()
    }
  }

  // «Москва → Тверь» одной строкой
  if (!fields.routeFrom || !fields.routeTo) {
    const arrow = text.match(/^([^\n→\-]{3,60})\s*(?:→|->|—|-)\s*([^\n]{3,60})$/m)
    if (arrow) {
      fields.routeFrom = fields.routeFrom || arrow[1].trim()
      fields.routeTo = fields.routeTo || arrow[2].split("\n")[0].trim()
    }
  }

  fields.cargoType = pickLabeled(text, ["груз", "название груза", "товар"])
  if (fields.cargoType.length > 100) fields.cargoType = fields.cargoType.slice(0, 100)

  const tons = text.match(TONS_RE)
  const kilos = text.match(KILOS_RE)
  if (tons) fields.weight = String(Math.round(Number(tons[1].replace(",", ".")) * 1000))
  else if (kilos) fields.weight = kilos[1].replace(/[\s]/g, "")

  fields.volume = pickNumber(text, "куб\\.?\\s*м|м3|м³|кубов")
  fields.price = pickNumber(text, "р\\b|руб|₽|рублей")
  if (!fields.price) {
    // «60 тысяч», «150 тыщ» — разговорные суммы
    const thousands = text.match(/(\d+[.,]?\d*)\s*(?:тысяч|тыщ|тыс)/i)
    if (thousands) fields.price = String(Math.round(Number(thousands[1].replace(",", ".")) * 1000))
  }
  fields.distance = pickNumber(text, "км")

  const phone = text.match(
    /(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/,
  )
  if (phone) fields.clientContact = phone[0].replace(/[^\d+]/g, "")

  const contact = pickLabeled(text, ["контакт", "контактное лицо", "клиент", "менеджер"])
  if (contact) {
    const name = contact.replace(/(\+?\d[\d\s\-()]{6,})/, "").replace(/[,;]\s*$/, "").trim()
    if (name) fields.clientName = name
  }

  fields.requirements = pickLabeled(text, ["требовани[яй]", "условия", "примечание"])
  fields.deadline = pickDeadline(text)

  if (!fields.routeFrom) warnings.push("Не найден город отправления — укажите вручную")
  if (!fields.routeTo) warnings.push("Не найден город назначения — укажите вручную")
  if (!fields.weight && !fields.volume) warnings.push("Вес и объём не найдены")
  if (!fields.price) warnings.push("Цена не найдена — заказ можно создать и без неё")

  return { fields, warnings }
}
