// lib/ui/greeting.ts — приветствие по времени суток.
//
// Система многопользовательская и мультитенантная: у каждой организации свои
// логисты, админы и водители. Поэтому НИКАКИХ имён здесь не зашито — имя
// приходит из проверенной сессии (GET /api/auth/session → lib/auth-context),
// а организация берётся из той же сессии (user.organization.name).
//
// Этот файл отвечает только за формулировки: одинаковое «Доброе утро» на
// экране входа, в шапке и в приветственном сплэше, и корректное обращение по
// имени — в карточке сотрудника может быть как «Иван Фролов», так и
// «Фролов Иван Александрович», а у служебной учётки — просто «Администратор».
//
// Функции принимают дату аргументом — так их можно честно проверить тестами,
// не подкручивая системные часы.

export type GreetingPart = "morning" | "day" | "evening" | "night"

/** Границы частей суток (часы, локальное время): утро 5–11, день 12–17, вечер 18–22, ночь 23–4. */
export function getGreetingPart(date: Date = new Date()): GreetingPart {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return "morning"
  if (hour >= 12 && hour < 18) return "day"
  if (hour >= 18 && hour < 23) return "evening"
  return "night"
}

const PART_LABELS: Record<GreetingPart, string> = {
  morning: "Доброе утро",
  day: "Добрый день",
  evening: "Добрый вечер",
  night: "Доброй ночи",
}

/** Просто «Доброе утро» / «Добрый день» / … */
export function getGreetingLabel(date: Date = new Date()): string {
  return PART_LABELS[getGreetingPart(date)]
}

/**
 * Typical русские фамильные окончания: по ним отличаем «Фролов Иван» (сначала
 * фамилия) от «Иван Фролов». Список намеренно узкий — ложное срабатывание
 * дороже, чем обращение по первому слову.
 */
const SURNAME_ENDINGS = [
  "ов",
  "ев",
  "ёв",
  "ин",
  "ын",
  "ский",
  "цкий",
  "ова",
  "ева",
  "ёва",
  "ина",
  "ына",
  "ская",
  "цкая",
] as const

/**
 * Служебные имена, которыми подписывают технические учётки (ADMIN_NAME по
 * умолчанию, карточка «Логист» без имени). Обращаться «Доброе утро,
 * Администратор» — звучит как издевательство, поэтому в таких случаях
 * приветствуем без имени.
 */
const GENERIC_NAMES = new Set([
  "администратор",
  "админ",
  "логист",
  "логистка",
  "диспетчер",
  "водитель",
  "менеджер",
  "сотрудник",
  "пользователь",
  "admin",
  "administrator",
  "logist",
  "dispatcher",
  "driver",
  "manager",
  "user",
])

function looksLikeSurname(word: string): boolean {
  const lower = word.toLowerCase().replace(/[^а-яёa-z-]/g, "")
  if (lower.length < 4) return false
  return SURNAME_ENDINGS.some((ending) => lower.endsWith(ending))
}

/**
 * Имя для обращения из того, что лежит в карточке сотрудника.
 *
 * — «Фролов Иван Александрович» → «Иван» (первое слово — фамилия);
 * — «Иван Фролов» → «Иван»;
 * — «Мария» → «Мария»;
 * — «Администратор» → null (приветствуем без имени);
 * — пусто / не строка → null.
 */
export function givenName(fullName?: string | null): string | null {
  if (typeof fullName !== "string") return null

  const tokens = fullName.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null

  const candidate =
    tokens.length > 1 && looksLikeSurname(tokens[0]) && !looksLikeSurname(tokens[1])
      ? tokens[1]
      : tokens[0]

  const normalized = candidate.toLowerCase().replace(/[^а-яёa-z]/g, "")
  if (GENERIC_NAMES.has(normalized)) return null

  return candidate
}

/** «Доброе утро, Иван» — имя берётся из сессии вошедшего сотрудника. */
export function formatGreeting(fullName?: string | null, date: Date = new Date()): string {
  const label = getGreetingLabel(date)
  const name = givenName(fullName)
  return name ? `${label}, ${name}` : label
}

const WEEKDAYS = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
] as const

const MONTHS = [
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
] as const

/** «суббота, 26 сентября» — человекочитаемая дата для шапки и экрана входа. */
export function formatHumanDate(date: Date = new Date()): string {
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`
}
