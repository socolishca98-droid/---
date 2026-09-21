/**
 * POST /api/auth/logout — настоящий выход.
 *
 * Отзывает серверные сессии в БД (строки Session получают revokedAt),
 * а не только чистит состояние в браузере, и удаляет httpOnly-cookie
 * обеих ролей — сотрудника и водителя.
 *
 * Путь публичный по cookie-проверке: выйти можно даже с истёкшим токеном,
 * чтобы клиент гарантированно очистил сессию.
 */

import { NextRequest, NextResponse } from "next/server"
import { expiredSessionCookie, revokeRequestSessions } from "@/lib/auth/session"

import { DRIVER_COOKIE, STAFF_COOKIE } from "@/lib/auth/constants"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const revoked = await revokeRequestSessions(request, "logout")

  const response = NextResponse.json({
    success: true,
    revokedSessions: revoked.length,
  })
  response.cookies.set(expiredSessionCookie(STAFF_COOKIE))
  response.cookies.set(expiredSessionCookie(DRIVER_COOKIE))
  return response
}
