// app/api/dashboard/routes/route.ts

import { requireStaffAuth } from "@/lib/api-auth"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const OSRM_URL = "https://router.project-osrm.org/route/v1/driving"

// Дефолтные координаты (Москва) как fallback
const DEFAULT_BASE_COORDS: [number, number] = [55.7558, 37.6173]

// Премиальная палитра цветов для маршрутов
const ROUTE_COLORS = [
  "#00D4FF", "#7B61FF", "#00FFA3", "#FF6B6B", 
  "#FFD93D", "#4ECDC4", "#F093FB", "#4FACFE",
]

type Point = { lat: number; lng: number }

interface Waypoint {
  type: "driver" | "loading" | "unloading" | "base"
  label: string
  address: string
  position: [number, number] | null
}

async function geocodeAddress(address: string): Promise<Point | null> {
  if (!address || address.trim().length < 3) return null

  try {
    const query = address.toLowerCase().includes("росси")
      ? address
      : `${address}, Россия`

    const url = new URL("https://nominatim.openstreetmap.org/search")
    url.searchParams.set("q", query)
    url.searchParams.set("format", "json")
    url.searchParams.set("limit", "1")
    url.searchParams.set("addressdetails", "1")
    url.searchParams.set("countrycodes", "ru")

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "TMS-AI-Logistics/1.0",
        "Accept-Language": "ru",
      },
      signal: AbortSignal.timeout(3500),
      next: { revalidate: 86400 },
    })

    if (!res.ok) return null

    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null

    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)

    // Валидация
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90) return null

    return { lat, lng }
  } catch (error) {
    console.error("[Geocoding] Error:", error)
    return null
  }
}

