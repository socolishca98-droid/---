// app/api/admin/return/route.ts
//
// POST /api/admin/return — «вернуться к себе» после входа в чужой аккаунт.
//
// Возвращает владельцу его собственную сессию из cookie IMPERSONATION_COOKIE
// и отзывает сессию, выданную для чужого аккаунта: чужой вход не должен
// оставаться действующим после того, как владелец посмотрел.

import { NextRequest, NextResponse } from "next/server"

import { loadDriverSession, loadStaffSession, revokeSession, unauthorized } from "@/lib/auth/session"
import { DRIVER_COOKIE, IMPERSONATION_COOKIE, STAFF_COOKIE, getSessionTtlSeconds } from "@/lib/auth/constants"
import { loadActingOwner } from "@/lib/auth/impersonation"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/rate-limiter"

export const dynamic = "force-dynamic"

/** Действие выполнено, но запись в журнал не сохранилась — сказать об этом вслух. */
const AUDIT_WARNING =
  "Возврат выполнен, но запись в журнал не сохранилась. Проверьте журнал позже."

export async function POST(request: NextRequest) {
  const owner = await loadActingOwner(request)
  if (!owner) {
    return unauthorized("Сохранённой сессии владельца нет — войдите заново")
  }

  // Отзываем ИМЕННО сессию чужого аккаунта, а не свою.
  //
  // Тонкость: когда мы смотрим чужой штабной аккаунт, cookie сотрудника
  // содержит его сессию (своя лежит в отдельной cookie и ждёт возврата),
  // а когда смотрим водителя — cookie сотрудника всё ещё наша. Поэтому
  // сначала проверяем водительский контур: если он есть, отзываем его;
  // иначе отзываем ту штабную сессию, которая сейчас в cookie, но только
  // если она не наша собственная.
  const driverSession = await loadDriverSession(request)
  const staffSession = await loadStaffSession(request)

  const foreign = driverSession ?? staffSession
  let foreignUserId: string | null = null
  let foreignEmail: string | null = null
  let foreignKind: "driver" | "staff" = "staff"
  let foreignOrganizationId: string | null = null
  let foreignRevoked = false
  if (foreign) {
    foreignUserId = foreign.kind === "driver" ? foreign.userId : foreign.user.id
    foreignKind = foreign.kind
    if (foreign.kind === "driver") {
      foreignEmail = foreign.driver.phone ?? null
      foreignOrganizationId = foreign.driver.organizationId ?? null
    } else {
      foreignEmail = foreign.user.email ?? null
      foreignOrganizationId = foreign.user.organizationId ?? null
    }
    if (foreignUserId !== owner.userId) {
      await revokeSession(foreign.sessionId, "impersonation_end")
      foreignRevoked = true
    }
  }

  // Завершение подключения — такое же важное событие, как и само подключение:
  // без записи в журнале непонятно, когда владелец перестал смотреть чужой
  // аккаунт, и запись «вошёл как» остаётся без пары.
  const logged = await logAudit({
    organizationId: foreignOrganizationId,
    actorId: owner.userId,
    actorEmail: owner.email,
    action: "impersonation_end",
    targetId: foreignUserId ?? null,
    targetType: foreignKind === "driver" ? "driver" : "user",
    targetEmail: foreignEmail,
    metadata: {
      ownerName: owner.name,
      revokedForeignSession: foreignRevoked,
      requestId: request.headers.get("x-request-id") ?? null,
    },
    ip: getClientIp(request),
  })

  const response = NextResponse.json({
    success: true,
    redirectTo: "/owner",
    ...(logged ? {} : { warning: AUDIT_WARNING }),
  })
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getSessionTtlSeconds(),
  }

  response.cookies.set({ name: STAFF_COOKIE, value: owner.token, ...options })
  response.cookies.set({ name: DRIVER_COOKIE, value: "", ...options, maxAge: 0 })
  response.cookies.set({ name: IMPERSONATION_COOKIE, value: "", ...options, maxAge: 0 })
  return response
}
