// app/api/m/notifications/route.ts
//
// Уведомления водителя (задача 3, пункт 3).
//
// В базе уведомления водителям создавались и раньше (фото, СОС, догрузы), но
// мобильное приложение их не видело: раздел «Уведомления» читал только
// localStorage браузера. Из-за этого назначение рейса водителю было никому не
// видно. Теперь источник правды — таблица Notification, а localStorage
// остаётся лишь кэшем на случай отсутствия сети.
//
// GET  /api/m/notifications                — список уведомлений водителя
// POST /api/m/notifications { action, id? } — отметить прочитанным/удалить

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"

export const dynamic = "force-dynamic"

const MAX_NOTIFICATIONS = 50

type PostBody = {
  action?: unknown
  id?: unknown
}

export async function GET(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const notifications = await prisma.notification.findMany({
      where: scopedWhere(org.organizationId, { userId: auth.value.userId }),
      orderBy: { createdAt: "desc" },
      take: MAX_NOTIFICATIONS,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        priority: true,
        isRead: true,
        readAt: true,
        orderId: true,
        routeId: true,
        photoId: true,
        sosId: true,
        createdAt: true,
      },
    })

    return NextResponse.json({
      success: true,
      notifications: notifications.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        message: item.message,
        priority: item.priority,
        isRead: Boolean(item.isRead),
        readAt: item.readAt,
        orderId: item.orderId,
        routeId: item.routeId,
        photoId: item.photoId,
        sosId: item.sosId,
        createdAt: item.createdAt,
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить уведомления"
    console.error("[Mobile Notifications] GET error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const body = (await request.json().catch(() => ({}))) as PostBody
    const action = typeof body.action === "string" ? body.action : ""
    const id = typeof body.id === "string" ? body.id : null

    // В каждом запросе организация и учётка берутся из проверенной сессии:
    // чужим уведомлением нельзя ни пометить прочитанным, ни удалить его —
    // запись просто не попадёт в выборку.
    const mine = scopedWhere(org.organizationId, {
      userId: auth.value.userId,
      organizationId: org.organizationId,
    })

    if (action === "read" || action === "remove") {
      if (!id) {
        return NextResponse.json({ success: false, error: "Не указан id уведомления" }, { status: 400 })
      }

      if (action === "read") {
        await prisma.notification.updateMany({
          where: { ...mine, organizationId: org.organizationId, id },
          data: { isRead: true, readAt: new Date() },
        })
      } else {
        await prisma.notification.deleteMany({
          where: { ...mine, organizationId: org.organizationId, id },
        })
      }

      return NextResponse.json({ success: true })
    }

    if (action === "readAll") {
      await prisma.notification.updateMany({
        where: { ...mine, organizationId: org.organizationId, isRead: false },
        data: { isRead: true, readAt: new Date() },
      })
      return NextResponse.json({ success: true })
    }

    if (action === "clear") {
      await prisma.notification.deleteMany({
        where: { ...mine, organizationId: org.organizationId },
      })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json(
      { success: false, error: "Неизвестное действие: read, readAll, remove, clear" },
      { status: 400 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось обновить уведомления"
    console.error("[Mobile Notifications] POST error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