async function getOSRMRoute(points: Point[]): Promise<{
  coordinates: [number, number][]
  distance: number
  duration: number
} | null> {
  if (points.length < 2) return null

  try {
    const coords = points.map((p: any) => `${p.lng},${p.lat}`).join(";")
    const url = `${OSRM_URL}/${coords}?overview=full&geometries=geojson&steps=false`

    const res = await fetch(url, { 
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null

    const data = await res.json()
    if (data.code !== "Ok" || !data.routes?.[0]) return null

    const route = data.routes[0]
    const coordinates: [number, number][] = route.geometry.coordinates.map(
      (c: [number, number]) => [c[1], c[0]] // GeoJSON [lng,lat] -> [lat,lng]
    )

    return {
      coordinates,
      distance: Math.round(route.distance / 1000),
      duration: Math.round(route.duration / 60),
    }
  } catch (error) {
    console.error("[OSRM] Error:", error)
    return null
  }
}

// Плавная интерполяция для fallback маршрута
function generateSmoothCurve(points: Point[]): [number, number][] {
  if (points.length < 2) return []

  const result: [number, number][] = []
  
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    const dx = to.lng - from.lng
    const dy = to.lat - from.lat
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001
    
    // Контрольная точка для кривой Безье
    const offset = dist * 0.15
    const midLat = (from.lat + to.lat) / 2 + (dx / dist) * offset
    const midLng = (from.lng + to.lng) / 2 - (dy / dist) * offset
    
    const segments = 30
    for (let j = 0; j <= segments; j++) {
      const t = j / segments
      const mt = 1 - t
      // Квадратичная кривая Безье
      const lat = mt * mt * from.lat + 2 * mt * t * midLat + t * t * to.lat
      const lng = mt * mt * from.lng + 2 * mt * t * midLng + t * t * to.lng
      result.push([lat, lng])
    }
  }
  
  return result
}

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;


  try {
    // ========== ЛОГИКА БАЗЫ ==========
    const settings = await prisma.fleetSettings.findFirst({
      where: { id: "default" },
    })

    let base: {
      name: string
      address: string
      coordinates: [number, number]
    }
    let warning: string | null = null

    // Приоритет 1: Координаты из настроек
    if (
      settings?.baseLat != null &&
      settings?.baseLng != null &&
      !isNaN(settings.baseLat) &&
      !isNaN(settings.baseLng) &&
      Math.abs(settings.baseLat) <= 90 &&
      Math.abs(settings.baseLng) <= 180
    ) {
      base = {
        name: settings.parkName || "Автопарк",
        address: settings.baseAddress || "База",
        coordinates: [settings.baseLat, settings.baseLng],
      }
    }
    // Приоритет 2: Геокодирование адреса
    else if (settings?.baseAddress) {
      const geocoded = await geocodeAddress(settings.baseAddress)
      if (geocoded) {
        base = {
          name: settings.parkName || "Автопарк",
          address: settings.baseAddress,
          coordinates: [geocoded.lat, geocoded.lng],
        }
        warning = "Координаты базы определены по адресу"
      } else {
        base = {
          name: settings?.parkName || "Автопарк",
          address: "Координаты не определены",
          coordinates: DEFAULT_BASE_COORDS,
        }
        warning = "Не удалось определить координаты базы. Используется Москва."
      }
    }
    // Приоритет 3: Дефолт
    else {
      base = {
        name: "Автопарк",
        address: "Настройте адрес в настройках",
        coordinates: DEFAULT_BASE_COORDS,
      }
      warning = "База не настроена. Перейдите в Настройки → Автопарк."
    }

    // ========== ПОЛУЧЕНИЕ ЗАКАЗОВ ==========
    const activeOrders = await prisma.order.findMany({
      where: {
        status: { in: ["confirmed", "in_transit", "loading", "unloading"] },
        assignedDriverId: { not: null },
      },
      orderBy: { createdAt: "asc" },
    })

    if (activeOrders.length === 0) {
      return NextResponse.json({ success: true, base, warning, routes: [] })
    }

    // ========== ГРУППИРОВКА ПО ВОДИТЕЛЯМ ==========
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
        const altKey = `${key}-${driverId}`
        const alt = groups.get(altKey)
        if (!alt) {
          groups.set(altKey, { driverId, orders: [order] })
        } else {
          alt.orders.push(order)
        }
      }
    }

    // Получаем водителей
    const driverIds = [...new Set([...groups.values()].map((g: any) => g.driverId))]
    const drivers = await prisma.driver.findMany({
      where: {
        id: { in: driverIds },
        latitude: { not: null },
        longitude: { not: null },
      },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        vehiclePlate: true,
      },
    })

    // Кэш геокодирования
    const geoCache = new Map<string, Point>()
    const geocodeWithCache = async (address: string): Promise<Point | null> => {
      const key = address.trim().toLowerCase()
      if (geoCache.has(key)) return geoCache.get(key)!
      const coords = await geocodeAddress(address)
      if (coords) geoCache.set(key, coords)
      return coords
    }

    // ========== ПОСТРОЕНИЕ МАРШРУТОВ ==========
    const routes: any[] = []
    let colorIndex = 0

    for (const [routeKey, group] of groups.entries()) {
      const driver = drivers.find((d: any) => d.id === group.driverId)
      if (!driver?.latitude || !driver?.longitude) continue

      const driverPos: Point = { lat: driver.latitude, lng: driver.longitude }
      const ordersSorted = [...group.orders].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      )

      const points: Point[] = [driverPos]
      const waypoints: Waypoint[] = [
        {
          type: "driver",
          label: "🚚",
          address: "Текущая позиция",
          position: [driver.latitude, driver.longitude],
        },
      ]

      let wpIndex = 0
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

      // Добавляем точки загрузки/выгрузки
      for (const order of ordersSorted) {
        const fromCoords = await geocodeWithCache(order.routeFrom)
        if (fromCoords) {
          points.push(fromCoords)
          waypoints.push({
            type: "loading",
            label: letters[wpIndex++] || "•",
            address: order.routeFrom,
            position: [fromCoords.lat, fromCoords.lng],
          })
        }

        const toCoords = await geocodeWithCache(order.routeTo)
        if (toCoords) {
          points.push(toCoords)
          waypoints.push({
            type: "unloading",
            label: letters[wpIndex++] || "•",
            address: order.routeTo,
            position: [toCoords.lat, toCoords.lng],
          })
        }
      }

      // ✅ ВАЖНО: Добавляем базу как конечную точку маршрута
      const basePoint: Point = { lat: base.coordinates[0], lng: base.coordinates[1] }
      points.push(basePoint)
      waypoints.push({
        type: "base",
        label: "🏠",
        address: base.address,
        position: base.coordinates,
      })

      if (points.length < 2) continue

      // Получаем геометрию маршрута
      const osrmRoute = await getOSRMRoute(points)
      let coordinates: [number, number][]
      let distanceKm = 0
      let durationMin = 0

      if (osrmRoute) {
        coordinates = osrmRoute.coordinates
        distanceKm = osrmRoute.distance
        durationMin = osrmRoute.duration
      } else {
        coordinates = generateSmoothCurve(points)
        distanceKm = ordersSorted.reduce((sum: any, o: any) => sum + (o.distance || 0), 0)
      }

      const totalPrice = ordersSorted.reduce((sum: any, o: any) => sum + (o.price || 0), 0)
      const mainStatus = ordersSorted.some((o: any) =>
        ["in_transit", "loading", "unloading"].includes(o.status)
      )
        ? "in_transit"
        : "confirmed"

      routes.push({
        id: routeKey,
        driverId: group.driverId,
        driverName: driver.name,
        vehiclePlate: driver.vehiclePlate,
        driverPos: [driver.latitude, driver.longitude] as [number, number],
        routeFrom: ordersSorted[0].routeFrom,
        routeTo: ordersSorted[ordersSorted.length - 1].routeTo,
        status: mainStatus,
        cargoType: ordersSorted[0].cargoType,
        totalPrice,
        totalDistance: distanceKm,
        duration: durationMin,
        coordinates,
        waypoints,
        // Цвет маршрута из премиальной палитры
        color: ROUTE_COLORS[colorIndex++ % ROUTE_COLORS.length],
        orders: ordersSorted.map((o: any) => ({
          id: o.id,
          from: o.routeFrom,
          to: o.routeTo,
          status: o.status,
          cargo: o.cargoType,
          price: o.price,
        })),
      })
    }

    return NextResponse.json({
      success: true,
      base,
      warning,
      routes,
    })
  } catch (error: any) {
    console.warn("[Dashboard Routes API] Safe fallback due to:", error?.message || error)
    return NextResponse.json(
      { 
        success: false, 
        error: error?.message || "Unknown error",
        base: {
          name: "Автопарк",
          address: "Москва",
          coordinates: DEFAULT_BASE_COORDS,
        },
        routes: [],
      },
      { status: 200 }
    )
  }
}