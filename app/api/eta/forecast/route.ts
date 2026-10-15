// app/api/eta/forecast/route.ts
// Посегментный прогноз времени прибытия: POST /api/eta/forecast
//
// Отличия от старого /api/routes/calculate-eta:
//   * расчёт по сегментам с учётом момента прохождения каждого;
//   * прогноз можно СОХРАНИТЬ, чтобы потом сравнить с фактом;
//   * в ответе — уверенность, объяснение поправок и диапазон сценариев,
//     а не одно число.
//
// Безопасность: организация берётся из проверенной сессии, никогда из тела
// запроса. Машина подгружается из своей организации — чужой vehicleId даёт
// 404, а не «нейтральный» профиль ТС.

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, notFoundInOrganization } from "@/lib/org"
import { prisma } from "@/lib/prisma"
import { calculateSegmentEta } from "@/lib/eta/orchestrator"
import { saveForecast } from "@/lib/eta/repository"
import { checkEtaRateLimit } from "@/lib/eta/rate-limit"
import { geocodeAddressesWithSource } from "@/lib/geo/geocode"
import { isWeatherEnabled } from "@/lib/eta/weather/client"
import type { StopRequest } from "@/lib/eta/stops"
import type { RoadEvent } from "@/lib/eta/events"
import type { VehicleInput } from "@/lib/eta/vehicle-profile"

interface ForecastBody {
  origin?: { lat: number; lng: number }
  destination?: { lat: number; lng: number }
  waypoints?: Array<{ lat: number; lng: number }>
  /**
   * Достаточно одного routeId: сервер сам возьмёт точки рейса из заказов и
   * превратит названия городов в координаты (кэш GeoCache + геокодер).
   * Клиенту не нужно знать координат — ему видны только названия.
   */
  departure?: string
  /** Рейс, к которому привязать прогноз (для сравнения с фактом) */
  routeId?: string
  orderId?: string
  /** Машина: id из своей организации */
  vehicleId?: string
  stops?: Array<StopRequest & { afterSegmentIndex?: number }>
  events?: RoadEvent[]
  /** Сохранить прогноз в базу (по умолчанию — да, если указан routeId) */
  save?: boolean
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const org = requireStaffOrganization(auth.user)
  // Лимит частоты: расчёт дёргает OSRM и (включённую) погоду. Без него один
  // клиент выжимает чужие лимиты внешних API. Ключ — организация из сессии.
  if (!org.ok) return org.response
  const rateLimit = await checkEtaRateLimit(request, "forecast", org.organizationId)
  if (rateLimit.response) return rateLimit.response

  let body: ForecastBody | null = null
  try {
    body = (await request.json()) as ForecastBody
  } catch {
    return NextResponse.json({ error: "Ожидается JSON" }, { status: 400 })
  }

  const departure = body.departure ? new Date(body.departure) : new Date()
  if (Number.isNaN(departure.getTime())) {
    return NextResponse.json({ error: "Некорректное время выезда" }, { status: 400 })
  }

  // ── Точки маршрута: либо из тела, либо из заказов рейса ──
  let origin = body?.origin
  let destination = body?.destination
  let waypoints = body?.waypoints || []

  // Рейс проверяется ВСЕГДА, когда передан routeId — даже если координаты
  // пришли в теле. Иначе прогноз организации А сохранился бы со ссылкой на
  // рейс организации Б: фильтр по организации при чтении такую строку не
  // покажет, но в базе появилась бы межорганизационная связь.
  let routeOrders: Array<{ routeFrom: string; routeTo: string; routeSequence: number | null; createdAt: Date }> = []
  if (body?.routeId) {
    const route = await prisma.route.findFirst({
      where: { id: body.routeId, organizationId: org.organizationId },
      // Без фильтра по routeSequence: у старых рейсов он может быть null,
      // порядок всё равно восстанавливаем ниже
      select: {
        orders: { select: { routeFrom: true, routeTo: true, routeSequence: true, createdAt: true } },
      },
    })
    if (!route) return notFoundInOrganization("Рейс")
    routeOrders = route.orders
  }

  if ((!origin || !destination) && routeOrders.length > 0) {
    const orders = [...routeOrders].sort((a, b) => {
      const sa = a.routeSequence
      const sb = b.routeSequence
      if (sa != null && sb != null) return sa - sb
      if (sa != null) return -1
      if (sb != null) return 1
      return a.createdAt.getTime() - b.createdAt.getTime()
    })
    if (orders.length > 0) {
      const names = [
        orders[0].routeFrom,
        ...orders.map((order) => order.routeTo),
      ]
      const { coords } = await geocodeAddressesWithSource(names)

      const points = names
        .map((name) => coords.get(name.trim()))
        .filter((point): point is { lat: number; lng: number } => Boolean(point))

      if (points.length >= 2) {
        origin = points[0]
        destination = points[points.length - 1]
        waypoints = points.slice(1, -1)
      } else {
        return NextResponse.json(
          { error: "Не удалось определить координаты точек рейса" },
          { status: 422 },
        )
      }
    }
  }

  if (!origin || !destination) {
    return NextResponse.json(
      { error: "Требуются origin и destination, либо routeId с точками" },
      { status: 400 },
    )
  }

