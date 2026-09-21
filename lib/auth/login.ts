/**
 * Общая серверная процедура входа по паролю.
 *
 * Один и тот же код используется для сотрудника (/api/auth/login) и для
 * водителя (/api/m/login) — отличаться должны только идентификатор (email или
 * телефон) и выдаваемая роль, а не логика проверки. Иначе две реализации
 * неизбежно разъезжаются.
 *
 * Что делает:
 *  1. ищет учётную запись по идентификатору;
 *  2. проверяет временную блокировку после серии неудачных попыток;
 *  3. проверяет пароль (scrypt + соль) — для несуществующей учётки выполняет
 *     фиктивную проверку, чтобы время ответа не выдавало существование адреса;
 *  4. проверяет статус (pending / suspended — не пускаем);
 *  5. создаёт строку Session и подписывает токен для httpOnly-cookie.
 */

import "server-only"
import type { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyPassword } from "@/lib/auth/password"
import { issueSession, type IssuedSession } from "@/lib/auth/session"
import {
  LOGIN_LOCK_MINUTES,
  MAX_FAILED_LOGINS,
  normalizePhone,
  type UserRole,
} from "@/lib/auth/constants"
import type { SessionKind } from "@/lib/auth/token"

/** Фиктивный хэш для выравнивания времени ответа */
const DUMMY_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000"
const DUMMY_SALT = "00000000000000000000000000000000"

export type LoginSuccess = {
  ok: true
  userId: string
  name: string
  role: UserRole
  mustChangePassword: boolean
  email: string | null
  phone: string | null
  driverId: string | null
  session: IssuedSession
}

export type LoginFailure = {
  ok: false
  status: 400 | 401 | 403 | 429 | 500
  error: string
  code:
    | "invalid_request"
    | "invalid_credentials"
    | "pending_approval"
    | "suspended"
    | "locked"
    | "not_found"
    | "server_error"
}

export type LoginResult = LoginSuccess | LoginFailure

export interface AuthenticateParams {
  /** email — для сотрудника, телефон — для водителя */
  identifier: string
  password: string
  /** какие роли разрешено пускать через этот вход */
  expectedRoles: UserRole[]
  kind: SessionKind
  request: NextRequest
}

export async function authenticateWithPassword(
  params: AuthenticateParams,
): Promise<LoginResult> {
  const { identifier, password, expectedRoles, kind, request } = params

  const normalized =
    kind === "driver" ? normalizePhone(identifier) : identifier.trim().toLowerCase()

  if (!normalized || !password) {
    return {
      ok: false,
      status: 400,
      error: kind === "driver" ? "Телефон и пароль обязательны" : "Email и пароль обязательны",
      code: "invalid_request",
    }
  }

  const user = await prisma.user.findUnique({
    where: kind === "driver" ? { phone: normalized } : { email: normalized },
  })

  if (!user || !expectedRoles.includes(user.role as UserRole)) {
    // фиктивная проверка пароля: время ответа не должно выдавать наличие учётки
    await verifyPassword(password, DUMMY_HASH, DUMMY_SALT)
    return {
      ok: false,
      status: 401,
      error: kind === "driver" ? "Неверный телефон или пароль" : "Неверный email или пароль",
      code: "invalid_credentials",
    }
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000)
    return {
      ok: false,
      status: 429,
      error: `Слишком много неудачных попыток входа. Повторите через ${minutes} мин.`,
      code: "locked",
    }
  }

  const passwordOk = await verifyPassword(password, user.passwordHash, user.passwordSalt)

  if (!passwordOk) {
    const failed = (user.failedLoginCount || 0) + 1
    const shouldLock = failed >= MAX_FAILED_LOGINS

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed,
        lockedUntil: shouldLock ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60_000) : null,
      },
    })

    if (shouldLock) {
      return {
        ok: false,
        status: 429,
        error: `Превышено число попыток. Вход заблокирован на ${LOGIN_LOCK_MINUTES} мин.`,
        code: "locked",
      }
    }

    return {
      ok: false,
      status: 401,
      error: kind === "driver" ? "Неверный телефон или пароль" : "Неверный email или пароль",
      code: "invalid_credentials",
    }
  }

  if (user.status === "pending") {
    return {
      ok: false,
      status: 403,
      error: "Учётная запись ожидает одобрения логиста",
      code: "pending_approval",
    }
  }

  if (user.status !== "active") {
    return {
      ok: false,
      status: 403,
      error: user.suspendReason
        ? `Доступ закрыт: ${user.suspendReason}`
        : "Доступ к системе закрыт. Обратитесь к администратору",
      code: "suspended",
    }
  }

  const session = await issueSession({
    userId: user.id,
    role: user.role as UserRole,
    kind,
    name: user.name,
    driverId: user.driverId,
    request,
  })

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
  })

  return {
    ok: true,
    userId: user.id,
    name: user.name,
    role: user.role as UserRole,
    mustChangePassword: user.mustChangePassword,
    email: user.email,
    phone: user.phone,
    driverId: user.driverId,
    session,
  }
}
