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
import {
  geocodeAddressesWithSource,
  summarizeGeocodeSource,
  type Coordinates,
  type GeocodeSource,
} from "@/lib/geo/geocode"
import { buildOptimizerStages, calculateOptimizerTrip } from "@/lib/routes/optimizer-trip"
import { fetchOSRMRoute } from "@/lib/eta/osrm-client"
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
type SourceTraffic = "yandex" | "2gis" | "historical"
type SourceTolls = "estimate"
type SourceGeocoding = GeocodeSource

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
    /** Операции (погрузка/выгрузка), мин — из единого движка */
    stopsMin: number
    /** Обязательные перерывы, мин — из единого движка */
    restMin: number
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

    // ── Координаты городов (Яндекс → Nominatim + кэш GeoCache) ────────────
    const cities = Array.from(new Set(usable.flatMap((order) => [order.routeFrom, order.routeTo])))
    const { coords: coordinates, sources: geocodeSources } = await geocodeAddressesWithSource(cities)
    const geocodingSource = summarizeGeocodeSource(geocodeSources)

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

    // База организации: без неё единый движок не считает возврат на базу, и
    // оптимизатор обещал бы рейс короче, чем он есть на самом деле.
    const fleet = await prisma.fleetSettings.findFirst({
      where: { organizationId: org.organizationId },
      select: { baseLat: true, baseLng: true, baseAddress: true },
    })
    const basePoint: Coordinates | null =
      fleet?.baseLat != null && fleet?.baseLng != null
        ? { lat: fleet.baseLat, lng: fleet.baseLng }
        : null

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

      // Единый движок рейса: та же шкала этапов, что в кабинете водителя и
      // на карте логиста. Учитывает порядок точек, погрузку и выгрузку,
      // обязательные перерывы, сроки заказов и возврат на базу. Раньше здесь
      // был calculateETA — одно число на весь маршрут без операций и отдыха.
      const tripInput = {
        orders: route.map((item) => ({
          id: item.order.id,
          routeFrom: item.order.routeFrom,
          routeTo: item.order.routeTo,
          from: item.from,
          to: item.to,
          distance: item.order.distance,
          deadline: item.order.deadline,
        })),
        base: basePoint ? { point: basePoint, address: fleet?.baseAddress ?? "база" } : null,
        vehicle: { type: "truck" },
        departure,
        timeZone: "Europe/Moscow",
      }

      // Расстояния — от маршрутизатора, по тем же плечам, что строит движок:
      // от базы через все точки и обратно на базу. Плечо без дороги движок
      // сам оценит по прямой ×1.3 и честно пометит.
      const legStages = buildOptimizerStages(tripInput).filter(
        (stage) =>
          (stage.kind === "driving" || stage.kind === "return_to_base") && stage.from && stage.to,
      )
      const legPoints = legStages.map((stage) => ({ from: stage.from!, to: stage.to! }))

      let routing: SourceRouting = "fallback"
      let legs: Array<{ from: Coordinates; to: Coordinates; distanceM: number; freeFlowSec: number }> = []

      if (legPoints.length > 0) {
        try {
          // Полная цепочка точек: начало первого плеча, начало каждого
          // следующего плеча и конец последнего. Плечо i начинается в точке i,
          // поэтому в «путевые» точки идут начала ВСЕХ плеч, кроме первого.
          const osrm = await fetchOSRMRoute(
            legPoints[0].from,
            legPoints[legPoints.length - 1].to,
            legPoints.slice(1).map((leg) => ({ lat: leg.from.lat, lng: leg.from.lng })),
          )
          const osrmLegs = osrm.routes[0]?.legs ?? []
          if (osrmLegs.length === legPoints.length) {
            legs = legPoints.map((leg, index) => ({
              from: leg.from,
              to: leg.to,
              distanceM: osrmLegs[index].distance,
              freeFlowSec: osrmLegs[index].duration,
            }))
            routing = "osrm"
          }
        } catch (error) {
          // Маршрутизатор недоступен — считаем по прямой, честно помечая источник
          console.warn("[routes/optimizer] OSRM недоступен:", error)
        }
      }

      const tripResult = calculateOptimizerTrip({ ...tripInput, legs })
      const distanceKm = Math.round(tripResult.distanceKm)
      const baseMin = tripResult.baseMin
      let etaMin = tripResult.etaMin
      // Задержка от часовых/погодных поправок = движение по факторам минус
      // движение «на свободной дороге». Раньше это было etaMin - baseMin, но
      // теперь в etaMin входят операции и перерывы, и такая разница означала
      // бы «пробки», хотя на самом деле это погрузка и отдых.
      let trafficDelayMin = Math.max(
        0,
        Math.round(
          (tripResult.trip.stages.reduce(
            (sum, stage) =>
              sum +
              (stage.segment
                ? Math.max(0, stage.segment.drivingSec - stage.segment.freeFlowSec)
                : 0),
            0,
          ) /
            60) *
            1,
        ),
      )

      // Пробки: только реальный сервис. Демо-генератор lib/traffic (provider
      // "mock") здесь не используется — он рисует выдуманные ДТП. Без внешнего
      // сервиса время считается историческими коэффициентами lib/eta — модель
      // по часу пика, дню недели, грузу и типу дороги, а не измерение дороги.
      let traffic: SourceTraffic = "historical"
      // Поправки — объяснения единого движка: он же их и применяет, поэтому
      // оптимизатор не может расходиться с кабинетом водителя
      const factors = tripResult.trip.factors
        .filter((item) => item.factor !== 1)
        .map((item) => `${item.label} ×${item.factor.toFixed(2)}`)
      let trafficNote =
        factors.length > 0
          ? `Историческая оценка: ${factors.join(", ")}`
          : "Историческая оценка: коэффициенты нейтральны"

      // Провайдеры пробок: «yandex» (Яндекс.Маршрутизация, от 120 000 ₽/год) и
      // «2gis» (2ГИС Routing API: демо-ключ бесплатно, дальше от 6 701 ₽ за
      // 10 000 запросов). Оба деградируют до оценки по времени суток.
      if (trafficProvider === "yandex" || trafficProvider === "2gis") {
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
            // Полное время = движение + операции + перерывы + задержка сервиса
            etaMin = baseMin + tripResult.stopsMin + tripResult.restMin + trafficDelayMin
            traffic = trafficProvider === "2gis" ? "2gis" : "yandex"
            trafficNote =
              trafficProvider === "2gis"
                ? `2ГИС: +${trafficDelayMin} мин к пути (×${trafficResult.summary.ratio})`
                : `Яндекс.Маршрутизация: +${trafficDelayMin} мин к пути (×${trafficResult.summary.ratio})`
          }
        } catch (error) {
          console.error(`[optimizer] ${trafficProvider} недоступен:`, error)
          trafficNote =
            trafficProvider === "2gis"
              ? "2ГИС недоступен — оценка по времени суток"
              : "Яндекс.Маршрутизация недоступна — оценка по времени суток"
        }
      }

      const revenueRub = route.reduce((sum, item) => sum + (item.order.price || 0), 0)
      const fuelRub = tripResult.cost.fuel
      const tollsRub = tripResult.cost.tolls
      const profitRub = revenueRub - fuelRub - tollsRub
      const profitPerKm = distanceKm > 0 ? Math.round(profitRub / distanceKm) : 0
      // Риск задержки — из уверенности единого движка: чем меньше уверенность,
      // тем выше шанс, что время уйдёт. Раньше это был отдельный расчёт.
      const riskScore = Math.round((1 - tripResult.trip.confidence.score) * 100)

      const policy = variantPolicy(variant)
      const why: string[] = [...policy.notes]

      why.push(
        routing === "osrm"
          ? `Километры и время — по дорогам (OSRM), выезд ${departure.toLocaleString("ru-RU")}`
          : "OSRM недоступен: пробег и время посчитаны по прямой с коэффициентом 1.3",
      )
      // Операции и отдых — то, чего прежний расчёт не видел вовсе
      why.push(
        `Операции ${tripResult.stopsMin} мин + обязательные перерывы ${tripResult.restMin} мин — ` +
          `учтены в шкале этапов рейса`,
      )
      if (tripResult.deadlineViolations.length > 0) {
        why.push(
          `Срок нарушен у ${tripResult.deadlineViolations.length} заказ(ов): ` +
            `${tripResult.deadlineViolations.map((item) => item.routeTo).join(", ")}`,
        )
      }
      if (tripResult.estimatedLegs > 0) {
        why.push(
          `У ${tripResult.estimatedLegs} плеч(а) расстояние оценено по прямой — цифры грубее`,
        )
      }
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

      if (tripResult.trip.dataQuality.warnings.length > 0) {
        why.push(`Качество данных: ${tripResult.trip.dataQuality.warnings[0]}`)
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
        // Плечами стали этапы движения единого движка: у каждого есть адрес,
        // расстояние и плановое время. Погрузка/выгрузка видны отдельно.
        legs: tripResult.stages
          .filter((stage) => stage.kind === "driving" || stage.kind === "return_to_base")
          .map((stage) => ({
            from: stage.address?.split(" → ")[0] ?? "",
            to: stage.address?.split(" → ")[1] ?? stage.address ?? "",
            distanceKm: stage.distanceKm ?? 0,
            durationMin: Math.round((stage.plannedEndAt.getTime() - stage.plannedStartAt.getTime()) / 60000),
          })),
        metrics: {
          distanceKm,
          etaMin,
          baseMin,
          stopsMin: tripResult.stopsMin,
          restMin: tripResult.restMin,
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
        traffic: variantResults.some((v) => v.sources.traffic !== "historical")
          ? variantResults.find((v) => v.sources.traffic !== "historical")!.sources.traffic
          : "historical",
        tolls: "estimate" as const,
        // Источник координат честный: yandex, nominatim, cache или none.
        // Раньше тут была захардкоженная метка nominatim, и интерфейс врал,
        // хотя ключ Яндекса работает.
        geocoding: geocodingSource,
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
