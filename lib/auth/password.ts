/**
 * Хеширование паролей: scrypt (встроен в Node, без внешних зависимостей).
 *
 * Формат хранения:
 *   passwordSalt = hex(16 случайных байт)
 *   passwordHash = hex(64 байта производного ключа)
 *
 * Параметры N=16384, r=8, p=1 — рекомендации OWASP для scrypt.
 * Сравнение — через timingSafeEqual, чтобы не утекало время сравнения.
 *
 * Файл используется только в server-коде (route handlers, scripts):
 * node:crypto недоступен в edge-окружении middleware.
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto"
import { promisify } from "node:util"

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number; maxmem?: number },
) => Promise<Buffer>

export const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
  // 128 * N * r = 16 МБ; берём с запасом, иначе Node бросит "memory limit exceeded"
  maxmem: 64 * 1024 * 1024,
} as const

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

export interface PasswordHash {
  hash: string
  salt: string
}

/** Нормализуем пароль перед хешированием (Unicode NFKC), но НЕ trim'им пробелы:
 *  пароль с осмысленными пробелами — валидный пароль. */
function prepare(password: string): string {
  return password.normalize("NFKC")
}

export function generateSalt(): string {
  return randomBytes(16).toString("hex")
}

/** Создать хэш и соль для пароля */
export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = generateSalt()
  const derived = await scrypt(prepare(password), Buffer.from(salt, "hex"), SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  })
  return { hash: derived.toString("hex"), salt }
}

/** Проверить пароль против сохранённых хэша и соли */
export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string,
): Promise<boolean> {
  if (!storedHash || !storedSalt) return false
  // Формат строгий: hex, длина ключа ровно как при хешировании, соль не короче 8 байт.
  // Иначе на «мусорных» данных scrypt может вернуть пустой буфер и сравнение
  // пустого с пустым дало бы ложное true.
  if (!/^[0-9a-fA-F]+$/.test(storedHash) || !/^[0-9a-fA-F]+$/.test(storedSalt)) return false

  let expected: Buffer
  let actual: Buffer
  try {
    expected = Buffer.from(storedHash, "hex")
    if (expected.length !== SCRYPT_PARAMS.keylen) return false

    const saltBuffer = Buffer.from(storedSalt, "hex")
    if (saltBuffer.length < 8) return false

    actual = await scrypt(prepare(password), saltBuffer, expected.length, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      maxmem: SCRYPT_PARAMS.maxmem,
    })
  } catch {
    return false
  }

  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

/**
 * Дискриминированное объединение: если ok === false, сообщение об ошибке
 * гарантированно есть (иначе вызывающему коду приходилось бы писать ?? «...»).
 */
export type PasswordStrengthResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string }

/** Минимальные требования к паролю. Без «оценок сложности» — только проверяемые правила. */
export function validatePasswordStrength(password: string): PasswordStrengthResult {
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, error: "Пароль обязателен" }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`,
    }
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Пароль должен быть не длиннее ${MAX_PASSWORD_LENGTH} символов`,
    }
  }
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/\d/.test(password)) {
    return {
      ok: false,
      error: "Пароль должен содержать и буквы, и цифры",
    }
  }
  return { ok: true }
}

/** Сгенерировать случайный пароль (для сид-скрипта и сброса пароля логистом).
 *  Гарантированно содержит заглавную, строчную буквы и цифру — иначе не пройдёт
 *  собственные требования к паролю. */
export function generateTemporaryPassword(length = 12): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"
  const lower = "abcdefghijkmnopqrstuvwxyz"
  const digits = "23456789"
  const alphabet = upper + lower + digits

  const size = Math.max(length, MIN_PASSWORD_LENGTH)
  const pick = (set: string, bytes: Uint8Array, offset: number) =>
    set[bytes[offset] % set.length]

  const bytes = randomBytes(size)
  const chars = [
    pick(upper, bytes, 0),
    pick(lower, bytes, 1),
    pick(digits, bytes, 2),
  ]
  for (let i = 3; i < size; i++) {
    chars.push(pick(alphabet, bytes, i))
  }

  // Перемешивание (Fisher–Yates) на криптостойких байтах, чтобы обязательные
  // символы не всегда стояли в начале
  const shuffleBytes = randomBytes(size)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffleBytes[i] % (i + 1)
    const tmp = chars[i]
    chars[i] = chars[j]
    chars[j] = tmp
  }

  return chars.join("")
}
