// app/api/ati/sandbox/route.ts
//
// «Песочница» — рабочий стол логиста: заказы его организации, которые ещё не
// ушли в рейс.
//
// Было: GET отдавал строки ОБЩЕЙ таблицы AtiCache со status="imported", а DELETE
// сбрасывал у общей строки статус обратно на "new". Из-за этого груз, взятый
// одной организацией, исчезал из базы у всех остальных, а «мои заказы» на самом
// деле не были заказами — это были строки чужой общей таблицы без статуса и истории.
//
// Стало: песочница работает с настоящими заказами организации (Order), а общая
// база ATI остаётся нетронутой. Заказ попадает сюда через
// POST /api/orders/from-cache («Взять в работу») и уходит из песочницы, когда
// его включили в рейс (routeId != null) или закрыли.
//
// Форма ответа сохранена прежней (from/to/cargo/company/phone/…), чтобы экран
// песочницы не сломался, и дополнена полями процесса (status/stage/agreedPrice).

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/rate-limiter"
import {
  isOrderClosed,
  normalizeOrderStatus,
  orderStageOf,
  orderStatusLabel,
} from "@/lib/orders/stages"

export const dynamic = "force-dynamic"

// GET — заказы организации, которые ещё не в рейсе и не закрыты
export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const orders = await prisma.order.findMany({
      where: scopedWhere(org.organizationId, {
        routeId: null,
        // закрытые не показываем; значение status может быть и легас-
        // («new», «confirmed»), поэтому фильтруем списком закрытых, а не открытых
        status: { notIn: ["delivered", "completed", "cancelled", "rejected", "expired"] },
      }),
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    })

    const loads = orders.map((order: any) => {
      const status = normalizeOrderStatus(order.status) ?? "search"
      return {
        // ── прежняя форма ответа (экран песочницы читает эти ключи) ──
        id: order.id,
        atiLoadId: order.sourceId,
        from: order.routeFrom,
        to: order.routeTo,
        price: order.agreedPrice ?? order.price ?? 0,
        weight: order.weight ?? 0,
        distance: order.distance ?? 0,
        volume: order.volume ?? null,
        cargo: order.cargoType || "Груз",
        company: order.clientName || "Частник",
        phone: order.clientContact,
        contactName: order.clientName,
        firmId: order.clientFirmId,
        loadingDate: order.deadline ? new Date(order.deadline).toISOString() : null,
        // ── ключи, которые песочница передаёт обратно при оформлении рейса ──
        orderId: order.id,
        atiCacheId: order.atiCacheId,
        routeFrom: order.routeFrom,
        routeTo: order.routeTo,
        clientCompany: order.clientName,
        clientPhone: order.clientContact,
        requirements: order.requirements,
        priceNegotiable: order.priceNegotiable,
        // ── процесс заказа ──
        status,
        stage: orderStageOf(status),
        statusLabel: orderStatusLabel(status),
        negotiationStatus: order.negotiationStatus,
        agreedPrice: order.agreedPrice,
        nextFollowUpAt: order.nextFollowUpAt
          ? new Date(order.nextFollowUpAt).toISOString()
          : null,
        source: order.source,
        createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : null,
      }
    })

    return NextResponse.json(loads)
  } catch (error) {
    console.error("[ATI Sandbox GET] Error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to load orders" },
      { status: 500 },
    )
  }
}

// DELETE — вернуть груз в базу: заказ, взятый из ATI, удаляется, а строка общей
// базы остаётся нетронутой (её может взять другая организация).
export async function DELETE(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const body = await request.json().catch(() => ({}))
    const id = String(body.id ?? "").trim()

    if (!id) {
      return NextResponse.json({ success: false, error: "id required" }, { status: 400 })
    }

    const order = await prisma.order.findFirst({
      where: scopedWhere(org.organizationId, { id }),
      select: {
        id: true,
        status: true,
        routeId: true,
        atiCacheId: true,
        routeFrom: true,
        routeTo: true,
      },
    })

    if (!order) {
      return NextResponse.json(
        { success: false, error: "Заказ не найден" },
        { status: 404 },
      )
    }

    if (order.routeId) {
      return NextResponse.json(
        { success: false, error: "Заказ уже в рейсе — сначала уберите его из рейса" },
        { status: 409 },
      )
    }

    if (isOrderClosed(order.status)) {
      return NextResponse.json(
        { success: false, error: "Заказ закрыт — вернуть его в базу нельзя" },
        { status: 409 },
      )
    }

    if (!order.atiCacheId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Заказ создан вручную, а не взят из базы ATI. Удалить его можно в карточке заказа.",
          code: "not_from_cache",
        },
        { status: 400 },
      )
    }

    // Удаляем с явным фильтром организации: даже если выше что-то пойдёт не так,
    // чужой заказ удалён не будет.
    const deleted = await prisma.order.deleteMany({
      where: scopedWhere(org.organizationId, { id: order.id }),
    })
    if (deleted.count === 0) {
      return NextResponse.json(
        { success: false, error: "Заказ не найден" },
        { status: 404 },
      )
    }

    await logAudit({
      organizationId: org.organizationId,
      actorId: org.userId,
      actorEmail: auth.value.user.email ?? null,
      action: "order_return_to_base",
      targetId: order.id,
      targetType: "order",
      metadata: {
        atiCacheId: order.atiCacheId,
        routeFrom: order.routeFrom,
        routeTo: order.routeTo,
      },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true, id: order.id })
  } catch (error) {
    console.error("[ATI Sandbox DELETE] Error:", error)
    return NextResponse.json(
      { success: false, error: "Не удалось вернуть груз в базу" },
      { status: 500 },
    )
  }
}
