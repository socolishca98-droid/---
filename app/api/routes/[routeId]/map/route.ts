// app/api/routes/[routeId]/map/route.ts
//
// Линия рейса на карте: один маршрут — цветные сегменты по заказам.
//
// Зачем отдельный эндпоинт: геометрия дороги спрашивается у OSRM
// (router.project-osrm.org), а координаты городов — у Nominatim, и всё это
// кэшируется. Держать такие запросы в браузере нельзя: они медленные и
// лимитированные, поэтому карта запрашивает готовые сегменты отсюда и только
// когда её действительно открыли.
//
// Что возвращается:
//   segments[] — по одному на заказ: откуда/куда, сколько км, статус,
//                colorIndex (цвет сегмента выбирает интерфейс), geometry
//                (массив [lat, lng]) и source: "osrm" (дорога) или "line"
//                (прямая — если OSRM недоступен);
//   bounds     — рамка для карты;
//   problems[] — города, координаты которых определить не удалось (карта
//                честно покажет это списком, а не выдуманной точкой).
//
// Организация — из проверенной сессии: чужой рейс даёт 404.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { geocodeAddresses, type Coordinates } from "@/lib/geo/geocode"
import { decodePolyline, fetchOSRMRoute } from "@/lib/eta/osrm-client"
import { normalizeOrderStatus, orderStatusLabel } from "@/lib/orders/stages"

export const dynamic = "force-dynamic"
export const maxDuration = 60

type RouteParams = { params: Promise<{ routeId: string }> }

type Segment = {
  orderId: string
  sequence: number
  from: string
  to: string
  status: string
  statusLabel: string
  colorIndex: number
  isAdditionalLoad: boolean
  distanceKm: number | null
  durationMin: number | null
  geometry: [number, number][]
  source: "osrm" | "line" | "none"
}

const toLatLng = (point: Coordinates): [number, number] => [point.lat, point.lng]

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const { routeId } = await params
  if (!routeId) {
    return NextResponse.json({ success: false, error: "Не указан рейс" }, { status: 400 })
  }

  try {
    const route = await prisma.route.findFirst({
      where: scopedWhere(org.organizationId, { id: routeId }),
      select: { id: true, name: true, status: true },
    })
    if (!route) {
      return NextResponse.json({ success: false, error: "Рейс не найден" }, { status: 404 })
    }

    // Точки рейса — заказы, привязанные к нему, в порядке объезда
    const orders = (await prisma.order.findMany({
      where: scopedWhere(org.organizationId, { routeId: route.id }),
      orderBy: [{ routeSequence: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        routeSequence: true,
        routeFrom: true,
        routeTo: true,
        status: true,
        distance: true,
        isAdditionalLoad: true,
      },
    })) as {
      id: string
      routeSequence: number | null
      routeFrom: string
      routeTo: string
      status: string
      distance: number | null
      isAdditionalLoad: boolean
    }[]

    if (orders.length === 0) {
      return NextResponse.json({
        success: true,
        route: { id: route.id, name: route.name, status: route.status },
        segments: [],
        bounds: null,
        problems: [],
        message: "В рейсе нет точек",
      })
    }

    // Координаты городов: сначала постоянный кэш, потом Nominatim
    const coords = await geocodeAddresses(
      orders.flatMap((order) => [order.routeFrom, order.routeTo]),
    )

    const problems: string[] = []
    const segments: Segment[] = []
    const allPoints: [number, number][] = []

    for (let index = 0; index < orders.length; index += 1) {
      const order = orders[index]
      const from = coords.get(order.routeFrom) ?? null
      const to = coords.get(order.routeTo) ?? null
      const status = normalizeOrderStatus(order.status) ?? "search"

      if (!from) problems.push(order.routeFrom)
      if (!to) problems.push(order.routeTo)

      let geometry: [number, number][] = []
      let source: Segment["source"] = "none"
      let distanceKm: number | null = order.distance ?? null
      let durationMin: number | null = null

      if (from && to) {
        try {
          // Живая дорога: OSRM возвращает полилинию, которую нужно раскодировать
          const osrm = await fetchOSRMRoute(from, to, [], { overview: "full" })
          const osrmRoute = osrm.routes[0]
          const points = decodePolyline(osrmRoute.geometry).map(toLatLng)

          if (points.length >= 2) {
            geometry = points
            source = "osrm"
            distanceKm = Math.round((osrmRoute.distance / 1000) * 10) / 10
            durationMin = Math.round(osrmRoute.duration / 60)
          } else {
            geometry = [toLatLng(from), toLatLng(to)]
            source = "line"
          }
        } catch (error) {
          // OSRM недоступен — рисуем прямую, но честно помечаем источник
          console.error("[routes/map] OSRM недоступен:", error)
          geometry = [toLatLng(from), toLatLng(to)]
          source = "line"
        }
      }

      allPoints.push(...geometry)

      segments.push({
        orderId: order.id,
        sequence: order.routeSequence ?? index + 1,
        from: order.routeFrom,
        to: order.routeTo,
        status,
        statusLabel: orderStatusLabel(order.status),
        // цвет выбирает интерфейс: сервер отдаёт только номер в палитре
        colorIndex: index,
        isAdditionalLoad: Boolean(order.isAdditionalLoad),
        distanceKm,
        durationMin,
        geometry,
        source,
      })
    }

    const bounds =
      allPoints.length > 0
        ? ([
            [Math.min(...allPoints.map((p) => p[0])), Math.min(...allPoints.map((p) => p[1]))],
            [Math.max(...allPoints.map((p) => p[0])), Math.max(...allPoints.map((p) => p[1]))],
          ] as [[number, number], [number, number]])
        : null

    return NextResponse.json({
      success: true,
      route: { id: route.id, name: route.name, status: route.status },
      segments,
      bounds,
      problems: Array.from(new Set(problems)),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "route map error"
    console.error("[routes/map] GET error:", message)
    return NextResponse.json(
      { success: false, error: "Не удалось построить маршрут на карте" },
      { status: 500 },
    )
  }
}
