/**
 * GET /api/auth/session — текущая сессия (кто вошёл).
 *
 * Единственный источник правды для клиента: cookie + проверка в БД
 * (статус пользователя, отзыв сессии, срок действия). Клиентские контексты
 * (lib/auth-context.tsx, hooks/use-driver-session.ts) берут данные отсюда,
 * а не из localStorage.
 *
 * DELETE /api/auth/session — то же, что POST /api/auth/logout (для совместимости
 * с REST-ожиданиями клиента).
 */

import { NextRequest, NextResponse } from "next/server"
import {
  expiredSessionCookie,
  loadDriverSession,
  loadStaffSession,
  publicSessionView,
  revokeRequestSessions,
  touchSession,
} from "@/lib/auth/session"

import { DRIVER_COOKIE, STAFF_COOKIE } from "@/lib/auth/constants"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind") || "auto"

  try {
    if (kind === "driver") {
      const session = await loadDriverSession(request)
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Сессия водителя недействительна", code: "unauthorized" },
          { status: 401 },
        )
      }
      await touchSession(session.sessionId)
      return NextResponse.json({ success: true, session: publicSessionView(session) })
    }

    if (kind === "staff") {
      const session = await loadStaffSession(request)
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Сессия недействительна", code: "unauthorized" },
          { status: 401 },
        )
      }
      await touchSession(session.sessionId)
      return NextResponse.json({ success: true, session: publicSessionView(session) })
    }

    const session = (await loadStaffSession(request)) || (await loadDriverSession(request))
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Требуется авторизация", code: "unauthorized" },
        { status: 401 },
      )
    }
    await touchSession(session.sessionId)
    return NextResponse.json({ success: true, session: publicSessionView(session) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[auth/session] error:", message)
    return NextResponse.json(
      { success: false, error: "Не удалось получить данные сессии" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const revoked = await revokeRequestSessions(request, "logout")

  const response = NextResponse.json({
    success: true,
    revokedSessions: revoked.length,
  })
  response.cookies.set(expiredSessionCookie(STAFF_COOKIE))
  response.cookies.set(expiredSessionCookie(DRIVER_COOKIE))
  return response
}