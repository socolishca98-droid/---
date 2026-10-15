// lib/eta/trip-repository.ts
//
// Серверная сборка прогноза рейса из базы.
//
// Разделение: lib/eta/trip.ts — чистая математика шкалы этапов (её можно
// тестировать без базы), этот файл — загрузка данных и их приведение к той
// форме. Сети здесь нет: геокодирование делает lib/geo/geocode.ts, погоду —
// lib/eta/weather/client.ts, оба с кэшем.
//
// Источник истины об ИСПОЛНЕНИИ этапа — существующая модель RouteStage
// (prisma/schema.prisma): type, status, sequence, plannedStartAt/plannedEndAt,
// startedAt/endedAt. Она была в проекте и раньше, но почти не использовалась:
// демо-сиды писали в неё, а читал только мобильный API. Параллельной модели
// этапов здесь не заводится.
//
// Изоляция организаций: organizationId передаётся обязательным параметром и
// стоит в КАЖДОМ условии запроса. Фильтр в интерфейсе ничего не решает.

import "server-only"

import { prisma } from "@/lib/prisma"
import { geocodeAddressesWithSource } from "@/lib/geo/geocode"
import {
  buildRouteStages,
  calculateTripEta,
  type TripEtaOptions,
  type TripEtaResult,
  type TripStageInput,
} from "./trip"
import type { Coordinates } from "./types"
import type { VehicleInput } from "./vehicle-profile"
import type { RestRules } from "./driver-rest"
import type { StopRequest } from "./stops"

/** Максимум заказов в одном рейсе: защита от переполнения запроса. */
export const MAX_ROUTE_ORDERS = 50

export interface RouteTripSource {
  routeId: string
  organizationId: string
  /** Обновлять строки RouteStage, которых ещё нет */
  ensureStages?: boolean
  /** Возврат на базу в конце рейса (по умолчанию — из настроек организации) */
  returnToBase?: boolean
}

interface LoadedRoute {
  route: {
    id: string
    status: string
    driverId: string | null
    vehicleId: string | null
    startedAt: Date | null
  }
  orders: Array<{
    id: string
    routeFrom: string
    routeTo: string
    routeSequence: number | null
    distance: number
    status: string
    createdAt: Date
  }>
  vehicle: VehicleInput | null
  settings: {
    baseLat: number | null
    baseLng: number | null
    baseAddress: string | null
    restDriveLimitMin: number
    restMinBreakMin: number
  }
  stages: Array<{
    id: string
    orderId: string | null
    type: string
    sequence: number | null
    startedAt: Date | null
    endedAt: Date | null
  }>
}

/** Вид RouteStage.type → вид остановки движка. */
const STAGE_TYPE_TO_STOP: Record<string, StopRequest["kind"]> = {
  loading: "loading",
  unloading: "unloading",
  rest: "other",
  other: "other",
}

/** Обратное соответствие: вид остановки → RouteStage.type. */
const STOP_TO_STAGE_TYPE: Record<StopRequest["kind"], string> = {
  loading: "loading",
  unloading: "unloading",
  documents: "other",
  waiting: "other",
  extra_point: "other",
  other: "other",
}

/** Загружает рейс и всё, что нужно для прогноза. Только в рамках организации. */
async function loadRoute(source: RouteTripSource): Promise<LoadedRoute | null> {
  const route = await prisma.route.findFirst({
    where: { id: source.routeId, organizationId: source.organizationId },
    select: {
      id: true,
      status: true,
      driverId: true,
      vehicleId: true,
      startedAt: true,
      orders: {
        select: {
          id: true,
          routeFrom: true,
          routeTo: true,
          routeSequence: true,
          distance: true,
          status: true,
          createdAt: true,
        },
        orderBy: [{ routeSequence: "asc" }, { createdAt: "asc" }],
        take: MAX_ROUTE_ORDERS,
      },
      vehicle: {
        select: {
          type: true,
          capacity: true,
          volume: true,
          length: true,
          width: true,
          height: true,
        },
      },
    },
  })

  if (!route) return null

  const settings = await prisma.fleetSettings.findFirst({
    where: { organizationId: source.organizationId },
    select: {
      baseLat: true,
      baseLng: true,
      baseAddress: true,
      restDriveLimitMin: true,
      restMinBreakMin: true,
    },
  })

  const stages = await prisma.routeStage.findMany({
    where: { routeId: source.routeId, organizationId: source.organizationId },
    select: {
      id: true,
      orderId: true,
      type: true,
      sequence: true,
      startedAt: true,
      endedAt: true,
    },
    orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
  })

  return {
    route: {
      id: route.id,
      status: route.status,
      driverId: route.driverId,
      vehicleId: route.vehicleId,
      startedAt: route.startedAt,
    },
    orders: route.orders,
    vehicle: route.vehicle
      ? {
          type: route.vehicle.type ?? undefined,
          capacity: route.vehicle.capacity ?? undefined,
          volume: route.vehicle.volume ?? undefined,
          length: route.vehicle.length ?? undefined,
          width: route.vehicle.width ?? undefined,
          height: route.vehicle.height ?? undefined,
        }
      : null,
    settings: {
      baseLat: settings?.baseLat ?? null,
      baseLng: settings?.baseLng ?? null,
      baseAddress: settings?.baseAddress ?? null,
      restDriveLimitMin: settings?.restDriveLimitMin ?? 270,
      restMinBreakMin: settings?.restMinBreakMin ?? 45,
    },
    stages,
  }
}

