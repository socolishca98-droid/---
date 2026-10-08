// lib/logist-mobile/format.ts
//
// Мелкие форматтеры для мобильных экранов логиста: деньги, даты, города,
// телефонные ссылки. Чистые функции без зависимостей — их видно в тестах.

const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
]

/** 125000 → «125 000 ₽». Пустое значение → «—». */
export function formatMoney(value?: number | null): string {
  if (value === null || value === undefined) return "—"
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`
}

/** 4200 кг → «4,2 т» (для груза это привычнее килограммов). */
export function formatWeightKg(value?: number | null): string {
  if (value === null || value === undefined || value === 0) return "—"
  if (value < 1000) return `${value} кг`
  return `${(value / 1000).toFixed(1).replace(".0", "").replace(".", ",")} т`
}

/** ISO → «7 окт» (без года, если это текущий год). */
export function formatDateShort(iso?: string | null): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  const now = new Date()
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}${year}`
}

/** ISO → «7 окт, 14:30». */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  return `${formatDateShort(iso)}, ${time}`
}

/**
 * Относительное время словами: «только что», «12 мин», «3 ч», «вчера».
 * Используется в списках, где точная дата не нужна.
 */
export function formatRelative(iso?: string | null): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  const diffMs = Date.now() - date.getTime()
  const future = diffMs < 0
  const abs = Math.abs(diffMs)
  const minutes = Math.round(abs / 60000)

  let phrase: string
  if (minutes < 1) phrase = "только что"
  else if (minutes < 60) phrase = `${minutes} мин`
  else if (minutes < 24 * 60) phrase = `${Math.round(minutes / 60)} ч`
  else if (minutes < 48 * 60) phrase = "вчера"
  else phrase = formatDateShort(iso)

  if (minutes < 1 || phrase === "вчера" || /^\d+ (янв|фев|мар|апр|мая|июн|июл|авг|сен|окт|ноя|дек)/.test(phrase)) {
    return phrase
  }
  return future ? `через ${phrase}` : `${phrase} назад`
}

/**
 * Срок: «сегодня», «завтра», «через 2 дня», «просрочен на 3 дня».
 * Логисту важно видеть именно это, а не календарную дату.
 */
export function formatDeadline(iso?: string | null): { text: string; overdue: boolean; soon: boolean } {
  if (!iso) return { text: "без срока", overdue: false, soon: false }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return { text: "без срока", overdue: false, soon: false }

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startOfTarget = new Date(date)
  startOfTarget.setHours(0, 0, 0, 0)

  const days = Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86400000)

  if (days < 0) {
    const n = Math.abs(days)
    const word = n % 10 === 1 && n % 100 !== 11 ? "день" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "дня" : "дней"
    return { text: `просрочен на ${n} ${word}`, overdue: true, soon: false }
  }
  if (days === 0) return { text: "сегодня", overdue: false, soon: true }
  if (days === 1) return { text: "завтра", overdue: false, soon: true }
  if (days === 2) return { text: "послезавтра", overdue: false, soon: false }
  return { text: `через ${days} дн.`, overdue: false, soon: false }
}

/**
 * «Московская область, Домодедово, улица Логистическая, 12» → «Домодедово».
 *
 * Маркеры района и улицы проверяются в начале части адреса («улица …», «д. 12»),
 * а не в любом месте строки: иначе «Домодедово» отбраковывалось из-за «дом»,
 * а номер дома «12» оставался единственным кандидатом в город.
 */
export function shortCity(address?: string | null): string {
  if (!address) return "—"
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return "—"

  const region = /(обл\.?|область|край|республик|р-н|район|автономн)/i
  const street =
    /^(ул\.?|улица|проспект|пр-т|шоссе|переул(ок)?|проезд|д\.\s*\d|дом\b|строен(ие)?\b|стр\.|корпус\b|кв\.|владение)/i
  // «12», «12 к2», «корп. 3» — это не город, а дом
  const houseNumber = /^\d+([\s/\-].*)?$/i
  const cityPrefix = /^(г\.?|город)\s*/i

  const city = parts.find(
    (part) => !region.test(part) && !street.test(part) && !houseNumber.test(part),
  )
  return (city || parts[0]).replace(cityPrefix, "").trim() || "—"
}

