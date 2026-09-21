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

  try {
    const result = await authenticateWithPassword({
      identifier: String(body.email ?? ""),
      password: String(body.password ?? ""),
      expectedRoles: STAFF_ROLES,
      kind: "staff",
      request,
    })

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, code: result.code },
        { status: result.status },
      )
    }

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
