// app/api/routes/[routeId]/complete/route.ts
// Завершение рейса диспетчером. Сама логика завершения живёт в
// lib/routes/complete-route.ts — тем же путем идёт водительский finish_trip
// (POST /api/m/route/stage). Здесь только доступ, разбор тела и HTTP-ответ.

import { NextRequest, NextResponse } from "next/server"

import { deliverNotificationPush } from "@/lib/notifications/create"
import {
  canDriverAccessRoute,
  forbidden,
  requireAnySession,
} from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { completeRoute } from "@/lib/routes/complete-route"

type RouteParams = {
  params: Promise<{ routeId: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const { routeId } = await params
    if (!routeId) {
      return NextResponse.json(
        { success: false, error: "Route ID is required" },
        { status: 400 },
      )
    }

    // Водитель может завершить только свой рейс
    if (!(await canDriverAccessRoute(auth.value, routeId))) {
      return forbidden("Рейс назначен другому водителю")
    }

    const body = await request.json().catch(() => ({}))
    const { force = false } = body as { force?: boolean }

    const result = await completeRoute({
      routeId,
      organizationId: org.organizationId,
      force,
      actorName: auth.value.kind === "driver" ? auth.value.driver.name : auth.value.user.name,
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          ...(result.pendingOrders ? { pendingOrders: result.pendingOrders } : {}),
        },
        { status: result.status },
      )
    }

    // Пуш — после коммита: внутри транзакции SQLite заблокировал бы базу
    if (result.completionPush) {
      await deliverNotificationPush(result.completionPush)
    }

    // noop: рейс уже был завершён — повторный вызов ничего не изменил
    // (completedAt, топливо и итоги прежние). Флаг нужен интерфейсу,
    // чтобы не показывать ложное «Рейс завершён» второй раз.
    return NextResponse.json({
      success: true,
      message: result.noop ? "Рейс уже был завершён" : "Рейс завершён",
      route: result.route,
      stats: result.stats,
      noop: result.noop === true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[Route Complete] Error:", message)

    // доменная ошибка (недопустимый переход статуса) — это 409, а не 500
    if (/статус|Рейс в статусе|Нельзя перевести/i.test(message)) {
      return NextResponse.json({ success: false, error: message }, { status: 409 })
    }

    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
