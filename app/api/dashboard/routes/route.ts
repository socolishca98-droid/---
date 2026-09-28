// app/api/dashboard/routes/route.ts
//
// Рейсы для карты дашборда: нитки маршрутов, точки погрузки/выгрузки, база.
//
// Как устроено и почему так:
//  — координаты городов берём через lib/geo/geocode (постоянный кэш в таблице
//    GeoCache + пауза между запросами к Nominatim). Раньше эндпоинт ходил в
//    Nominatim сам на каждом опросе карты (раз в 15 секунд): сервис начинал
//    отвечать 403, точки пропадали и карта оставалась пустой;
//  — геометрию дороги берём через lib/geo/route-geometry (кэш в памяти +
//    склейка одновременных запросов), при недоступности OSRM — плавная кривая
//    с пометкой source: "line";
//  — адреса, которые определить не удалось, возвращаем списком problems:
//    карта честно говорит «город не найден», а не рисует точку в Москве;
//  — организация — из проверенной сессии, чужие рейсы не отдаются.

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { OCCUPYING_ORDER_STATUSES, isOrderMoving } from "@/lib/orders/stages"
import { geocodeAddresses, type Coordinates } from "@/lib/geo/geocode"
import { estimateDurationMin, getRouteGeometry } from "@/lib/geo/route-geometry"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Дефолтные координаты (Москва) — только как последний запасной вариант. */
const DEFAULT_BASE_COORDS: [number, number] = [55.7558, 37.6173]

/** Палитра ниток рейсов: цвета не повторяются, пока рейсов меньше восьми. */
const ROUTE_COLORS = [
  "#FF6B35",
  "#00D4FF",
  "#7B61FF",
  "#00FFA3",
  "#FFD93D",
  "#4ECDC4",
  "#F093FB",
  "#4FACFE",
]

type Waypoint = {
  type: "driver" | "loading" | "unloading" | "base"
  label: string
  address: string
  position: [number, number] | null
}

