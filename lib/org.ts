// lib/org.ts — организация (тенант) в контексте запроса.
//
// Правило задачи «Организации»: организация пользователя берётся ТОЛЬКО из
// проверенной серверной сессии (строка Session → User/Driver → organizationId).
// Значение из тела запроса, query-параметров или заголовков не принимается
// никогда — иначе логист одной компании получил бы данные другой.
//
// Как пользоваться в API-роуте:
//
//   const auth = await requireStaff(request)
//   if (!auth.ok) return auth.response
//   const org = requireOrganization(auth.value)
//   if (!org.ok) return org.response
//
//   const orders = await prisma.order.findMany({
//     where: scopedWhere(org.organizationId, { status: "confirmed" }),
//   })
//
// Для водительских роутов — то же самое через requireDriver: организация
// берётся из карточки водителя (Driver.organizationId).

import { NextResponse } from "next/server"

import type { AnySession, DriverSession, StaffSession } from "@/lib/auth/session"

/** Кто выполняет запрос и к какой организации он относится. */
export interface OrgContext {
  /** Идентификатор организации — ключ всех фильтров */
  organizationId: string
  /** Кто действует: сотрудник или водитель */
  kind: "staff" | "driver"
  /** Идентификатор действующего лица (User.id) */
  userId: string
  /** Роль: admin | logist | driver */
  role: string
  /** Удобный флаг для проверок «только админ организации» */
  isAdmin: boolean
  /** Идентификатор карточки водителя (для водительских сессий) */
  driverId: string | null
}

export type OrgGuard =
  | { ok: true } & OrgContext
  | { ok: false; response: NextResponse }

/** Организация сотрудника (может отсутствовать у записей до миграции). */
export function organizationIdOfStaff(session: StaffSession): string | null {
  return session.user.organizationId ?? null
}

/** Организация водителя: карточка водителя, иначе его учётная запись. */
export function organizationIdOfDriver(session: DriverSession): string | null {
  return session.driver.organizationId ?? null
}

/** Организация любой из двух сессий. */
export function organizationIdOf(session: AnySession): string | null {
  return session.kind === "staff"
    ? organizationIdOfStaff(session)
    : organizationIdOfDriver(session)
}

function forbidden(message: string): NextResponse {
  return NextResponse.json({ success: false, error: message, code: "no_organization" }, { status: 403 })
}

/**
 * Организация из сессии либо отказ 403.
 *
 * 403 (а не 500) возвращается, когда учётная запись существует, но не
 * привязана к организации: это значит, что перенос данных не завершён
 * (`npm run db:migrate-orgs`) либо запись создали в обход регистрации.
 */
export function requireOrganization(session: AnySession): OrgGuard {
  const organizationId = organizationIdOf(session)

  if (session.kind === "staff") {
    if (!organizationId) {
      return {
        ok: false,
        response: forbidden(
          "Учётная запись не привязана к организации. Запустите перенос данных: npm run db:migrate-orgs",
        ),
      }
    }
    return {
      ok: true,
      organizationId,
      kind: "staff",
      userId: session.user.id,
      role: session.user.role,
      isAdmin: session.user.role === "admin",
      driverId: null,
    }
  }

  if (!organizationId) {
    return {
      ok: false,
      response: forbidden("Карточка водителя не привязана к организации"),
    }
  }
  return {
    ok: true,
    organizationId,
    kind: "driver",
    userId: session.userId,
    role: "driver",
    isAdmin: false,
    driverId: session.driver.id,
  }
}

/**
 * Фильтр Prisma: условия запроса + обязательная привязка к организации.
 *
 * Порядок аргументов важен: организация последней перезаписывает любую
 * попытку передать organizationId извне.
 */
export function scopedWhere<T extends Record<string, unknown>>(
  organizationId: string,
  where?: T,
): T & { organizationId: string } {
  return { ...(where || ({} as T)), organizationId }
}

/** Тот же фильтр для строки организации из guard'а. */
export function scopedWhereFor<T extends Record<string, unknown>>(
  org: OrgContext,
  where?: T,
): T & { organizationId: string } {
  return scopedWhere(org.organizationId, where)
}

/**
 * Проверка, что конкретная запись принадлежит организации вызывающего.
 * Используется там, где запись сначала найдена по id (например, `findUnique`),
 * чтобы чужой id не открыл чужие данные.
 */
export function belongsToOrganization(
  record: { organizationId?: string | null } | null | undefined,
  organizationId: string,
): boolean {
  return Boolean(record && record.organizationId === organizationId)
}

/** Ответ 404 для чужой записи (намеренно не 403: не раскрываем существование). */
export function notFoundInOrganization(entity: string): NextResponse {
  return NextResponse.json(
    { success: false, error: `${entity} не найдена` },
    { status: 404 },
  )
}
