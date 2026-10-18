// app/api/routes/[routeId]/rebuild/route.ts
//
// Пересборка рейса без заказов, по которым соглашение не достигнуто.
//
// Зачем: логист собирает рейс из нескольких заказов, развозит предложения —
// и по части грузов клиенты не соглашаются. Возвращаться и вручную выкидывать
// заказы из рейса — это потерянное время и риск забыть: рейс поедет с грузом,
// которого нет. Здесь это одна кнопка: «Пересобрать без несогласованных».
//
// Что делает:
//   1. находит заказы рейса, по которым согласие не достигнуто
//      (состояние переговоров «проиграно» или статус «отклонён»);
//   2. снимает с них привязку к рейсу — они возвращаются в общий пул и
//      снова доступны помощнику;
//   3. перенумеровывает оставшиеся заказы, чтобы не было дыр в порядке точек;
//   4. отдаёт, что именно убрано, — чтобы логист видел причину.
//
// Пересчитываем только состав и порядок: имя, машина и водитель остаются
// прежними, их меняют в карточке рейса.

import { NextRequest, NextResponse } from "next/server"

import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { prisma } from "@/lib/prisma"
import { isOrderClosed } from "@/lib/orders/stages"

type RouteParams = { params: Promise<{ routeId: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaff(request)
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

    const route = await prisma.route.findFirst({
      where: scopedWhere(org.organizationId, { id: routeId }),
      select: {
        id: true,
        name: true,
        status: true,
        orders: {
          where: scopedWhere(org.organizationId, {}),
          select: {
            id: true,
            clientName: true,
            routeFrom: true,
            routeTo: true,
            routeSequence: true,
            status: true,
            negotiationStatus: true,
          },
          orderBy: { routeSequence: "asc" },
        },
      },
    })

    if (!route) {
      return NextResponse.json(
        { success: false, error: "Маршрут не найден" },
        { status: 404 },
      )
    }

    // Заказ считается несогласованным, если переговоры проиграны или заказ
    // отклонён. Незакрытые заказы в рейсе трогать нельзя: они уже в работе.
    const notAgreed = route.orders.filter(
      (order) =>
        order.negotiationStatus === "lost" ||
        order.status === "rejected" ||
        order.status === "cancelled",
    )

    if (notAgreed.length === 0) {
      return NextResponse.json({
        success: true,
        removed: [],
        keptCount: route.orders.length,
        message: "Несогласованных заказов в рейсе нет — пересобирать нечего",
      })
    }

    const removeIds = notAgreed.map((order) => order.id)

    await prisma.$transaction(async (tx) => {
      // org-audit: ok — рейс уже проверен на принадлежность организации выше
      // Снимаем привязку к рейсу: заказ снова доступен помощнику
      await tx.order.updateMany({
        where: scopedWhere(org.organizationId, { routeId, id: { in: removeIds } }),
        data: { routeId: null, routeSequence: null },
      })

      // Перенумеровываем оставшиеся, чтобы порядок точек был без дыр
      const kept = route.orders
        .filter((order) => !removeIds.includes(order.id))
        .sort((a, b) => (a.routeSequence ?? 0) - (b.routeSequence ?? 0))

      for (let index = 0; index < kept.length; index += 1) {
        await tx.order.updateMany({
          where: scopedWhere(org.organizationId, { id: kept[index].id }),
          data: { routeSequence: index + 1 },
        })
      }
    })

    return NextResponse.json({
      success: true,
      removed: notAgreed.map((order) => ({
        id: order.id,
        clientName: order.clientName,
        routeFrom: order.routeFrom,
        routeTo: order.routeTo,
        status: order.status,
        negotiationStatus: order.negotiationStatus,
      })),
      keptCount: route.orders.length - removeIds.length,
      message: `Убрано заказов: ${removeIds.length}. Осталось в рейсе: ${route.orders.length - removeIds.length}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка"
    console.error("[RouteRebuild] ошибка:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}
