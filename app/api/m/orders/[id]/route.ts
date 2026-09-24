// app/api/m/orders/[id]/route.ts
//
// PATCH /api/m/orders/[id] — водитель меняет статус СВОЕГО заказа.
//
// Мобильный экран водителя отправлял смену статуса в штабной
// PATCH /api/orders/[id] (requireStaffAuth) — водительская сессия его не
// проходит, поэтому «Начать рейс», «Погрузка», «Выгрузка» не работали.
//
// Здесь водитель может только перевести свой заказ в этап «Контроль»
// (начало исполнения). Всё остальное — назначение, документы, закрытие —
// остаётся за логистом: водитель не распоряжается чужими заказами и не
// закрывает рейс (завершение рейса — POST /api/routes/[routeId]/complete,
// он доступен водителю по своей сессии).

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import {
  canChangeOrderStatus,
  isOrderClosed,
  normalizeOrderStatus,
  orderStatusLabel,
} from "@/lib/orders/stages"
import { logRouteEvent } from "@/lib/routes/service"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ id: string }> }

/** Что водителю разрешено: только «взял в исполнение». */
const DRIVER_ALLOWED_STATUSES = ["control"] as const

type PatchBody = { status?: unknown }

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const driverId = auth.value.driver.id

  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ success: false, error: "Не указан заказ" }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as PatchBody
    const requested = normalizeOrderStatus(body.status)

    if (!requested) {
      return NextResponse.json(
        { success: false, error: "Неизвестный статус заказа" },
        { status: 400 },
      )
    }

    if (!(DRIVER_ALLOWED_STATUSES as readonly string[]).includes(requested)) {
      return NextResponse.json(
        {
          success: false,
          error: `Водитель может перевести заказ только в статус «${orderStatusLabel("control")}»`,
          allowed: [...DRIVER_ALLOWED_STATUSES],
        },
        { status: 403 },
      )
    }

    // Заказ должен быть назначен именно этому водителю: чужой id даёт 404
    const order = await prisma.order.findFirst({
      where: scopedWhere(org.organizationId, { id, assignedDriverId: driverId }),
      select: { id: true, status: true, routeId: true, routeFrom: true, routeTo: true },
    })
    if (!order) {
      return NextResponse.json({ success: false, error: "Заказ не найден" }, { status: 404 })
    }

    if (isOrderClosed(order.status)) {
      return NextResponse.json(
        { success: false, error: "Заказ уже закрыт" },
        { status: 400 },
      )
    }

    const current = normalizeOrderStatus(order.status)

    // Повторная отправка того же этапа — не ошибка: экран водителя опрашивает
    // состояние каждые 30 секунд и может отправить то же значение дважды.
    if (current === requested) {
      return NextResponse.json({
        success: true,
        status: requested,
        statusLabel: orderStatusLabel(requested),
        changed: false,
      })
    }

    if (!canChangeOrderStatus(order.status, requested)) {
      return NextResponse.json(
        {
          success: false,
          error: `Из статуса «${orderStatusLabel(order.status)}» нельзя перейти в «${orderStatusLabel(requested)}»`,
          code: "invalid_status_transition",
          allowed: DRIVER_ALLOWED_STATUSES,
        },
        { status: 400 },
      )
    }

    await prisma.order.updateMany({
      where: scopedWhere(org.organizationId, { id, assignedDriverId: driverId }),
      data: { status: requested },
    })

    // Лента заказа: действие водителя должно быть видно логисту
    await prisma.orderNegotiation.create({
      data: {
        organizationId: org.organizationId,
        orderId: id,
        kind: "status_change",
        text: `Статус: ${orderStatusLabel(order.status)} → ${orderStatusLabel(requested)} (водитель начал исполнение)`,
        priceOffer: null,
        authorId: null,
        authorName: auth.value.driver.name ?? "Водитель",
      },
    })

    // Таймлайн рейса: событие «начал рейс» по точке
    if (order.routeId) {
      await logRouteEvent(prisma, {
        organizationId: org.organizationId,
        routeId: order.routeId,
        driverId,
        vehicleId: auth.value.driver.vehicleId ?? null,
        orderId: id,
        type: "status",
        status: requested,
        data: JSON.stringify({
          source: "driver",
          from: order.status,
          to: requested,
          order: `${order.routeFrom} → ${order.routeTo}`,
        }),
      })
    }

    return NextResponse.json({
      success: true,
      status: requested,
      statusLabel: orderStatusLabel(requested),
      changed: true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось обновить заказ"
    console.error("[Mobile Order] PATCH error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
