// app/api/lm/map/route.ts
//
// Данные для мобильной карты логиста — облегчённая версия /api/dashboard/routes.
//
// Зачем отдельный эндпоинт: десктопный отдаёт полную геометрию (у одного рейса
// бывало 18 500 точек, ответ весил ~1 МБ). На телефоне это и долго, и дорого по
// трафику. Здесь делаем то же самое, но:
//   — нитки рейсов прореживаются до MAX_POINTS_ON_MAP точек;
//   — координаты округляются до 4 знаков (~11 метров) — для карты этого хватает;
//   — ответ кэшируется на несколько секунд, чтобы частые обновления не гоняли
//     геокодер и OSRM заново.
//
// Состав ответа: база, машины с координатами, нитки активных рейсов.

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { prisma } from "@/lib/prisma"
import { OCCUPYING_ORDER_STATUSES } from "@/lib/orders/stages"
import { geocodeAddresses, type Coordinates } from "@/lib/geo/geocode"
import { getRouteGeometry } from "@/lib/geo/route-geometry"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const DEFAULT_BASE_COORDS: [number, number] = [55.7558, 37.6173]
const MAX_POINTS_PER_ROUTE = 200
const CACHE_TTL_MS = 15_000

type Cached = { at: number; payload: unknown }
const cache = new Map<string, Cached>()

/** Округление координаты до ~11 метров и прореживание длинной нитки. */
function compactLine(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length === 0) return []
  const step = Math.max(1, Math.ceil(points.length / MAX_POINTS_PER_ROUTE))
  const out: Array<[number, number]> = []
  for (let index = 0; index < points.length; index += step) {
    const [lat, lng] = points[index]
    out.push([Number(lat.toFixed(4)), Number(lng.toFixed(4))])
  }
  const last = points[points.length - 1]
  const lastCompact: [number, number] = [Number(last[0].toFixed(4)), Number(last[1].toFixed(4))]
  const tail = out[out.length - 1]
  if (!tail || tail[0] !== lastCompact[0] || tail[1] !== lastCompact[1]) out.push(lastCompact)
  return out
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  const cached = cache.get(org.organizationId)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload, { headers: { "x-lm-map": "cached" } })
  }

  try {
    // ========== БАЗА ==========
    const settings = await prisma.fleetSettings.findFirst({
      where: scopedWhere(org.organizationId),
    })

    let base = {
      name: settings?.parkName || "Автопарк",
      address: settings?.baseAddress || "Адрес базы не настроен",
      coordinates: DEFAULT_BASE_COORDS,
    }

    const hasBaseCoords =
      settings?.baseLat != null &&
      settings?.baseLng != null &&
      Number.isFinite(settings.baseLat) &&
      Number.isFinite(settings.baseLng)

    if (hasBaseCoords) {
      base.coordinates = [settings!.baseLat as number, settings!.baseLng as number]
    } else if (settings?.baseAddress) {
      const resolved = (await geocodeAddresses([settings.baseAddress])).get(settings.baseAddress)
      if (resolved) base.coordinates = [resolved.lat, resolved.lng]
    }

    // ========== МАШИНЫ (все, у кого есть координаты) ==========
    const driverRows = await prisma.driver.findMany({
      where: scopedWhere(org.organizationId, {
        latitude: { not: null },
        longitude: { not: null },
      }),
      select: {
        id: true,
        name: true,
        phone: true,
        status: true,
        latitude: true,
        longitude: true,
        vehiclePlate: true,
        vehicleType: true,
        currentLocation: true,
        lastGpsUpdate: true,
      },
      orderBy: { name: "asc" },
    })

    // ========== АКТИВНЫЕ ЗАКАЗЫ: что везут прямо сейчас ==========
    const activeOrders = await prisma.order.findMany({
      where: scopedWhere(org.organizationId, {
        status: { in: [...OCCUPYING_ORDER_STATUSES] },
        assignedDriverId: { not: null },
      }),
      select: {
        id: true,
        assignedDriverId: true,
        routeId: true,
        routeFrom: true,
        routeTo: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    })

    // У какой машины какой маршрут — показываем в карточке водителя
    const ordersByDriver = new Map<string, typeof activeOrders>()
    for (const order of activeOrders) {
      const driverId = order.assignedDriverId as string
      const list = ordersByDriver.get(driverId) ?? []
      list.push(order)
      ordersByDriver.set(driverId, list)
    }

    const drivers = driverRows.map((driver) => {
      const orders = ordersByDriver.get(driver.id) ?? []
      return {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        status: driver.status,
        latitude: driver.latitude as number,
        longitude: driver.longitude as number,
        vehiclePlate: driver.vehiclePlate,
        vehicleType: driver.vehicleType,
        currentLocation: driver.currentLocation,
        routeFrom: orders[0]?.routeFrom ?? null,
        routeTo: orders[orders.length - 1]?.routeTo ?? null,
      }
    })

    // ========== НИТКИ РЕЙСОВ ==========
    const addresses = Array.from(
      new Set(activeOrders.flatMap((order) => [order.routeFrom, order.routeTo]).filter(Boolean)),
    )
    const coordsByAddress = addresses.length > 0 ? await geocodeAddresses(addresses) : new Map<string, Coordinates>()

    const groups = new Map<string, { driverId: string; orders: typeof activeOrders }>()
    for (const order of activeOrders) {
      const key = order.routeId || `solo-${order.id}`
      const driverId = order.assignedDriverId as string
      const existing = groups.get(key)
      if (!existing) groups.set(key, { driverId, orders: [order] })
      else if (existing.driverId === driverId) existing.orders.push(order)
      else groups.set(`${key}-${driverId}`, { driverId, orders: [order] })
    }

    const basePoint: Coordinates = { lat: base.coordinates[0], lng: base.coordinates[1] }

    const routes = (
      await Promise.all(
        [...groups.entries()].map(async ([routeKey, group]) => {
          const driver = drivers.find((item) => item.id === group.driverId)
          if (!driver) return null

          const points: Coordinates[] = [{ lat: driver.latitude, lng: driver.longitude }]
          for (const order of group.orders) {
            const from = coordsByAddress.get(order.routeFrom)
            if (from) points.push(from)
            const to = coordsByAddress.get(order.routeTo)
            if (to) points.push(to)
          }
          points.push(basePoint)
          if (points.length < 2) return null

          const geometry = await getRouteGeometry(points)

          return {
            id: routeKey,
            driverId: driver.id,
            driverName: driver.name,
            vehiclePlate: driver.vehiclePlate,
            routeFrom: group.orders[0].routeFrom,
            routeTo: group.orders[group.orders.length - 1].routeTo,
            status: driver.status,
            points: compactLine(geometry.coordinates as Array<[number, number]>),
          }
        }),
      )
    ).filter((route): route is NonNullable<typeof route> => route !== null)

    const payload = {
      success: true,
      base,
      drivers,
      routes,
      generatedAt: new Date().toISOString(),
    }

    cache.set(org.organizationId, { at: Date.now(), payload })
    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка"
    console.warn("[LM Map API] ошибка:", message)
    return NextResponse.json(
      { success: false, error: message, base: { name: "Автопарк", address: "", coordinates: DEFAULT_BASE_COORDS }, drivers: [], routes: [] },
      { status: 200 },
    )
  }
}
