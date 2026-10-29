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
import { fetchOSRMRoute } from "./osrm-client"
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
    // Движение и возврат на базу: у заказа может быть несколько плеч, поэтому
    // в ключ входит номер этапа. Иначе отметка «начал движение» на втором
    // плече ушла бы на первое.
    if (stage.type === "driving" || stage.type === "return_to_base") {
      const key = `${stage.orderId ?? "route"}:driving:${stage.sequence ?? 0}`
      const existing = map.get(key)
      map.set(key, {
        startAt: existing?.startAt && stage.startedAt
          ? new Date(Math.min(existing.startAt.getTime(), stage.startedAt.getTime()))
          : (stage.startedAt ?? existing?.startAt ?? null),
        endAt: existing?.endAt && stage.endedAt
          ? new Date(Math.max(existing.endAt.getTime(), stage.endedAt.getTime()))
          : (stage.endedAt ?? existing?.endAt ?? null),
      })
      continue
    }

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

  const built = await buildStagesForRoute(loaded, source)

  const existing = new Set(loaded.stages.map(routeStageKey))

  const builtKeys = new Set(built.stages.map(routeStageKey))

  // Удаляем этапы, которых больше нет в модели рейса (например, после смены
  // состава заказов). ТОЛЬКО те, где нет фактических отметок: отметка
  // водителя — исторический факт, её нельзя удалять сверкой.
  const stale = loaded.stages.filter(
    (stage) =>
      !builtKeys.has(routeStageKey(stage)) &&
      stage.startedAt == null &&
      stage.endedAt == null,
  )
  if (stale.length > 0) {
    await prisma.routeStage.deleteMany({
      where: {
        routeId: source.routeId,
        organizationId: source.organizationId,
        id: { in: stale.map((stage) => stage.id) },
        startedAt: null,
        endedAt: null,
      },
    })
  }

  let created = 0
  for (const stage of built.stages) {
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

/**
 * Ключ фактических отметок этапа. Должен совпадать с тем, что пишет
 * actualsFromStages, иначе отметка водителя не попадёт в прогноз.
 */
function stageKey(stage: TripStageInput): string {
  if (stage.kind === "driving" || stage.kind === "return_to_base") {
    return `${stage.orderId ?? "route"}:driving:${stage.sequence}`
  }
  return `${stage.orderId ?? "route"}:${stage.stop?.kind ?? "other"}`
}

/** Вид этапа в модели RouteStage. */
function routeStageType(stage: TripStageInput): string {
  if (stage.kind === "driving") return "driving"
  if (stage.kind === "return_to_base") return "return_to_base"
  return STOP_TO_STAGE_TYPE[stage.stop?.kind ?? "other"]
}

/** Ключ этапа: по нему этап рейса сопоставляется со строкой RouteStage. */
function routeStageKey(stage: {
  type?: string
  kind?: TripStageInput["kind"]
  stop?: TripStageInput["stop"]
  orderId?: string | null
  sequence?: number | null
}): string {
  const type =
    stage.type ??
    (stage.kind === "driving"
      ? "driving"
      : stage.kind === "return_to_base"
        ? "return_to_base"
        : STOP_TO_STAGE_TYPE[stage.stop?.kind ?? "other"])
  return `${type}:${stage.orderId ?? "route"}:${stage.sequence ?? 0}`
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

  const built = await buildStagesForRoute(loaded, source)

  const byKey = new Map<string, string>()
  for (const row of rows) {
    byKey.set(`${row.type}:${row.orderId ?? "route"}:${row.sequence ?? 0}`, row.id)
  }

  return built.stages.map((stage) => byKey.get(routeStageKey(stage)) ?? null)
}

/**
 * Строит этапы рейса из заказов. ЕДИНАЯ точка для ensureRouteStages,
 * listRouteStageIds и getRouteTripEta: раньше ensure строил без базы и без
 * возврата на базу, поэтому этап «возвращение на базу» не имел строки
 * RouteStage — команда водителя на нём отвечала «Этап рейса не найден».
 */
async function buildStagesForRoute(loaded: LoadedRoute, source: RouteTripSource) {
  const { byOrder } = await resolvePoints(loaded)
  // Заказы, у которых не нашлись координаты: без них не строится ни один
  // этап, и движок должен сказать об этом прямо, перечислив адреса, а не
  // молча выбросить их из маршрута.
  const unlocatedOrders = loaded.orders
    .filter((order) => !byOrder.get(order.id)?.from || !byOrder.get(order.id)?.to)
    .map((order) => `${order.routeFrom} → ${order.routeTo}`)
  return { stages: buildRouteStages(
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
  ), unlocatedOrders }
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
 * Дорожные расстояния плеч рейса из OSRM: карта «индекс этапа → метры».
 *
 * Один запрос на весь рейс: начало первого плеча, конец последнего и начала
 * всех остальных плеч как путевые точки. Плечо i начинается в точке i,
 * поэтому в «путевые» идут начала ВСЕХ плеч, кроме первого.
 *
 * Ответ разбирается по плечам: если их число не совпало с числом этапов,
 * расстояния не применяются — лучше честная оценка по прямой, чем
 * расстояние чужого плеча.
 *
 * Любая ошибка (сеть, таймаут, пустой ответ) → null: вызывающий код
 * остаётся на прежней оценке, а движок помечает плечо приблизительным.
 */
async function osrmLegDistances(
  stages: readonly TripStageInput[],
): Promise<Map<number, number> | null> {
  const legIndexes: number[] = []
  const legPoints: Array<{ from: Coordinates; to: Coordinates }> = []

  stages.forEach((stage, index) => {
    if (stage.kind !== "driving" && stage.kind !== "return_to_base") return
    if (!stage.from || !stage.to) return
    legIndexes.push(index)
    legPoints.push({ from: stage.from, to: stage.to })
  })

  if (legPoints.length === 0) return null

  try {
    const osrm = await fetchOSRMRoute(
      legPoints[0].from,
      legPoints[legPoints.length - 1].to,
      legPoints.slice(1).map((leg) => ({ lat: leg.from.lat, lng: leg.from.lng })),
    )
    const osrmLegs = osrm.routes[0]?.legs ?? []
    if (osrmLegs.length !== legPoints.length) return null

    const distances = new Map<number, number>()
    legIndexes.forEach((stageIndex, legIndex) => {
      const distance = osrmLegs[legIndex]?.distance ?? 0
      // Нулевое расстояние не применяем: это ответ без данных по плечу
      if (distance > 0) distances.set(stageIndex, distance)
    })
    return distances.size > 0 ? distances : null
  } catch {
    // Маршрутизатор недоступен — оценка по прямой остаётся
    return null
  }
}

/**
 * Кэш прогноза рейса.
 *
 * Зачем: getRouteTripEta ходит в геокодер и в OSRM — это секунды сетевого
 * времени. Приложение водителя опрашивает /api/m/route каждые 30 секунд, и
 * каждый опрос заново геокодировал те же адреса: эндпоинт отвечал 7–12 с на
 * тёплом сервере. Приёмка это и показала.
 *
 * Портим кэш сразу, как только меняются отметки водителя: подпись считается по
 * фактическим временам этапов и статусам заказов. Пять минут — предел, после
 * которого прогноз пересчитывается в любом случае (время идёт).
 */
const TRIP_ETA_TTL_MS = 5 * 60_000
const TRIP_ETA_CACHE_LIMIT = 200
const tripEtaCache = new Map<string, { at: number; signature: string; value: TripEtaResult }>()

/** Подпись состояния рейса: всё, что влияет на прогноз. */
function tripEtaSignature(
  loaded: LoadedRoute,
  actuals: Map<string, { startAt?: Date | null; endAt?: Date | null }>,
): string {
  const stages = loaded.stages
    .map((stage) => `${stage.type}:${stage.orderId ?? "route"}:${stage.sequence ?? 0}`)
    .join(",")
  const marks = [...actuals.entries()]
    .map(([key, value]) => `${key}@${value.startAt?.getTime() ?? ""}-${value.endAt?.getTime() ?? ""}`)
    .sort()
    .join(";")
  const orders = loaded.orders.map((order) => `${order.id}:${order.status}`).sort().join(",")
  const vehicle = loaded.vehicle ? `${loaded.vehicle.type}:${loaded.vehicle.capacity}` : "-"
  return `${loaded.route.startedAt?.getTime() ?? ""}|${stages}|${marks}|${orders}|${vehicle}`
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

  const actuals = actualsFromStages(loaded)

  // Свежий прогноз при том же состоянии рейса — из памяти, без сети
  const signature = tripEtaSignature(loaded, actuals)
  const cached = tripEtaCache.get(source.routeId)
  if (cached && cached.signature === signature && Date.now() - cached.at < TRIP_ETA_TTL_MS) {
    return cached.value
  }

  const built = await buildStagesForRoute(loaded, source)
  const unlocatedOrders = built.unlocatedOrders
  const stages: TripStageInput[] = built.stages
    .map((stage) => ({
    ...stage,
    actualStartAt:
      actuals.get(stageKey(stage))?.startAt ?? stage.actualStartAt ?? null,
    actualEndAt: actuals.get(stageKey(stage))?.endAt ?? stage.actualEndAt ?? null,
  })).map((stage) => ({
    ...stage,
    // Расстояние берём из заказа ТОЛЬКО у плеча «погрузка → выгрузка»:
    // поле Order.distance считает именно его. Раньше оно проставлялось
    // каждому плечу заказа, и плечо ДО склада получало то же расстояние —
    // длина рейса удваивалась.
    distanceM:
      stage.kind === "driving" && stage.leg === "to_dropoff" && stage.orderId
        ? (loaded.orders.find((order) => order.id === stage.orderId)?.distance ?? 0) * 1000
        : null,
  }))

  // ── Дорожные расстояния плеч по OSRM ──
  //
  // Раньше движок рейса не обращался к маршрутизатору вовсе: плечо до
  // склада и возврат на базу считались по прямой ×1.3, а плечо
  // «погрузка → выгрузка» подставляло Order.distance — километры, которые
  // вносит логист вручную. Из-за этого прогноз водителя и оптимизатор
  // расходились на одном и том же рейсе, а «дорогие» км заказа выглядели
  // как измерение дороги.
  //
  // Теперь по цепочке плеч делается ОДИН запрос OSRM — тот же приём, что в
  // оптимизаторе (app/api/routes/optimizer/route.ts). Маршрутизатор
  // недоступен → остаётся прежняя оценка по прямой, и dataQuality честно
  // пишет, у скольких плеч расстояние приблизительное.
  const osrmDistances = await osrmLegDistances(stages)
  if (osrmDistances) {
    for (const [index, distanceM] of osrmDistances) {
      stages[index] = { ...stages[index], distanceM }
    }
  }

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
    // Источник расстояний плеч — только если маршрутизатор реально ответил
    routingSource: osrmDistances ? "osrm" : "fallback",
    unlocatedOrders,
    totalOrders: loaded.orders.length,
  }

  const result = calculateTripEta(stages, options)

  if (tripEtaCache.size >= TRIP_ETA_CACHE_LIMIT) {
    // Простейшая уборка: удаляем самый старый прогноз
    const oldest = [...tripEtaCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) tripEtaCache.delete(oldest[0])
  }
  tripEtaCache.set(source.routeId, { at: Date.now(), signature, value: result })

  return result
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
