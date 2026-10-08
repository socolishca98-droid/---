// app/api/admin/impersonate/route.ts
//
// POST /api/admin/impersonate — «войти как» (в любой аккаунт).
//
// Кому можно: только владельцу платформы (lib/auth/owner.ts). Он входит своим
// паролем, а этот адрес выпускает сессию уже для нужного аккаунта.
//
// Как это работает:
//   1. Проверяем, что запрос пришёл от владельца (проверенная сессия + email).
//   2. Если это первый «вход как» — сохраняем собственную сессию владельца
//      в отдельную httpOnly-cookie, чтобы было куда вернуться.
//   3. Выпускаем новую сессию: сотруднику — сессию сотрудника, водителю —
//      сессию водителя. Старую (свою) не отзываем: она нужна для возврата.
//   4. Пишем запись в журнал: кто, кем и когда вошёл. Действие видно в «Журнале».
//
// Тело: { userId } | { driverId }

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { issueSession, requireStaff, sessionCookie, unauthorized } from "@/lib/auth/session"
import { IMPERSONATION_COOKIE, DRIVER_COOKIE, STAFF_COOKIE } from "@/lib/auth/constants"
import { isOwnerEmail } from "@/lib/auth/owner"
import { getSessionTtlSeconds } from "@/lib/auth/constants"
import { logAudit } from "@/lib/audit"
import type { UserRole } from "@/lib/auth/constants"

export const dynamic = "force-dynamic"

type Body = { userId?: unknown; driverId?: unknown }

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getSessionTtlSeconds(),
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const owner = auth.value.user
  if (!isOwnerEmail(owner.email)) {
    return unauthorized("Вход в чужой аккаунт доступен только владельцу платформы")
  }

  const body = (await request.json().catch(() => null)) as Body | null
  const userId = typeof body?.userId === "string" ? body.userId : null
  const driverId = typeof body?.driverId === "string" ? body.driverId : null

  if (!userId && !driverId) {
    return NextResponse.json(
      { success: false, error: "Укажите userId или driverId" },
      { status: 400 },
    )
  }

  // ── Находим цель ──────────────────────────────────────────────────────────
  let targetUserId: string | null = null
  let targetRole: UserRole | null = null
  let targetName = ""
  let targetEmail: string | null = null
  let targetDriverId: string | null = null
  // Компания входа — чтобы журнал владельца показывал, в какой компании вошли
  let targetOrganizationId: string | null = null
  let redirectTo = "/lm"

  if (driverId) {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, name: true, phone: true, status: true, organizationId: true },
    })
    if (!driver) {
      return NextResponse.json({ success: false, error: "Водитель не найден" }, { status: 404 })
    }

    // Вход водителю нужен даже если у него ещё нет учётной записи: тогда
    // находим или создаём её — иначе сессию выпустить не для кого.
    const existing = await prisma.user.findFirst({
      where: { driverId: driver.id },
      select: { id: true, status: true, email: true },
    })

    if (existing) {
      targetUserId = existing.id
      targetEmail = existing.email
    } else {
      const created = await prisma.user.create({
        data: {
          organizationId: driver.organizationId,
          name: driver.name,
          phone: driver.phone ?? null,
          role: "driver",
          status: "active",
          driverId: driver.id,
          // Пароль владельцу не нужен: он входит через «вход как». Ставим
          // случайную строку, чтобы вход по паролю был невозможен.
          passwordHash: `impersonation-only:${driver.id}`,
          passwordSalt: "none",
        },
        select: { id: true },
      })
      targetUserId = created.id
    }

    targetRole = "driver"
    targetDriverId = driver.id
    targetOrganizationId = driver.organizationId ?? null
    targetName = driver.name
    redirectTo = "/m"
  } else if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        driverId: true,
        organizationId: true,
      },
    })
    if (!user) {
      return NextResponse.json({ success: false, error: "Пользователь не найден" }, { status: 404 })
    }
    if (user.role === "driver" && !user.driverId) {
      return NextResponse.json(
        { success: false, error: "У водителя нет карточки — выберите карточку в разделе «Водители»" },
        { status: 400 },
      )
    }

    targetUserId = user.id
    targetRole = user.role as UserRole
    targetName = user.name
    targetEmail = user.email
    targetDriverId = user.driverId
    targetOrganizationId = user.organizationId ?? null
    redirectTo = user.role === "driver" ? "/m" : "/lm"
  }

  if (!targetUserId || !targetRole) {
    return NextResponse.json({ success: false, error: "Не удалось определить аккаунт" }, { status: 400 })
  }

  // ── Выпускаем сессию цели ─────────────────────────────────────────────────
  const kind = targetRole === "driver" ? "driver" : "staff"
  const session = await issueSession({
    userId: targetUserId,
    role: targetRole,
    kind,
    name: targetName,
    driverId: targetDriverId,
    request,
  })

  const response = NextResponse.json({
    success: true,
    impersonating: {
      name: targetName,
      email: targetEmail,
      role: targetRole,
      kind,
    },
    redirectTo,
  })

  // Свою сессию сохраняем один раз — на время просмотра чужого аккаунта
  const ownToken = request.cookies.get(STAFF_COOKIE)?.value
  if (ownToken && !request.cookies.get(IMPERSONATION_COOKIE)?.value) {
    response.cookies.set({ name: IMPERSONATION_COOKIE, value: ownToken, ...cookieOptions() })
  }

  // Сессия нужного контура: входим как сотрудник ИЛИ как водитель
  response.cookies.set({ name: session.cookieName, value: session.token, ...cookieOptions() })

  // Второй контур не должен мешать: если вошли как водитель — «своя» штабная
  // cookie остаётся (она же нужна для возврата), но вход в чужой штабной
  // аккаунт не должен оставлять старую водительскую сессию.
  if (kind === "staff" && request.cookies.get(DRIVER_COOKIE)?.value) {
    response.cookies.set({ name: DRIVER_COOKIE, value: "", ...cookieOptions(), maxAge: 0 })
  }

  await logAudit({
    organizationId: targetOrganizationId,
    actorId: owner.id,
    actorEmail: owner.email,
    action: "impersonate",
    targetId: targetUserId,
    targetType: targetDriverId ? "driver" : "user",
    targetEmail: targetEmail,
    metadata: { role: targetRole, name: targetName, driverId: targetDriverId },
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  })

  return response
}