/** Координаты точек рейса: кэш GeoCache + геокодер (Nominatim), с паузами. */
async function resolvePoints(
  loaded: LoadedRoute,
): Promise<{ byOrder: Map<string, { from?: Coordinates; to?: Coordinates }>; origin?: Coordinates }> {
  const names: string[] = []
  for (const order of loaded.orders) {
    names.push(order.routeFrom, order.routeTo)
  }

  const { coords } = await geocodeAddressesWithSource(names)

  const byOrder = new Map<string, { from?: Coordinates; to?: Coordinates }>()
  for (const order of loaded.orders) {
    byOrder.set(order.id, {
      from: coords.get(order.routeFrom.trim()) ?? undefined,
      to: coords.get(order.routeTo.trim()) ?? undefined,
    })
  }

  let origin: Coordinates | undefined
  if (loaded.settings.baseLat != null && loaded.settings.baseLng != null) {
    origin = { lat: loaded.settings.baseLat, lng: loaded.settings.baseLng }
  }

  return { byOrder, origin }
}

/** Фактические времена этапов из RouteStage. */
function actualsFromStages(
  loaded: LoadedRoute,
): Map<string, { startAt?: Date | null; endAt?: Date | null }> {
  const map = new Map<string, { startAt?: Date | null; endAt?: Date | null }>()

  for (const stage of loaded.stages) {
    if (!stage.orderId) continue
    const stopKind = STAGE_TYPE_TO_STOP[stage.type] ?? "other"
    const key = `${stage.orderId}:${stopKind}`
    const existing = map.get(key)
    // Берём самое раннее начало и самое позднее окончание: этап мог быть
    // прерван и возобновлён, и длительность не должна потеряться.
    map.set(key, {
      startAt: existing?.startAt && stage.startedAt
        ? new Date(Math.min(existing.startAt.getTime(), stage.startedAt.getTime()))
        : (stage.startedAt ?? existing?.startAt ?? null),
      endAt: existing?.endAt && stage.endedAt
        ? new Date(Math.max(existing.endAt.getTime(), stage.endedAt.getTime()))
        : (stage.endedAt ?? existing?.endAt ?? null),
    })
  }

  return map
}

/**
 * Создаёт отсутствующие строки RouteStage для рейса.
 *
 * Идемпотентно: существующие этапы не перезаписываются, поэтому повторный
 * вызов ничего не ломает и не дублирует операции. Расхождение в количестве
 * этапов (заказы добавили) тоже обрабатывается — доберём только новые.
 */
export async function ensureRouteStages(source: RouteTripSource): Promise<number> {
  const loaded = await loadRoute(source)
  if (!loaded) return 0

  const { byOrder } = await resolvePoints(loaded)
  const built = buildRouteStages(
    loaded.orders.map((order) => ({
      id: order.id,
      routeFrom: order.routeFrom,
      routeTo: order.routeTo,
      from: byOrder.get(order.id)?.from,
      to: byOrder.get(order.id)?.to,
      routeSequence: order.routeSequence,
    })),
    {},
  )

  const existing = new Set(
    loaded.stages.map((stage) => `${stage.type}:${stage.orderId ?? "route"}:${stage.sequence ?? 0}`),
  )

  let created = 0
  for (const stage of built) {
    if (existing.has(routeStageKey(stage))) continue

    await prisma.routeStage.create({
      data: {
        organizationId: source.organizationId,
        routeId: source.routeId,
        orderId: stage.orderId ?? null,
        type: routeStageType(stage),
        status: "planned",
        sequence: stage.sequence,
      },
    })
    created += 1
  }

  return created
}

/** Вид этапа в модели RouteStage. */
function routeStageType(stage: TripStageInput): string {
  if (stage.kind === "driving") return "driving"
  if (stage.kind === "return_to_base") return "return_to_base"
  return STOP_TO_STAGE_TYPE[stage.stop?.kind ?? "other"]
}

