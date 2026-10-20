// app/api/orders/geo-points/route.ts
//
// Координаты городов заказов — для сборки рейса «в радиусе».
//
// Зачем отдельный эндпоинт: помощник спрашивает «а далеко ли этот груз от
// моего маршрута», а ответ требует координат. Тащить геометр всех заказов
// вместе с их списком — лишние сотни килобайт на каждый запрос, поэтому
// точки считаются отдельно и только для городов, которые реально нужны.
//
// Геокодирование идёт через общий кэш (GeoCache): повторный вопрос о том же
// городе базу не трогает. Города без координат возвращаются как null —
// помощник тогда соберёт рейс по направлению и честно скажет об этом.

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NOT_ARCHIVED } from "@/lib/archive/filters"
import { prisma } from "@/lib/prisma"
import { geocodeAddresses } from "@/lib/geo/geocode"
import { shortCity } from "@/lib/logist-mobile/format"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Сколько городов максимум геокодируем за один запрос. */
const MAX_CITIES = 40

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    // Города берём только по заказам, из которых вообще можно собрать рейс:
    // согласованные и те, что ещё в переговорах (по ним логист звонит).
    const orders = await prisma.order.findMany({
      where: scopedWhere(org.organizationId, {
        ...NOT_ARCHIVED,
        routeId: null,
        status: { in: ["agreed", "negotiation", "search"] },
      }),
      select: { routeFrom: true, routeTo: true },
      take: 300,
    })

    const cities = Array.from(
      new Set(
        orders
          .flatMap((order) => [order.routeFrom, order.routeTo])
          .map((value) => shortCity(value))
          .filter((value) => Boolean(value) && value !== "—"),
      ),
    ).slice(0, MAX_CITIES)

    const points: Record<string, { lat: number; lng: number } | null> = {}
    if (cities.length > 0) {
      const resolved = await geocodeAddresses(cities)
      for (const city of cities) {
        const coords = resolved.get(city) ?? null
        points[city] = coords ? { lat: coords.lat, lng: coords.lng } : null
      }
    }

    return NextResponse.json({
      success: true,
      points,
      citiesTotal: cities.length,
      truncated: cities.length >= MAX_CITIES,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка"
    console.warn("[GeoPoints API] ошибка:", message)
    return NextResponse.json(
      { success: false, error: message, points: {} },
      { status: 200 },
    )
  }
}