/** Номер → tel: ссылка. «+7 916 123-45-01» → «tel:+79161234501». */
export function telHref(phone?: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/[^\d+]/g, "")
  if (digits.replace(/\D/g, "").length < 10) return null
  return `tel:${digits.startsWith("+") ? digits : `+${digits}`}`
}

/** Номер → ссылка на WhatsApp (wa.me без плюса и пробелов). */
export function whatsappHref(phone?: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 10) return null
  return `https://wa.me/${digits}`
}

/**
 * Адрес → ссылка на Яндекс Карты: одна точка, открывается в приложении карт.
 * Именно текст адреса, а не координаты: у логиста адрес есть, а геокодировать
 * его на телефоне незачем — карты сделают это сами.
 */
export function mapsHref(address?: string | null): string | null {
  const clean = address?.trim()
  if (!clean) return null
  return `https://yandex.ru/maps/?text=${encodeURIComponent(clean)}`
}

/**
 * Маршрут «откуда → куда» в навигаторе — одна ссылка на две точки.
 * Координаты не нужны: Яндекс Карты принимают адреса в rtext и геокодят их.
 */
export function routeMapsHref(from?: string | null, to?: string | null): string | null {
  const start = from?.trim()
  const finish = to?.trim()
  if (!start || !finish) return null
  return `https://yandex.ru/maps/?rtext=${encodeURIComponent(start)}~${encodeURIComponent(finish)}&rtt=auto`
}

/** «Домодедово → Калуга» одной строкой. */
export function routeTitle(from?: string | null, to?: string | null): string {
  return `${shortCity(from)} → ${shortCity(to)}`
}

/** Название заказа для списков: клиент или направление. */
export function orderTitle(order: { clientName?: string | null; routeFrom: string; routeTo: string }): string {
  return order.clientName?.trim() || routeTitle(order.routeFrom, order.routeTo)
}

/** Русское склонение: 1 рейс, 2 рейса, 5 рейсов. */
export function plural(count: number, forms: [string, string, string]): string {
  const n = Math.abs(count) % 100
  const tail = n % 10
  if (n > 10 && n < 20) return forms[2]
  if (tail > 1 && tail < 5) return forms[1]
  if (tail === 1) return forms[0]
  return forms[2]
}

/** Число со словом: «42 рейса». */
export function formatCount(count: number, forms: [string, string, string]): string {
  return `${count} ${plural(count, forms)}`
}

/**
 * Короткая ссылка на запись: «demo-order-7» → «order-7», cuid → последние 8 знаков.
 * Служебный префикс демо-данных в интерфейсе не показываем.
 */
export function shortRef(id?: string | null): string {
  if (!id) return "—"
  const clean = id.replace(/^demo-/i, "")
  return clean.length <= 10 ? clean : clean.slice(-8)
}

/** Расстояние: «210 км». */
export function formatKm(value?: number | null): string {
  if (value === null || value === undefined) return "—"
  return `${Math.round(value)} км`
}

/** Пробег: «312 480 км». */
export function formatMileage(value?: number | null): string {
  if (value === null || value === undefined) return "—"
  return `${Math.round(value).toLocaleString("ru-RU")} км`
}

/**
 * Состояние оплаты заказа словами — то, что логист спрашивает у клиента.
 * Порядок проверок важен: просрочка важнее «ждём», оплата важнее срока.
 */
export function paymentState(order: {
  isPaid?: boolean
  isOverdue?: boolean
  overdueDays?: number | null
  dueDate?: string | null
  paymentType?: string | null
}): { label: string; tone: "ok" | "wait" | "late" | "neutral" } {
  if (order.isPaid) return { label: "Оплачен", tone: "ok" }
  if (order.isOverdue) {
    const days = order.overdueDays ?? 0
    return { label: `Просрочен${days > 0 ? ` на ${days} ${plural(days, ["день", "дня", "дней"])}` : ""}`, tone: "late" }
  }
  if (order.dueDate) {
    return { label: `Оплата до ${formatDateShort(order.dueDate)}`, tone: "wait" }
  }
  return { label: "Ожидает оплаты", tone: "wait" }
}
