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

import { DRIVER_COOKIE, STAFF_COOKIE, STAFF_ROLES } from "@/lib/auth/constants"
import { loadActingOwner } from "@/lib/auth/impersonation"
import { isOwnerEmail } from "@/lib/auth/owner"
import { verifySessionToken } from "@/lib/auth/token"
import { prisma } from "@/lib/prisma"

/**
 * Почему сессия не действует. Вызывается ТОЛЬКО на отказном ответе —
// обычный запрос причины не вычисляет.
 *
 * Зачем: «меня выкинуло на страницу входа» без причины — это час
 * дебага по одному описанию. Причина видна владельцу в сообщении
 * (клиент «входа как» показывает её до перехода) и в журнале браузера.
 */
async function sessionFailReason(
  request: NextRequest,
  kind: "staff" | "driver",
): Promise<string> {
  try {
    const token =
      kind === "driver"
        ? request.cookies.get(DRIVER_COOKIE)?.value
        : request.cookies.get(STAFF_COOKIE)?.value
    const payload = token ? await verifySessionToken(token) : null
    if (!payload) return "token_invalid"
    if (payload.kind !== kind) return "kind_mismatch"
    const [row, user] = await Promise.all([
      prisma.session.findUnique({
        where: { id: payload.jti },
        select: { userId: true, revokedAt: true, expiresAt: true },
      }),
      prisma.user.findUnique({
        where: { id: payload.sub },
        select: { status: true, role: true, driverId: true },
      }),
    ])
    if (!row) return "session_row_missing"
    if (row.userId !== payload.sub) return "session_user_mismatch"
    if (row.revokedAt) return "session_revoked"
    if (row.expiresAt.getTime() <= Date.now()) return "session_expired"
    if (!user) return "user_missing"
    if (user.status === "suspended") return "user_suspended"
    if (user.status !== "active") return "user_inactive"
    if (kind === "staff" && !STAFF_ROLES.includes(user.role as never)) return "role_rejected"
    if (kind === "driver" && (user.role !== "driver" || !user.driverId)) return "role_rejected"
    return "unknown"
  } catch {
    return "check_failed"
  }
}

export const dynamic = "force-dynamic"

/** Кто смотрит чужой аккаунт и является ли текущий пользователь владельцем.
 *  Владельцу клиент показывает вход на страницу администрирования. */
async function accessContext(request: NextRequest) {
  const acting = await loadActingOwner(request)
  return {
    owner: acting ? { name: acting.name, email: acting.email } : null,
  }
}

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind") || "auto"
  const context = await accessContext(request)

  try {
    if (kind === "driver") {
      const session = await loadDriverSession(request)
      if (!session) {
        return NextResponse.json(
          {
            success: false,
            error: "Сессия водителя недействительна",
            code: "unauthorized",
            reason: await sessionFailReason(request, "driver"),
          },
          { status: 401 },
        )
      }
      await touchSession(session.sessionId)
      return NextResponse.json({
        success: true,
        session: publicSessionView(session),
        impersonation: context.owner,
        isOwner: false,
      })
    }

    if (kind === "staff") {
      const session = await loadStaffSession(request)
      if (!session) {
        return NextResponse.json(
          {
            success: false,
            error: "Сессия недействительна",
            code: "unauthorized",
            reason: await sessionFailReason(request, "staff"),
          },
          { status: 401 },
        )
      }
      await touchSession(session.sessionId)
      return NextResponse.json({
        success: true,
        session: publicSessionView(session),
        impersonation: context.owner,
        // и33: «владелец» — свойство ТЕКУЩЕЙ сессии, а не отсутствие чужой
        // cookie. Пока владелец смотрит чужой ВОДИТЕЛЬНЫЙ аккаунт, штабная
        // сессия — его собственная, и пульт /owner обязан открываться:
        // раньше isOwner гаснул и пульт вышибал его в /lm или кабинет.
        isOwner: isOwnerEmail(session.user.email),
      })
    }

    const session = (await loadStaffSession(request)) || (await loadDriverSession(request))
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Требуется авторизация", code: "unauthorized" },
        { status: 401 },
      )
    }
    await touchSession(session.sessionId)
    return NextResponse.json({
      success: true,
      session: publicSessionView(session),
      impersonation: context.owner,
      isOwner: session.kind === "staff" && isOwnerEmail(session.user.email),
    })
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