type BasePayload = {
  name: string
  address: string
  coordinates: [number, number]
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

function toCoordinates(point: [number, number]): Coordinates {
  return { lat: point[0], lng: point[1] }
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    // ========== БАЗА АВТОПАРКА ==========
    const settings = await prisma.fleetSettings.findFirst({
      where: scopedWhere(org.organizationId),
    })

    let base: BasePayload
    let warning: string | null = null

    if (
      settings?.baseLat != null &&
      settings?.baseLng != null &&
      Number.isFinite(settings.baseLat) &&
      Number.isFinite(settings.baseLng) &&
      Math.abs(settings.baseLat) <= 90 &&
      Math.abs(settings.baseLng) <= 180
    ) {
      base = {
        name: settings.parkName || "Автопарк",
        address: settings.baseAddress || "База",
        coordinates: [settings.baseLat, settings.baseLng],
      }
    } else if (settings?.baseAddress) {
      // Адрес базы геокодируется отдельно и первым: он нужен всегда,
      // а общий список адресов заказов может упереться в лимит запросов
      const baseCoords = await geocodeAddresses([settings.baseAddress])
      const resolved = baseCoords.get(settings.baseAddress) ?? null
      if (resolved) {
        base = {
          name: settings.parkName || "Автопарк",
          address: settings.baseAddress,
          coordinates: [resolved.lat, resolved.lng],
        }
        warning = "Координаты базы определены по адресу"
      } else {
        base = {
          name: settings.parkName || "Автопарк",
          address: settings.baseAddress,
          coordinates: DEFAULT_BASE_COORDS,
        }
        warning = `Не удалось определить координаты базы («${settings.baseAddress}»). Показана Москва.`
      }
    } else {
      base = {
        name: "Автопарк",
        address: "Настройте адрес в настройках",
        coordinates: DEFAULT_BASE_COORDS,
      }
      warning = "База не настроена. Откройте Настройки → раздел «Автопарк и база»."
    }

    // ========== ЗАКАЗЫ В РАБОТЕ ==========
    const activeOrders = await prisma.order.findMany({
      where: scopedWhere(org.organizationId, {
        status: { in: [...OCCUPYING_ORDER_STATUSES] },
        assignedDriverId: { not: null },
      }),
      orderBy: { createdAt: "asc" },
    })

    if (activeOrders.length === 0) {
      return NextResponse.json({ success: true, base, warning, routes: [], problems: [] })
    }

    // ========== ГРУППИРОВКА ПО РЕЙСАМ ==========
    type Group = { driverId: string; orders: typeof activeOrders }
    const groups = new Map<string, Group>()

    for (const order of activeOrders) {
      const key = order.routeId || `solo-${order.id}`
      const driverId = order.assignedDriverId as string

      const existing = groups.get(key)
      if (!existing) {
        groups.set(key, { driverId, orders: [order] })
      } else if (existing.driverId === driverId) {
        existing.orders.push(order)
      } else {
        // Один рейс не может принадлежать двум водителям — разделяем группы,
        // чтобы на карте не появилось «две машины на одной нитке»
        const altKey = `${key}-${driverId}`
        const alt = groups.get(altKey)
        if (!alt) groups.set(altKey, { driverId, orders: [order] })
        else alt.orders.push(order)
      }
    }

    const driverIds = [...new Set([...groups.values()].map((group) => group.driverId))]
    const drivers = await prisma.driver.findMany({
      where: scopedWhere(org.organizationId, {
        id: { in: driverIds },
        latitude: { not: null },
        longitude: { not: null },
      }),
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        vehiclePlate: true,
      },
    })

    // ========== КОДИНГОРДИНАТЫ АДРЕСОВ (один пакетный запрос) ==========
    const addresses = Array.from(
      new Set(
        activeOrders.flatMap((order) => [order.routeFrom, order.routeTo]).filter(Boolean),
      ),
    )
    const coordsByAddress = addresses.length > 0 ? await geocodeAddresses(addresses) : new Map()

    const problems = new Set<string>()
    const pointOf = (address: string | null): Coordinates | null => {
      if (!address) return null
      const point = coordsByAddress.get(address) ?? null
      if (!point) problems.add(address)
      return point
    }

    // ========== СБОРКА РЕЙСОВ ==========
    const basePoint = toCoordinates(base.coordinates)

    const built = await Promise.all(
      [...groups.entries()].map(async ([routeKey, group]) => {
        const driver = drivers.find((item) => item.id === group.driverId)
        if (!driver?.latitude || !driver?.longitude) return null

        const driverPoint: Coordinates = { lat: driver.latitude, lng: driver.longitude }
        const ordersSorted = [...group.orders].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        )

        const points: Coordinates[] = [driverPoint]
        const waypoints: Waypoint[] = [
          {
            type: "driver",
            label: "🚚",
            address: "Текущая позиция",
            position: [driverPoint.lat, driverPoint.lng],
          },
        ]

        let waypointIndex = 0
        for (const order of ordersSorted) {
          const from = pointOf(order.routeFrom)
          if (from) {
            points.push(from)
            waypoints.push({
              type: "loading",
              label: LETTERS[waypointIndex++] || "•",
              address: order.routeFrom,
              position: [from.lat, from.lng],
            })
          }

          const to = pointOf(order.routeTo)
          if (to) {
            points.push(to)
            waypoints.push({
              type: "unloading",
              label: LETTERS[waypointIndex++] || "•",
              address: order.routeTo,
              position: [to.lat, to.lng],
            })
          }
        }

        // База — последняя точка: рейс возвращается в автопарк
        points.push(basePoint)
        waypoints.push({
          type: "base",
          label: "🏠",
          address: base.address,
          position: base.coordinates,
        })

        if (points.length < 2) return null

        const geometry = await getRouteGeometry(points)
        const totalPrice = ordersSorted.reduce((sum, order) => sum + (order.price || 0), 0)
        // Пробег: из OSRM — настоящий, иначе — сумма плеч из заказов
        // (их вносили логисты, это точнее прямой между городами).
        const distanceKm =
          geometry.source === "osrm"
            ? geometry.distanceKm
            : ordersSorted.reduce((sum, order) => sum + (order.distance || 0), 0)
        // Время в пути: измерение OSRM или честная оценка (geometrySource: "line")
        const durationMin =
          geometry.source === "osrm" ? geometry.durationMin : estimateDurationMin(distanceKm)

        return {
          id: routeKey,
          driverId: group.driverId,
          driverName: driver.name,
          vehiclePlate: driver.vehiclePlate ?? undefined,
          driverPos: [driver.latitude, driver.longitude] as [number, number],
          routeFrom: ordersSorted[0].routeFrom,
          routeTo: ordersSorted[ordersSorted.length - 1].routeTo,
          status: ordersSorted.some((order) => isOrderMoving(order.status))
            ? "in_transit"
            : "confirmed",
          cargoType: ordersSorted[0].cargoType,
          totalPrice,
          totalDistance: distanceKm,
          duration: durationMin,
          coordinates: geometry.coordinates,
          geometrySource: geometry.source,
          waypoints,
          orders: ordersSorted.map((order) => ({
            id: order.id,
            from: order.routeFrom,
            to: order.routeTo,
            status: order.status,
            cargo: order.cargoType,
            price: order.price,
          })),
        }
      }),
    )

    const routes = built
      .filter((route): route is NonNullable<typeof route> => route !== null)
      .map((route, index) => ({
        ...route,
        color: ROUTE_COLORS[index % ROUTE_COLORS.length],
      }))

    return NextResponse.json({
      success: true,
      base,
      warning,
      routes,
      problems: [...problems],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка"
    console.warn("[Dashboard Routes API] запасной ответ из-за:", message)
    return NextResponse.json(
      {
        success: false,
        error: message,
        base: {
          name: "Автопарк",
          address: "Москва",
          coordinates: DEFAULT_BASE_COORDS,
        },
        routes: [],
        problems: [],
      },
      { status: 200 },
    )
  }
}
