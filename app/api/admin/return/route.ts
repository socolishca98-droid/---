// app/api/admin/return/route.ts
//
// POST /api/admin/return — «вернуться к себе» после входа в чужой аккаунт.
//
// Возвращает владельцу его собственную сессию из cookie IMPERSONATION_COOKIE
// и отзывает сессию, выданную для чужого аккаунта: чужой вход не должен
// оставаться действующим после того, как владелец посмотрел.
//
// GET /api/admin/return?next=/owner/… — то же самое, но переходом (и51):
// proxy отправляет сюда владельца, который открыл штабную страницу без
// штабной cookie (телефон потерял её за ночь), но с живой cookie
// имперсонации. Вместо формы входа — восстановление сессии и возврат
// на задуманную страницу.

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

/** Куда можно возвращать после восстановления (анти-open-redirect). */
function safeNextPath(raw: string | null): string {
  if (!raw) return "/owner"
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("://")) return "/owner"
  return raw
}

/**
 * Origin из заголовков запроса. request.url и request.nextUrl внутри рантайма
 * могут быть адресом привязки (0.0.0.0 в деве) — абсолютный редирект на такой
 * адрес уводил браузер на «чужой» origin, и восстановленные cookie не
 * отправлялись дальше. Заголовок Host браузер присылает всегда; на Vercel
 * есть и x-forwarded-host/x-forwarded-proto.
 */
function requestOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (host) {
    const proto =
      request.headers.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("0.0.0.0")
        ? "http"
        : "https")
    return `${proto}://${host}`
  }
  return request.nextUrl.origin
}

interface ReturnOutcome {
  error?: NextResponse
  ownerToken?: string
  logged?: boolean
}

/** Общая логика возврата: проверка, отзыв чужой сессии, запись в журнал. */
async function performReturn(request: NextRequest): Promise<ReturnOutcome> {
  const owner = await loadActingOwner(request)
  if (!owner) {
    return { error: unauthorized("Сохранённой сессии владельца нет — войдите заново") }
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

  return { ownerToken: owner.token, logged }
}

/** Cookie возврата: штабная — восстановленная, остальные — сброс. */
function returnCookies(response: NextResponse, ownerToken: string): NextResponse {
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getSessionTtlSeconds(),
  }
  response.cookies.set({ name: STAFF_COOKIE, value: ownerToken, ...options })
  response.cookies.set({ name: DRIVER_COOKIE, value: "", ...options, maxAge: 0 })
  response.cookies.set({ name: IMPERSONATION_COOKIE, value: "", ...options, maxAge: 0 })
  return response
}

export async function POST(request: NextRequest) {
  const outcome = await performReturn(request)
  if (outcome.error) return outcome.error

  const response = NextResponse.json({
    success: true,
    redirectTo: "/owner",
    ...(outcome.logged ? {} : { warning: AUDIT_WARNING }),
  })
  return returnCookies(response, outcome.ownerToken!)
}

export async function GET(request: NextRequest) {
  // и51: спасение переходом — proxy присылает сюда владельца без штабной
  // cookie (но с живой cookie имперсонации) с параметром ?next=…
  const outcome = await performReturn(request)
  if (outcome.error) return outcome.error

  const target = safeNextPath(request.nextUrl.searchParams.get("next"))
  // и51б: origin из заголовка Host — request.nextUrl внутри рантайма видит
  // адрес привязки (0.0.0.0 в деве), и абсолютный редирект на него уводил
  // браузер на «чужой» адрес, теряя только что восстановленные cookie.
  const response = NextResponse.redirect(new URL(target, requestOrigin(request)))
  return returnCookies(response, outcome.ownerToken!)
}
