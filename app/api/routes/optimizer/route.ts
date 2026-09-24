// app/api/routes/optimizer/route.ts
//
// POST /api/routes/optimizer — три сценария рейса («быстрее», «дешевле»,
// «сбалансировано») на реальных данных, а не на числах-заглушках.
//
// Что откуда берётся:
//   • километры, время в пути, геометрия — OSRM через lib/eta (public OSRM,
//     решение пользователя от 2026-09-24: «публичный OSRM, при недоступности —
//     прямые линии»);
//   • поправка на время суток (час пик) и день недели — lib/eta/coefficients;
//   • расход топлива — та же модель, что и в остальном проекте
//     (lib/eta/coefficients: 32 л/100 км × 65 ₽/л от реального пробега);
//   • пробки — Яндекс.Маршрутизация, если она настроена
//     (TRAFFIC_PROVIDER=yandex + YANDEX_ROUTING_API_KEY). Если не настроена,
//     в ответе честно стоит traffic:"estimate": оценка по времени суток, а не
//     выдуманные «пробки на М-10» (демо-генератор lib/traffic здесь не
//     используется вовсе);
//   • платные дороги — точных тарифов у проекта нет, поэтому всегда
//     tolls:"estimate" (оценка по средней ставке), и это видно в интерфейсе.
//
// Порядок объезда точек считает чистая функция lib/routes/optimizer.ts.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { geocodeAddresses, type Coordinates } from "@/lib/geo/geocode"
import { calculateETA } from "@/lib/eta/service"
import { getRouteTraffic } from "@/lib/traffic/service"
import {
  OPTIMIZER_VARIANTS,
  filterOptimizableOrders,
  normalizeCity,
  sequenceOrders,
  variantPolicy,
  type OptimizerOrderLike,
  type OptimizerVariantId,
} from "@/lib/routes/optimizer"

export const dynamic = "force-dynamic"
// Геокодирование адресов идёт с паузой (политика Nominatim — не чаще 1 раза в
// секунду), поэтому расчёту нужно время.
export const maxDuration = 60

/** Сколько заказов можно прогнать через сценарии за один раз. */
const MAX_OPTIMIZER_ORDERS = 20

type SourceRouting = "osrm" | "fallback"
type SourceTraffic = "yandex" | "estimate"
type SourceTolls = "estimate"

type OptimizerBody = {
  orderIds?: unknown
  departureTime?: unknown
}

type OrderRow = {
  id: string
  routeFrom: string
  routeTo: string
  distance: number
  weight: number
  price: number | null
  status: string
  deadline: Date | null
}

type VariantLeg = {
  from: string
  to: string
  distanceKm: number
  durationMin: number
}

