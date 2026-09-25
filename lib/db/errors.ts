// lib/db/errors.ts
//
// Перевод ошибок Prisma на человеческий язык.
//
// В задаче 2 у Driver.phone появилось ограничение @unique (телефон — логин
// водителя). Без этого модуля повтор телефона отдавал бы клиенту 500 с
// техническим текстом Prisma на английском. Здесь такие ошибки превращаются
// в 409 и понятную фразу.

/** Поля PrismaClientKnownRequestError, которые нам нужны (без импорта типов). */
type DbError = {
  code?: string
  meta?: { target?: unknown; column_name?: unknown }
  message?: string
}

const asDbError = (error: unknown): DbError | null => {
  if (!error || typeof error !== "object") return null
  return error as DbError
}

/** Русские названия полей с ограничениями уникальности. */
const UNIQUE_FIELD_LABELS: Record<string, string> = {
  phone: "телефон",
  email: "e-mail",
  plate: "госномер",
  driverId: "привязка к водителю",
  sourceId: "идентификатор источника",
}

/** Это ошибка нарушения уникальности (Prisma code P2002)? */
export function isUniqueConstraintError(error: unknown): boolean {
  return asDbError(error)?.code === "P2002"
}

/** Имя поля, на котором сработало ограничение уникальности. */
export function uniqueFieldOf(error: unknown): string | null {
  const dbError = asDbError(error)
  if (dbError?.code !== "P2002") return null

  const target = dbError.meta?.target ?? dbError.meta?.column_name
  const fields = Array.isArray(target) ? target : typeof target === "string" ? [target] : []

  // Prisma может вернуть имя ограничения вида "Driver_phone_key"
  if (fields.length === 0 && typeof target === "string") fields.push(target)

  for (const raw of fields) {
    const name = String(raw)
    if (UNIQUE_FIELD_LABELS[name]) return name
    const fromConstraint = name.match(/_([A-Za-z]+)_key$/)
    if (fromConstraint && UNIQUE_FIELD_LABELS[fromConstraint[1]]) return fromConstraint[1]
  }

  return fields.length > 0 ? String(fields[0]) : null
}

/**
 * Понятное сообщение об ошибке БД или null, если случай не распознан
 * (тогда вызывающий код отдаёт исходную ошибку и статус 500).
 */
export function friendlyDbError(error: unknown): string | null {
  if (isUniqueConstraintError(error)) {
    const field = uniqueFieldOf(error)
    const label = field ? (UNIQUE_FIELD_LABELS[field] || field) : "такое значение"
    return `Запись с таким значением поля «${label}» уже есть`
  }

  const dbError = asDbError(error)

  // P2025 — запись не найдена при update/delete
  if (dbError?.code === "P2025") return "Запись не найдена"

  // P2003 — внешний ключ: ссылка на несуществующую запись
  if (dbError?.code === "P2003") {
    return "Не удалось сохранить: связанная запись (водитель, машина или рейс) не найдена"
  }

  return null
}

/** HTTP-статус для распознанной ошибки БД (409 — конфликт, 404 — не найдено). */
export function friendlyDbErrorStatus(error: unknown): number {
  const dbError = asDbError(error)
  if (dbError?.code === "P2025") return 404
  if (friendlyDbError(error)) return 409
  return 500
}
