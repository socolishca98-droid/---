// lib/ui/greeting.ts — приветствие по времени суток.
//
// Одна маленькая чистая функция, которую используют и экран входа, и шапка,
// и приветственный сплэш после логина: чтобы во всех трёх местах человек видел
// одинаковое «Доброе утро», а не три разные формулировки.
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

/** «Доброе утро, Иван» — только имя (без фамилии), если оно передано. */
export function formatGreeting(fullName?: string | null, date: Date = new Date()): string {
  const label = getGreetingLabel(date)
  const first = (fullName ?? "").trim().split(/\s+/)[0]
  return first ? `${label}, ${first}` : label
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
