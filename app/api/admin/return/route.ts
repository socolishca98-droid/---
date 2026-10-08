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

export const dynamic = "force-dynamic"

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
  if (foreign) {
    const foreignUserId = foreign.kind === "driver" ? foreign.userId : foreign.user.id
    if (foreignUserId !== owner.userId) {
      await revokeSession(foreign.sessionId, "impersonation_end")
    }
  }

  const response = NextResponse.json({ success: true, redirectTo: "/owner" })
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
