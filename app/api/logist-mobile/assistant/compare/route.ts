// app/api/logist-mobile/assistant/compare/route.ts
//
// Сравнение «до/после» для предложения помощника: POST .../assistant/compare
//
// body: { orderIds: string[] }
//
// Зачем сервером: сравнение нужно геокодирование адресов (у заказов в базе
// только строки routeFrom/routeTo). В браузере его не сделать без внешнего
// геокодера, а координаты ещё и надо кэшировать — это делает lib/geo.
//
// ВАЖНО: эндпоинт НИЧЕГО НЕ ПИШЕТ в базу. Альтернатива помощника живёт только
// в этом расчёте: рейс создаётся отдельным запросом после подтверждения
// логистом. Проверено тестом: после сравнения количество рейсов не меняется.
//
// Безопасность: организация берётся из проверенной сессии, заказы ищутся
// сразу с ней. Чужие id не приходят в расчёт — они отфильтровываются, а не
// дают 500.

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { prisma } from "@/lib/prisma"
import { geocodeAddressesWithSource } from "@/lib/geo/geocode"
import { compareAssistantProposal } from "@/lib/logist-mobile/assistant-eta"
import type { AssistantOrder, AssistantVehicle } from "@/lib/logist-mobile/route-assistant"

export const dynamic = "force-dynamic"

/** Сколько заказов можно сравнивать за раз: защита от перегрузки расчёта. */
const MAX_COMPARE_ORDERS = 25

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  let body: { orderIds?: unknown; vehicleId?: unknown } | null = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Ожидается JSON" }, { status: 400 })
  }

  const vehicleId = typeof body?.vehicleId === "string" ? body.vehicleId : null

  // Машина — только из своей организации: чужой vehicleId не должен влиять
  // на прогноз (и не должен приводить к ошибке)
  const vehicle: AssistantVehicle | null = vehicleId
    ? ((await prisma.vehicle.findFirst({
        where: { id: vehicleId, organizationId: org.organizationId },
        select: { id: true, plate: true, type: true, capacity: true, volume: true, status: true },
      })) as AssistantVehicle | null)
    : null

  const orderIds = Array.isArray(body?.orderIds)
    ? body.orderIds.filter((id): id is string => typeof id === "string")
    : []
  if (orderIds.length === 0) {
    return NextResponse.json(
      { success: false, error: "Нужен хотя бы один заказ" },
      { status: 400 },
    )
  }
  if (orderIds.length > MAX_COMPARE_ORDERS) {
    return NextResponse.json(
      { success: false, error: `Слишком много заказов: не больше ${MAX_COMPARE_ORDERS}` },
      { status: 400 },
    )
  }

  try {
    // Заказы — только своей организации. Чужие id просто не найдутся.
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds }, organizationId: org.organizationId },
      select: {
        id: true,
        status: true,
        routeFrom: true,
        routeTo: true,
        distance: true,
        weight: true,
        volume: true,
        price: true,
        agreedPrice: true,
        deadline: true,
        clientName: true,
        routeId: true,
      },
      // Порядок заказов важен: сравнивать надо тот же рейс, что предложен
      orderBy: [{ routeSequence: "asc" }, { createdAt: "asc" }],
    })

    if (orders.length === 0) {
      return NextResponse.json({ success: false, error: "Заказы не найдены" }, { status: 404 })
    }

    const assistantOrders: AssistantOrder[] = orders.map((order) => ({
      id: order.id,
      status: order.status,
      routeFrom: order.routeFrom,
      routeTo: order.routeTo,
      distance: order.distance,
      weight: order.weight,
      volume: order.volume,
      price: order.price,
      agreedPrice: order.agreedPrice,
      deadline: order.deadline ? order.deadline.toISOString() : null,
      clientName: order.clientName,
      routeId: order.routeId,
    }))

    // Геокодируем все точки предложения одним батчем (кэш GeoCache + Nominatim)
    const { coords } = await geocodeAddressesWithSource(
      orders.flatMap((order) => [order.routeFrom, order.routeTo]),
    )

    // База организации — из настроек парка. Если не задана, возврат на базу
    // не считается, и сравнение честно об этом скажет.
    const settings = await prisma.fleetSettings.findFirst({
      where: { organizationId: org.organizationId },
      select: { baseLat: true, baseLng: true, baseAddress: true },
    })

    // Машину помощник подбирает сам (или логист меняет в интерфейсе) —
    // передаём её, иначе прогноз считается на нейтральном профиле ТС.
    const comparison = compareAssistantProposal(assistantOrders, vehicle ?? null, {
      base:
        settings?.baseLat != null && settings?.baseLng != null
          ? { lat: settings.baseLat, lng: settings.baseLng }
          : null,
      baseAddress: settings?.baseAddress ?? undefined,
      coords,
    })

    if (!comparison) {
      return NextResponse.json({ success: false, error: "Нечего сравнивать" }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      // Расчёт только на экране: записей в базе не сделано
      persisted: false,
      before: comparison.before,
      beforeNote: comparison.beforeNote,
      after: comparison.after,
      deltas: comparison.deltas,
      deadlineViolations: comparison.deadlineViolations,
      explanations: comparison.explanations,
      geocodedPoints: Array.from(coords.values()).filter(Boolean).length,
      baseKnown: settings?.baseLat != null && settings?.baseLng != null,
      stages: comparison.afterTrip.stages.map((stage) => ({
        index: stage.index,
        kind: stage.kind,
        label: stage.label,
        address: stage.address,
        distanceM: stage.distanceM ?? null,
        plannedStartAt: stage.plannedStartAt?.toISOString() ?? null,
        plannedEndAt: stage.plannedEndAt?.toISOString() ?? null,
      })),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[Assistant compare] error:", message, error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
