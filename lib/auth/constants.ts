/**
 * Общие константы авторизации.
 *
 * Файл намеренно не содержит серверной логики — его импортирует middleware
 * (edge-окружение), поэтому здесь не должно быть импортов node:* и Prisma.
 */

/** Название продукта — единое для всего интерфейса */
export const PRODUCT_NAME = "Loginex"

/** Cookie с сессией сотрудника (admin / logist) */
export const STAFF_COOKIE = "loginex_staff_session"

/** Cookie с сессией водителя (driver) */
export const DRIVER_COOKIE = "loginex_driver_session"

/** Заголовки, которые middleware проставляет после проверки токена.
 *  Входящие запросы с такими заголовками middleware всегда очищает,
 *  чтобы клиент не мог их подделать. */
export const IDENTITY_HEADERS = {
  userId: "x-loginex-user-id",
  role: "x-loginex-role",
  sessionId: "x-loginex-session-id",
} as const

export const USER_ROLES = ["admin", "logist", "driver"] as const
export type UserRole = (typeof USER_ROLES)[number]

export const STAFF_ROLES: UserRole[] = ["admin", "logist"]

export const USER_STATUSES = ["pending", "active", "suspended"] as const
export type UserStatus = (typeof USER_STATUSES)[number]

/** Время жизни сессии по умолчанию — 12 часов */
const DEFAULT_TTL_HOURS = 12

/** Максимум неудачных попыток входа до временной блокировки */
export const MAX_FAILED_LOGINS = 5

/** На сколько блокируем учётную запись после превышения лимита попыток */
export const LOGIN_LOCK_MINUTES = 15

/** Время жизни сессии в миллисекундах (из AUTH_SESSION_TTL_HOURS) */
export function getSessionTtlMs(): number {
  const raw = Number(process.env.AUTH_SESSION_TTL_HOURS)
  const hours = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_HOURS
  return Math.round(hours * 60 * 60 * 1000)
}

/** Возраст cookie в секундах (для httpOnly-cookie) */
export function getSessionTtlSeconds(): number {
  return Math.round(getSessionTtlMs() / 1000)
}

/** Нормализация телефона до формата 7XXXXXXXXXX (для входа водителей) */
export function normalizePhone(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "")
  if (digits.startsWith("8") && digits.length === 11) return "7" + digits.slice(1)
  return digits
}
