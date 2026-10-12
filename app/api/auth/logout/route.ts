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
import { expiredSessionCookie, revokeRequestSessions, revokeSession } from "@/lib/auth/session"
import { verifySessionToken } from "@/lib/auth/token"

import { DRIVER_COOKIE, IMPERSONATION_COOKIE, STAFF_COOKIE } from "@/lib/auth/constants"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const revoked = await revokeRequestSessions(request, "logout")

  // Режим «вход как»: собственная сессия владельца лежит в отдельной cookie.
  // Выход должен закрыть и её, иначе после выхода полоса «Вы вошли как …» остаётся.
  const ownerToken = request.cookies.get(IMPERSONATION_COOKIE)?.value
  if (ownerToken) {
    const ownerPayload = await verifySessionToken(ownerToken)
    if (ownerPayload?.jti) {
      try {
        await revokeSession(ownerPayload.jti, "logout")
      } catch (error) {
        console.error("[auth] не удалось отозвать сессию владельца:", error)
      }
    }
  }

  const response = NextResponse.json({
    success: true,
    revokedSessions: revoked.length,
  })
  response.cookies.set(expiredSessionCookie(STAFF_COOKIE))
  response.cookies.set(expiredSessionCookie(DRIVER_COOKIE))
  response.cookies.set(expiredSessionCookie(IMPERSONATION_COOKIE))
  return response
}