/** Ключ этапа: по нему этап рейса сопоставляется со строкой RouteStage. */
function routeStageKey(stage: TripStageInput): string {
  return `${routeStageType(stage)}:${stage.orderId ?? "route"}:${stage.sequence}`
}

/**
 * Гарантирует наличие строк RouteStage и возвращает их id в ТОМ ЖЕ порядке,
 * что и этапы рейса (индекс этапа → id строки).
 *
 * Нужно, чтобы команда водителя («завершил погрузку») попала именно в тот
 * этап, который показан ему на экране, а не в похожий соседний.
 */
export async function listRouteStageIds(
  source: RouteTripSource,
): Promise<Array<string | null> | null> {
  const loaded = await loadRoute(source)
  if (!loaded) return null

  await ensureRouteStages(source)

  const rows = await prisma.routeStage.findMany({
    where: { routeId: source.routeId, organizationId: source.organizationId },
    select: { id: true, orderId: true, type: true, sequence: true, createdAt: true },
    orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
  })

  const { byOrder } = await resolvePoints(loaded)
  const built = buildRouteStages(
    loaded.orders.map((order) => ({
      id: order.id,
      routeFrom: order.routeFrom,
      routeTo: order.routeTo,
      from: byOrder.get(order.id)?.from,
      to: byOrder.get(order.id)?.to,
      routeSequence: order.routeSequence,
    })),
    {
      origin: originPoint(loaded),
      returnToBase: source.returnToBase === false ? null : originPoint(loaded),
    },
  )

  const byKey = new Map<string, string>()
  for (const row of rows) {
    byKey.set(`${row.type}:${row.orderId ?? "route"}:${row.sequence ?? 0}`, row.id)
  }

  return built.map((stage) => byKey.get(routeStageKey(stage)) ?? null)
}

/** Точка базы организации или null, если база не задана в настройках. */
function originPoint(loaded: LoadedRoute) {
  if (loaded.settings.baseLat == null || loaded.settings.baseLng == null) return null
  return {
    point: { lat: loaded.settings.baseLat, lng: loaded.settings.baseLng },
    address: loaded.settings.baseAddress ?? "база",
  }
}

/**
 * Прогноз по рейсу: единый механизм для кабинета водителя, карты логиста,
 * помощника сборки и оптимизатора.
 *
 * Возвращает null, если рейс не принадлежит организации — вызывающий код
 * обязан отдать 404, а не «пустой прогноз».
 */
export async function getRouteTripEta(source: RouteTripSource): Promise<TripEtaResult | null> {
  const loaded = await loadRoute(source)
  if (!loaded) return null

  if (source.ensureStages) {
    await ensureRouteStages(source)
  }

  const { byOrder, origin } = await resolvePoints(loaded)
  const actuals = actualsFromStages(loaded)

  const stages: TripStageInput[] = buildRouteStages(
    loaded.orders.map((order) => ({
      id: order.id,
      routeFrom: order.routeFrom,
      routeTo: order.routeTo,
      from: byOrder.get(order.id)?.from,
      to: byOrder.get(order.id)?.to,
      routeSequence: order.routeSequence,
    })),
    {
      origin: originPoint(loaded),
      returnToBase: source.returnToBase === false ? null : originPoint(loaded),
      actuals,
      // Расстояние плеча до точки назначения — из заказа: оно посчитано
      // системой при создании заказа и точнее прямой между координатами.
      stopDurations: undefined,
    },
  ).map((stage) => ({
    ...stage,
    // Расстояние плеча «погрузка → выгрузка» берём из заказа
    distanceM:
      stage.kind === "driving" && stage.orderId
        ? (loaded.orders.find((order) => order.id === stage.orderId)?.distance ?? 0) * 1000
        : null,
  }))

  const restRules: Partial<RestRules> = {
    maxDrivingMinutes: loaded.settings.restDriveLimitMin,
    breakMinutes: loaded.settings.restMinBreakMin,
    jurisdiction: "RU (настройки организации)",
  }

  const options: TripEtaOptions = {
    now: new Date(),
    vehicle: loaded.vehicle ?? undefined,
    restRules,
    // Ограничения маршрута в проекте не хранятся структурно (см. отчёт):
    // передаём пустой список, а не выдуманные.
    restrictions: [],
  }

  return calculateTripEta(stages, options)
}

/** Правила отдыха организации — для кабинета водителя и объяснений. */
export async function getRestRules(
  organizationId: string,
): Promise<Partial<RestRules>> {
  const settings = await prisma.fleetSettings.findFirst({
    where: { organizationId },
    select: { restDriveLimitMin: true, restMinBreakMin: true },
  })

  return {
    maxDrivingMinutes: settings?.restDriveLimitMin ?? 270,
    breakMinutes: settings?.restMinBreakMin ?? 45,
    jurisdiction: "RU (настройки организации)",
  }
}
