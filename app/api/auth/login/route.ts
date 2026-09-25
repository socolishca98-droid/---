/**
 * POST /api/auth/login — вход сотрудника (admin / logist).
 *
 * Пароль проверяется НА СЕРВЕРЕ против хэша в базе (scrypt + соль).
 * Успех → строка Session в БД + подписанный токен в httpOnly-cookie.
 * Логика проверки общая с входом водителя: lib/auth/login.ts.
 */

import { NextRequest, NextResponse } from "next/server"
import { authenticateWithPassword } from "@/lib/auth/login"
import { sessionCookie } from "@/lib/auth/session"

import { STAFF_ROLES } from "@/lib/auth/constants"
import {
  buildRateLimitHeaders,
  checkRateLimit,
  getClientIp,
  recordFailure,
  resetRateLimit,
} from "@/lib/rate-limiter"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  let body: { email?: unknown; password?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "Некорректное тело запроса" },
      { status: 400 },
    )
  }

  const identifier = String(body.email ?? "")
  const rateLimitKey = `auth-login:${getClientIp(request)}:${identifier.toLowerCase()}`
  const rateLimit = checkRateLimit(rateLimitKey)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "Слишком много неудачных попыток (входа). Повторите через 15 минут",
        code: "rate_limited",
      },
      { status: 429, headers: buildRateLimitHeaders(rateLimit) },
    )
  }

  try {
    const result = await authenticateWithPassword({
      identifier,
      password: String(body.password ?? ""),
      expectedRoles: STAFF_ROLES,
      kind: "staff",
      request,
    })

    if (!result.ok) {
      const afterFailure = recordFailure(rateLimitKey)
      return NextResponse.json(
        { success: false, error: result.error, code: result.code },
        {
          status: afterFailure.allowed ? result.status : 429,
          headers: buildRateLimitHeaders(afterFailure),
        },
      )
    }

    resetRateLimit(rateLimitKey)

    const response = NextResponse.json({
      success: true,
      user: {
        id: result.userId,
        name: result.name,
        email: result.email,
        role: result.role,
        mustChangePassword: result.mustChangePassword,
      },
    })
    response.cookies.set(sessionCookie(result.session.cookieName, result.session.token))
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[auth/login] error:", message)
    return NextResponse.json(
      { success: false, error: "Не удалось выполнить вход. Попробуйте ещё раз" },
      { status: 500 },
    )
  }
}