type VariantResult = {
  id: OptimizerVariantId
  title: string
  subtitle: string
  orderedOrderIds: string[]
  points: Array<{ orderId: string; city: string; role: "from" | "to" }>
  legs: VariantLeg[]
  metrics: {
    distanceKm: number
    etaMin: number
    baseMin: number
    trafficDelayMin: number
    fuelRub: number
    tollsRub: number
    revenueRub: number
    profitRub: number
    profitPerKm: number
    riskScore: number
  }
  sources: {
    routing: SourceRouting
    traffic: SourceTraffic
    tolls: SourceTolls
    trafficNote: string
  }
  why: string[]
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const body = (await request.json().catch(() => null)) as OptimizerBody | null
    if (!body) {
      return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 })
    }

    const orderIds = Array.isArray(body.orderIds)
      ? body.orderIds.filter((value): value is string => typeof value === "string" && value.length > 0)
      : []

    if (orderIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "Передайте orderIds[] — заказы, между которыми ищем порядок" },
        { status: 400 },
      )
    }
    if (orderIds.length > MAX_OPTIMIZER_ORDERS) {
      return NextResponse.json(
        { success: false, error: `За один раз можно посчитать не больше ${MAX_OPTIMIZER_ORDERS} заказов` },
        { status: 400 },
      )
    }

    const departure =
      typeof body.departureTime === "string" && !Number.isNaN(new Date(body.departureTime).getTime())
        ? new Date(body.departureTime)
        : new Date()

    // Заказы строго своей организации: чужой id не попадёт в расчёт, а запрос
    // вернёт 404, не раскрывая, существует ли такой заказ вообще.
    const orders = (await prisma.order.findMany({
      where: scopedWhere(org.organizationId, { id: { in: orderIds } }),
      select: {
        id: true,
        routeFrom: true,
        routeTo: true,
        distance: true,
        weight: true,
        price: true,
        status: true,
        deadline: true,
      },
    })) as OrderRow[]

    const foundIds = new Set(orders.map((order) => order.id))
    const missing = orderIds.filter((id) => !foundIds.has(id))
    if (missing.length > 0) {
      return NextResponse.json(
        { success: false, error: "Заказы не найдены", code: "orders_not_found", orderIds: missing },
        { status: 404 },
      )
    }

    const usable = filterOptimizableOrders(orders)
    if (usable.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Все выбранные заказы уже завершены или отменены — считать нечего",
          code: "orders_final",
        },
        { status: 400 },
      )
    }

    // ── Координаты городов (Nominatim + постоянный кэш GeoCache) ──────────
    const cities = Array.from(new Set(usable.flatMap((order) => [order.routeFrom, order.routeTo])))
    const coordinates = await geocodeAddresses(cities)

    const problems: string[] = []
    const withCoords: Array<{ order: OrderRow; from: Coordinates; to: Coordinates }> = []

    for (const order of usable) {
      const from = coordinates.get(order.routeFrom) ?? null
      const to = coordinates.get(order.routeTo) ?? null
      if (!from || !to) {
        const unknown = [!from ? order.routeFrom : null, !to ? order.routeTo : null].filter(
          (city): city is string => Boolean(city),
        )
        for (const city of unknown) {
          if (!problems.includes(city)) problems.push(city)
        }
        continue
      }
      withCoords.push({ order, from, to })
    }

    if (withCoords.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Не удалось определить координаты городов — считать сценарии не по чему",
          code: "no_coordinates",
          problems,
        },
        { status: 422 },
      )
    }

    const trafficProvider = (process.env.TRAFFIC_PROVIDER || "mock").toLowerCase()

    const variantResults: VariantResult[] = []

    for (const variant of OPTIMIZER_VARIANTS) {
      const sequence = sequenceOrders(
        withCoords.map((item) => ({ ...item.order })) as OptimizerOrderLike[],
        variant,
      )

      const byId = new Map(withCoords.map((item) => [item.order.id, item]))
      const route = sequence
        .map((id) => byId.get(id))
        .filter((item): item is { order: OrderRow; from: Coordinates; to: Coordinates } => Boolean(item))

      // Точки маршрута: погрузка → выгрузка каждого заказа. Соседние дубликаты
      // (выгрузка там же, где погрузка следующего) схлопываются, чтобы не
      // получить нулевой перегон.
      const points: Array<{ orderId: string; city: string; role: "from" | "to"; coordinates: Coordinates }> = []
      for (const item of route) {
        const pairs: Array<{ city: string; role: "from" | "to"; coordinates: Coordinates }> = [
          { city: item.order.routeFrom, role: "from", coordinates: item.from },
          { city: item.order.routeTo, role: "to", coordinates: item.to },
        ]
        for (const point of pairs) {
          const last = points[points.length - 1]
          if (last && normalizeCity(last.city) === normalizeCity(point.city)) continue
          points.push({ orderId: item.order.id, ...point })
        }
      }

      const origin = points[0].coordinates
      const destination = points[points.length - 1].coordinates
      const waypoints = points.slice(1, -1).map((point) => ({
        lat: point.coordinates.lat,
        lng: point.coordinates.lng,
        name: point.city,
      }))

      // Реальный расчёт: OSRM по дорогам + коэффициенты времени суток.
      const eta = await calculateETA({
        origin,
        destination,
        waypoints,
        departureTime: departure,
        useCache: true,
        vehicle: { type: "truck" },
      })

      if (!eta.success) {
        return NextResponse.json(
          { success: false, error: "Не удалось рассчитать маршрут", code: "eta_failed" },
          { status: 502 },
        )
      }

      const routing: SourceRouting = eta.source === "osrm" ? "osrm" : "fallback"
      const distanceKm = Math.round(eta.distance / 1000)
      const baseMin = Math.round(eta.durationBase / 60)
      let etaMin = Math.round(eta.durationWithTraffic / 60)
      let trafficDelayMin = Math.max(0, etaMin - baseMin)

      // Пробки: только реальный сервис. Демо-генератор lib/traffic (provider
      // "mock") здесь не используется — он рисует выдуманные ДТП.
      let traffic: SourceTraffic = "estimate"
      let trafficNote = "Оценка по времени суток (внешний сервис пробок не настроен)"

      if (trafficProvider === "yandex") {
        try {
          const trafficResult = await getRouteTraffic({
            routeId: `optimizer:${variant}:${points.map((p) => `${p.coordinates.lat.toFixed(3)},${p.coordinates.lng.toFixed(3)}`).join("|")}`,
            // lib/traffic работает с кортежами [lat, lng], lib/geo — с {lat, lng}
            coordinates: points.map(
              (point) => [point.coordinates.lat, point.coordinates.lng] as [number, number],
            ),
          })

          if (trafficResult.summary) {
            trafficDelayMin = trafficResult.summary.delayMin
            etaMin = baseMin + trafficDelayMin
            traffic = "yandex"
            trafficNote = `Яндекс.Маршрутизация: +${trafficDelayMin} мин к пути (×${trafficResult.summary.ratio})`
          }
        } catch (error) {
          console.error("[optimizer] Яндекс.Маршрутизация недоступна:", error)
          trafficNote = "Яндекс.Маршрутизация недоступна — оценка по времени суток"
        }
      }

      const revenueRub = route.reduce((sum, item) => sum + (item.order.price || 0), 0)
      const fuelRub = eta.estimatedCost.fuel
      const tollsRub = eta.estimatedCost.tolls
      const profitRub = revenueRub - fuelRub - tollsRub
      const profitPerKm = distanceKm > 0 ? Math.round(profitRub / distanceKm) : 0
      const riskScore = Math.round(eta.riskFactors.delayProbability * 100)

      const policy = variantPolicy(variant)
      const why: string[] = [...policy.notes]

      why.push(
        routing === "osrm"
          ? `Километры и время — по дорогам (OSRM), выезд ${departure.toLocaleString("ru-RU")}`
          : "OSRM недоступен: пробег и время посчитаны по прямой с коэффициентом 1.3",
      )
      why.push(trafficNote)
      why.push(
        `Топливо: ${fuelRub.toLocaleString("ru-RU")} ₽ (32 л/100 км × 65 ₽/л от ${distanceKm} км)`,
      )
      why.push(
        `Платные дороги: ${tollsRub.toLocaleString("ru-RU")} ₽ — оценка по средней ставке, точных тарифов нет`,
      )

      const earliestDeadline = route
        .map((item) => item.order.deadline)
        .filter((value): value is Date => Boolean(value))
        .sort((a, b) => a.getTime() - b.getTime())[0]
      if (earliestDeadline) {
        why.push(`Ближайший срок: ${earliestDeadline.toLocaleDateString("ru-RU")}`)
      }

      if (eta.riskFactors.reasons.length > 0) {
        why.push(`Риск: ${eta.riskFactors.reasons[0]}`)
      }

      variantResults.push({
        id: variant,
        title: policy.title,
        subtitle: policy.subtitle,
        orderedOrderIds: route.map((item) => item.order.id),
        points: points.map((point) => ({
          orderId: point.orderId,
          city: point.city,
          role: point.role,
        })),
        legs: (eta.routeDetails?.legs ?? []).map((leg) => ({
          from: leg.from,
          to: leg.to,
          distanceKm: Math.round(leg.distance / 1000),
          durationMin: Math.round(leg.duration / 60),
        })),
        metrics: {
          distanceKm,
          etaMin,
          baseMin,
          trafficDelayMin,
          fuelRub,
          tollsRub,
          revenueRub,
          profitRub,
          profitPerKm,
          riskScore,
        },
        sources: { routing, traffic, tolls: "estimate", trafficNote },
        why: why.slice(0, 6),
      })
    }

    return NextResponse.json({
      success: true,
      departureTime: departure.toISOString(),
      // Сценарные варианты отличаются порядком объезда, поэтому источники
      // собираем по всем вариантам: интерфейс обязан показать, где измерение,
      // а где оценка.
      sources: {
        routing: variantResults.every((v) => v.sources.routing === "osrm") ? "osrm" : "fallback",
        traffic: variantResults.some((v) => v.sources.traffic === "yandex") ? "yandex" : "estimate",
        tolls: "estimate" as const,
        geocoding: "nominatim",
      },
      problems,
      skipped: usable.length - withCoords.length,
      variants: variantResults,
    })
  } catch (error) {
    console.error("[optimizer] ошибка расчёта сценариев:", error)
    const message = error instanceof Error ? error.message : "Не удалось посчитать сценарии"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
