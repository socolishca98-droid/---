// app/api/ati/connection/route.ts
//
// Подключение организации к ATI.SU. У каждой организации СВОЙ аккаунт ATI:
// свой токен, свои площадки, свои подписки и лимиты.
//
//   GET    — состояние подключения (для всех сотрудников; токена в ответе нет)
//   POST   — сохранить постоянный токен из «Мои токены» (сотрудники штаба)
//   DELETE — отключить организацию (сотрудники штаба)
//
// Живая проверка токена — POST /api/ati/connection/check (отдельно, чтобы
// сохранение не зависело от доступности ATI.SU).

import { NextRequest, NextResponse } from "next/server"

import { requireStaff } from "@/lib/auth/session"
import { requireOrganization } from "@/lib/org"
import {
  connectionStatus,
  disconnectAti,
  saveManualToken,
} from "@/lib/ati/connection"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/rate-limiter"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const status = await connectionStatus(org.organizationId)
  return NextResponse.json({ success: true, ...status })
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  // Подключение затрагивает всю организацию — доступно сотрудникам штаба
  if (!["admin", "logist"].includes(auth.value.user.role)) {
    return NextResponse.json(
      { success: false, error: "Подключать ATI.SU могут сотрудники штаба" },
      { status: 403 },
    )
  }

  let body: { token?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Некорректное тело запроса" }, { status: 400 })
  }

  const token = String(body.token ?? "").trim()
  if (!token || token.length > 500) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Нужен access_token ATI.SU: создайте его в разделе «Мои токены» (ati.su/developers/tokens) по client_id нашего продукта",
      },
      { status: 400 },
    )
  }

  try {
    await saveManualToken(org.organizationId, token)
    await logAudit({
      actorId: org.userId,
      actorEmail: auth.value.user?.email ?? null,
      action: "update",
      targetType: "ati_connection",
      organizationId: org.organizationId,
      ip: getClientIp(request),
    })
    return NextResponse.json({
      success: true,
      // токен сохранён, но ещё не проверен — предложим нажать «Проверить»
      verified: false,
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Не удалось сохранить токен" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  if (!["admin", "logist"].includes(auth.value.user.role)) {
    return NextResponse.json(
      { success: false, error: "Отключать ATI.SU могут сотрудники штаба" },
      { status: 403 },
    )
  }

  await disconnectAti(org.organizationId)
  await logAudit({
    actorId: org.userId,
    actorEmail: auth.value.user?.email ?? null,
    action: "delete",
    targetType: "ati_connection",
    organizationId: org.organizationId,
    ip: getClientIp(request),
  })
  return NextResponse.json({ success: true })
}
