// lib/profile.ts
//
// Правила редактирования СВОЕГО профиля: имя и телефон. Чистые функции —
// их видно в тестах (tests/profile.test.mjs), в роуте остаётся только
// применение к базе.
//
// Кто что меняет:
//   * имя и телефон — только свои, только через проверенную сессию;
//   * сотрудник (admin/logist) входит по email, поэтому телефон у него
//     необязательный и его можно убрать;
//   * телефон водителя — это его вход в /m (учётка ищется по номеру,
//     lib/auth/login.ts → normalizePhone), поэтому убрать его нельзя,
//     а канонический вид («79005554433») обязан совпадать с формой хранения.

// Относительный импорт (не «@/…»): этот модуль компилируется и для Node
// (tests/profile.test.mjs → .test-build), а там алиаса «@/» нет.
import { normalizePhone } from "./auth/constants"

export const PROFILE_NAME_MIN = 2
export const PROFILE_NAME_MAX = 80

/** Минимум и максимум цифр в телефоне после нормализации. */
export const PROFILE_PHONE_MIN_DIGITS = 10
export const PROFILE_PHONE_MAX_DIGITS = 15

/** Имя: края и повторяющиеся пробелы убираем — «Иван  Иванов » → «Иван Иванов». */
export function normalizeProfileName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
}

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string }

export function validateProfileName(raw: unknown): FieldResult<string> {
  const value = normalizeProfileName(raw)
  if (!value) {
    return { ok: false, error: "Укажите имя" }
  }
  if (value.length < PROFILE_NAME_MIN) {
    return { ok: false, error: `Имя: не короче ${PROFILE_NAME_MIN} символов` }
  }
  if (value.length > PROFILE_NAME_MAX) {
    return { ok: false, error: `Имя: не длиннее ${PROFILE_NAME_MAX} символов` }
  }
  return { ok: true, value }
}

/**
 * Телефон → канонические цифры: «+7 (911) 222-33-44» и «89112223344»
 * дают один и тот же «79112223344» — как в форме хранения (Driver.phone).
 */
export function normalizeProfilePhone(raw: unknown): string {
  return normalizePhone(String(raw ?? "").trim())
}

/**
 * Телефон из формы профиля. Пустое поле — это «убрать телефон» (value: null):
 * сотруднику это можно, водителю нет (роут откажет). Решение о допустимости
 * принимает роут по роли, а не валидатор: здесь проверяется только формат.
 */
export function validateProfilePhone(raw: unknown): FieldResult<string | null> {
  const trimmed = String(raw ?? "").trim()
  if (!trimmed) {
    return { ok: true, value: null }
  }
  const digits = normalizeProfilePhone(trimmed)
  if (digits.length < PROFILE_PHONE_MIN_DIGITS || digits.length > PROFILE_PHONE_MAX_DIGITS) {
    return {
      ok: false,
      error: `Телефон: от ${PROFILE_PHONE_MIN_DIGITS} до ${PROFILE_PHONE_MAX_DIGITS} цифр`,
    }
  }
  return { ok: true, value: digits }
}