  // ── Машина: только из своей организации ──
  let vehicle: VehicleInput | undefined
  if (body.vehicleId) {
    const row = await prisma.vehicle.findFirst({
      where: { id: body.vehicleId, organizationId: org.organizationId },
      select: {
        type: true,
        capacity: true,
        volume: true,
        length: true,
        width: true,
        height: true,
      },
    })
    if (!row) return notFoundInOrganization("Транспортное средство")

    vehicle = {
      type: row.type ?? undefined,
      capacity: row.capacity ?? undefined,
      volume: row.volume ?? undefined,
      length: row.length ?? undefined,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
    }
  }

  const result = await calculateSegmentEta({
    origin,
    destination,
    waypoints,
    departure,
    vehicle,
    stops: body.stops,
    events: body.events,
  })

  if (!result.ok || !result.forecast) {
    return NextResponse.json(
      { error: result.error || "Не удалось построить маршрут" },
      { status: 422 },
    )
  }

  const forecast = result.forecast

  // ── Сохранение прогноза: без него его не с чем сравнить ──
  const shouldSave = body.save !== false && Boolean(body.routeId)
  let forecastId: string | null = null

  if (shouldSave) {
    forecastId = await saveForecast({
      organizationId: org.organizationId,
      routeId: body.routeId,
      orderId: body.orderId,
      vehicleId: body.vehicleId,
      forecast,
      sources: [
        result.source,
        ...(result.weatherAvailable ? ["open-meteo"] : []),
      ],
      weatherSnapshot: forecast.segments.map((segment) => ({
        segmentIndex: segment.index,
        condition: segment.weather?.condition ?? null,
        factor: segment.weather?.factor ?? null,
        at: segment.arrivalAt.toISOString(),
      })),
    })
  }

  return NextResponse.json({
    id: forecastId,
    saved: shouldSave,
    modelVersion: forecast.modelVersion,
    timeZone: forecast.timeZone,
    reliable: forecast.reliable,
    reliabilityNote: forecast.reliabilityNote,
    departureAt: forecast.departureAt.toISOString(),
    scenarios: {
      optimistic: {
        totalSec: Math.round(forecast.scenarios.optimistic.totalSec),
        arrivalAt: forecast.scenarios.optimistic.arrivalAt.toISOString(),
      },
      base: {
        totalSec: Math.round(forecast.scenarios.base.totalSec),
        arrivalAt: forecast.scenarios.base.arrivalAt.toISOString(),
        drivingSec: Math.round(forecast.scenarios.base.drivingSec),
        stopsSec: Math.round(forecast.scenarios.base.stopsSec),
        restSec: Math.round(forecast.scenarios.base.restSec),
      },
      conservative: {
        totalSec: Math.round(forecast.scenarios.conservative.totalSec),
        arrivalAt: forecast.scenarios.conservative.arrivalAt.toISOString(),
      },
    },
    distanceM: forecast.segments.reduce((sum, segment) => sum + segment.distanceM, 0),
    confidence: forecast.confidence,
    explanation: forecast.explanation,
    violations: forecast.violations,
    stops: forecast.stops,
    rest: {
      totalMinutes: forecast.rest.totalMinutes,
      breaks: forecast.rest.breaks,
      warning: forecast.rest.warning,
    },
    segments: forecast.segments.map((segment) => ({
      index: segment.index,
      distanceM: segment.distanceM,
      roadClass: segment.roadClass,
      roadClassLabel: segment.roadClassLabel,
      roadClassConfidence: segment.roadClassConfidence,
      roadName: segment.roadName,
      baseSpeedKmh: segment.baseSpeedKmh,
      arrivalAt: segment.arrivalAt.toISOString(),
      departureAt: segment.departureAt.toISOString(),
      drivingSec: segment.drivingSec,
      totalFactor: segment.totalFactor,
      blocked: segment.blocked ?? false,
      weather: segment.weather,
      corrections: segment.corrections,
    })),
    sources: {
      routing: result.source,
      weather: result.weatherAvailable ? "open-meteo" : result.weatherSkipped ? "disabled" : "unavailable",
      weatherEnabled: isWeatherEnabled(),
    },
  })
}

/** Справка по эндпоинту — что он принимает и откуда берёт данные. */
export async function GET() {
  return NextResponse.json({
    service: "Segment ETA",
    status: "ok",
    usage: {
      method: "POST",
      body: {
        origin: "{ lat, lng }",
        destination: "{ lat, lng }",
        waypoints: "[{ lat, lng }] — необязательно",
        departure: "ISO-дата выезда, по умолчанию сейчас",
        routeId: "id рейса — чтобы сохранить прогноз и сравнить с фактом",
        vehicleId: "id машины из своей организации",
        stops: "[{ kind, afterSegmentIndex, actualMinutes? }]",
        events: "[{ segmentIndex, severity, description, reportedAt }]",
      },
    },
    sources: {
      routing: "OSRM (публичный демо-сервер, без ключа)",
      weather: "Open-Meteo — ВЫКЛЮЧЕН по умолчанию: бесплатный тариф только для некоммерческого использования",
    },
  })
}
