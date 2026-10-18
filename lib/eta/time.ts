// lib/eta/time.ts
//
// Локальное время сегмента.
//
// Зачем отдельный модуль: автомобиль может выехать утром, пройти город в час
// пик, а к вечеру оказаться на трассе в другом регионе. Коэффициенты зависят от
// МЕСТНОГО часа и дня недели в точке прохождения, поэтому везде, где считается
// поправка, время переводится в часовой пояс маршрута, а не берётся из UTC.
//
// Часовой пояс по умолчанию — Европа/Москва: основная аудитория Loginex.
// Переопределяется переменной ETA_TIMEZONE.

const DEFAULT_TIMEZONE = process.env.ETA_TIMEZONE || "Europe/Moscow"

/** Часы (0..23) и минуты в часовом поясе маршрута. */
export function localHourMinute(date: Date, timeZone: string = DEFAULT_TIMEZONE): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date)

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0")
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0")
  // Intl иногда отдаёт "24" для полуночи в некоторых сборках
  return { hour: Number.isFinite(hour) ? hour % 24 : 0, minute: Number.isFinite(minute) ? minute : 0 }
}

/** Дробный час: 18:30 → 18.5. Нужен кривой часа пик. */
export function localHour(date: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const { hour, minute } = localHourMinute(date, timeZone)
  return hour + minute / 60
}

/** День недели: 0 — воскресенье, 5 — пятница. */
export function localDayOfWeek(date: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(date)
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[weekday] ?? date.getDay()
}

/** Месяц (1..12) в часовом поясе маршрута. */
export function localMonth(date: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const month = new Intl.DateTimeFormat("en-GB", { timeZone, month: "2-digit" }).format(date)
  return Number(month) || date.getMonth() + 1
}

export type Season = "winter" | "spring" | "summer" | "autumn"

/** Сезон по месяцу в часовом поясе маршрута. */
export function seasonOf(date: Date, timeZone: string = DEFAULT_TIMEZONE): Season {
  const month = localMonth(date, timeZone)
  if (month <= 2 || month === 12) return "winter"
  if (month <= 5) return "spring"
  if (month <= 8) return "summer"
  return "autumn"
}

/** ГОСТ-подобная группировка: суббота/воскресенье — выходной. */
export function isWeekend(date: Date, timeZone: string = DEFAULT_TIMEZONE): boolean {
  const day = localDayOfWeek(date, timeZone)
  return day === 0 || day === 6
}
