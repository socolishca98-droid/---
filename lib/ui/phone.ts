// lib/ui/phone.ts
//
// Телефон водителя — это одновременно и его вход в приложение: учётка ищется
// по нормализованному номеру (lib/auth/login.ts → normalizePhone), а карточка
// водителя ограничена уникальностью по тому же полю. Поэтому в базе номер
// лежит в каноническом виде (только цифры, ведущая 8 заменена на 7).
//
// Цифры — хорошо для сравнения и плохо для чтения: «79005554433» человек
// воспринимает хуже, чем «+7 900 555-44-33». Этот модуль возвращает номер
// в читаемом виде для экрана и в виде, пригодном для ссылки tel:.

import { normalizePhone } from "@/lib/auth/constants"

/** Это канонический российский номер: 11 цифр, начинается с 7. */
export function isRussianPhone(value: string): boolean {
  const digits = normalizePhone(value)
  return digits.length === 11 && digits.startsWith("7")
}

/**
 * Номер для показа. Российские номера группируются в привычный формат,
 * всё остальное (короткие, иностранные, «уточняется») отдаётся как есть —
 * выдумывать формат за пользователя нельзя.
 */
export function formatPhone(value: string | null | undefined): string {
  const raw = (value ?? "").trim()
  if (!raw) return ""

  const digits = normalizePhone(raw)
  if (!isRussianPhone(digits)) return raw

  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`
}

/**
 * Значение для href="tel:…" — без пробелов и дефисов, иначе часть телефонов
 * набирает номер с мусором. Пустая строка означает «звонить некуда»: ссылку
 * в таком случае лучше не показывать.
 */
export function telHref(value: string | null | undefined): string {
  const digits = normalizePhone(value ?? "")
  if (!digits) return ""
  return isRussianPhone(digits) ? `+${digits}` : digits
}
