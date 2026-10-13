// app/api/push/route.ts
//
// Web Push: подписка устройства и её отмена.
//
// GET    /api/push                 — включены ли пуши и подписан ли этот браузер
// POST   /api/push {endpoint, keys} — запомнить подписку
// DELETE /api/push {endpoint}       — отписать это устройство
//
// Зачем через сервер: ключи подписки должны лежать рядом с учётной записью,
// иначе при входе с другого устройства пуши не придут. Владелец подписки
// определяется сессией, а не телом запроса: иначе можно было бы подписать на
// пуши чужую учётную запись.
//
// Работает и для штаба (логист/админ), и для водителя: «назначен рейс» и
// «СОС» нужны именно тем, кто сейчас не в приложении.

import { NextRequest, NextResponse } from "next/server"

import { requireAnySession, type AnySession } from "@/lib/auth/session"
import { prisma } from "@/lib/prisma"
import { hasVapidKeys } from "@/lib/push/vapid"
import { formatZodError, pushSubscribeSchema, pushUnsubscribeSchema } from "@/lib/validators"

export const dynamic = "force-dynamic"

/** Сколько устройств держим на одного человека: телефон + компьютер + планшет. */
const MAX_SUBSCRIPTIONS_PER_USER = 10

/**
 * Идентификатор учётной записи из любой сессии: у сотрудника он в user.id,
 * у водителя — userId. Путать нельзя: подписка привязана к аккаунту, иначе
 * водитель получал бы пуши, адресованные логисту.
 */
function sessionUserId(session: AnySession): string {
  return session.kind === "driver" ? session.userId : session.user.id
}

export async function GET(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: sessionUserId(auth.value) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      endpoint: true,
      userAgent: true,
      createdAt: true,
      lastUsedAt: true,
    },
  })

  return NextResponse.json({
    success: true,
    // Без ключей пуши выключены целиком — клиенту нечего показывать в настройках
    enabled: hasVapidKeys(process.env),
    publicKey: process.env.VAPID_PUBLIC_KEY?.trim() || null,
    subscriptions: subscriptions.map((item) => ({
      id: item.id,
      endpoint: item.endpoint,
      userAgent: item.userAgent,
      createdAt: item.createdAt,
      lastUsedAt: item.lastUsedAt,
    })),
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  if (!hasVapidKeys(process.env)) {
    return NextResponse.json(
      { success: false, error: "Push-уведомления не настроены на сервере" },
      { status: 503 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Некорректный JSON" }, { status: 400 })
  }

  const parsed = pushSubscribeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validation failed", details: formatZodError(parsed.error) },
      { status: 400 },
    )
  }

  const { endpoint, keys, userAgent } = parsed.data
  const userId = sessionUserId(auth.value)

  // Повторная подписка с того же браузера не должна плодить записи
  const existing = await prisma.pushSubscription.findUnique({ where: { endpoint } })
  if (existing && existing.userId !== userId) {
    // Чужая подписка на этот endpoint: молча забирать нельзя
    return NextResponse.json(
      { success: false, error: "Это устройство уже подписано на другую учётную запись" },
      { status: 409 },
    )
  }

  const count = await prisma.pushSubscription.count({ where: { userId } })
  if (!existing && count >= MAX_SUBSCRIPTIONS_PER_USER) {
    return NextResponse.json(
      {
        success: false,
        error: `Слишком много устройств (максимум ${MAX_SUBSCRIPTIONS_PER_USER}). Отпишите лишние.`,
      },
      { status: 409 },
    )
  }

  const subscription = await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    },
    update: {
      userId,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    },
    select: { id: true, endpoint: true, createdAt: true },
  })

  return NextResponse.json({ success: true, subscription })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Некорректный JSON" }, { status: 400 })
  }

  const parsed = pushUnsubscribeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validation failed", details: formatZodError(parsed.error) },
      { status: 400 },
    )
  }

  // Удаляем только свою подписку: userId в условии — защита от чужого endpoint
  const result = await prisma.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, userId: sessionUserId(auth.value) },
  })

  return NextResponse.json({ success: true, removed: result.count })
}
