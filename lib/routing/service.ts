// lib/routing/service.ts
//
// Серверный слой: собрать данные организации и посчитать план.
//
// Здесь — единственное место, где ядро встречается с базой. Всё остальное
// (lib/routing/types.ts … builder.ts) чистые функции, поэтому расчёт можно
// повторить в тестах без базы и получить тот же ответ.
//
// Правила:
//   · организация берётся из проверенной сессии, а не из тела запроса;
//   · координаты городов — из общего справочника (ATI/геокодер), отсутствие
//     координат не заменяется «нулём», а попадает в причины;
//   · расчёт идёт на сервере: экран только показывает результат.

import { prisma } from "@/lib/prisma"
import { scopedWhere } from "@/lib/org"
import { geocodeAddresses } from "@/lib/geo/geocode"

import {
  baseFromSettings,
  cityKey,
  orderFromAtiRow,
  orderFromOrderRow,
  placeFromCity,
  readiness,
  regionsFromRows,
  settingsFromOrg,
  vehicleFromRow,
  type AtiLoadRow,
  type CityRow,
  type FleetSettingsRow,
  type OrderRow,
  type Readiness,
  type VehicleRow,
} from "./adapter"
import { planFleet, type FleetPlan, type PlanInput } from "./index"
import type { LoadOrder, Place, Vehicle } from "./types"

export interface OptimizerInput {
  organisationId: string
  /** Сколько грузов максимум брать из накопительной базы */
  poolLimit?: number
  /** Горизонт планирования, часы */
  horizonHours?: number
  /** Текущий момент; по умолчанию системный */
  now?: Date
  /** Источник пула: накопительная база ATI, взятые в работу заказы, оба */
  source?: "ati" | "orders" | "both"
  /**
   * Дозаполнить координаты городов геокодером (с постоянным кэшем).
   * По умолчанию да: без координат маршрут не построить. Но не больше
   * MAX_GEOCODE_CITIES адресов за расчёт — планировщик не должен висеть.
   */
  geocodeMissing?: boolean
  /**
   * Грузы, которые логист снял с рассмотрения (отказ фрахтователя, уже в
   * работе, скрытые). Это фильтр ПО СВОИМ данным организации: чужие грузы
   * сюда не подсунуть — пул всё равно берётся только по организации.
   */
  excludeIds?: string[]
  /**
   * Грузы, по которым логист уже договорился: они не должны исчезнуть при
   * пересборке. Ядро не умеет «обязательных», поэтому если такой груз не
   * вошёл в план — это честно сказано в предупреждениях, а не спрятано.
   */
  keepIds?: string[]
  /** Считать только под эту машину (выбор логиста). Чужая машина игнорируется. */
  vehicleId?: string
}

export interface OptimizerOutput {
  readiness: Readiness
  plan: FleetPlan | null
  /** Что именно посчитано: сколько грузов, машин, за какой горизонт */
  summary: {
    ordersInPool: number
    ordersUsable: number
    /** Сколько грузов логист снял с рассмотрения в этом расчёте */
    ordersExcluded: number
    skipped: Array<{ id: string; problems: string[] }>
    /** Города, координаты которых пришлось получить в этом расчёте */
    geocoded: string[]
    vehicles: number
    horizonHours: number
    now: string
    elapsedMs: number
  }
}

/**
 * Координаты и регионы городов.
 *
 * Источник — справочник городов ATI (AtiCity: имя, регион, координаты) и кэш
 * геокодера (GeoCache). Сеть здесь не вызывается: планировщик не должен ждать
 * геокодер. Чего нет в справочнике — то честно отсутствует и попадает в
 * причины отказа, а недостающие города можно дозаполнить геокодером отдельным
 * запросом (это делает существующий /api/ati/cities/points).
 */
const MAX_GEOCODE_CITIES = 12

async function loadPlaces(
  cities: string[],
  geocodeMissing: boolean,
): Promise<{ places: Map<string, Place>; geocoded: string[]; stillMissing: string[] }> {
  const out = new Map<string, Place>()
  const geocoded: string[] = []
  if (cities.length === 0) return { places: out, geocoded, stillMissing: [] }

  const unique = [...new Set(cities.map((city) => city.trim()).filter(Boolean))]
  const byKey = new Map<string, string>()
  for (const city of unique) byKey.set(cityKey(city), city)

  // Справочник ATI: города с координатами.
  try {
    const rows = await prisma.atiCity.findMany({
      where: { name: { in: unique } },
      select: { name: true, region: true, lat: true, lon: true },
    })
    for (const row of rows) {
      const place = placeFromCity({
        city: row.name,
        region: row.region,
        lat: row.lat,
        lng: row.lon,
      })
      if (place) out.set(cityKey(row.name), place)
    }
  } catch {
    // Справочник может быть не наполнен — работаем с тем, что есть.
  }

  // Геокэш: адрес → координаты (общий справочник, не данные организации).
  const missing = unique.filter((city) => !out.has(cityKey(city)))
  if (missing.length > 0) {
    try {
      const geo = await prisma.geoCache.findMany({
        where: { address: { in: missing.map((city) => city.toLowerCase()) } },
        select: { address: true, lat: true, lng: true },
      })
      for (const row of geo) {
        const key = cityKey(row.address)
        if (out.has(key)) continue
        // Регион у геокэша не хранится: он неизвестен, и это честно.
        out.set(
          key,
          placeFromCity({ city: byKey.get(key) ?? row.address, region: null, lat: row.lat, lng: row.lng })!,
        )
      }
    } catch {
      // Нет кэша — не беда: города просто останутся без координат.
    }
  }

  // Дозаполнение геокодером: города, которых нет ни в справочнике, ни в кэше.
  // Ответ кладётся в общий GeoCache силами самого геокодера — повторный расчёт
  // сети уже не требует.
  const stillMissing = unique.filter((city) => !out.has(cityKey(city)))
  if (geocodeMissing && stillMissing.length > 0) {
    const batch = stillMissing.slice(0, MAX_GEOCODE_CITIES)
    try {
      const coords = await geocodeAddresses(batch)
      for (const city of batch) {
        const point = coords.get(city)
        if (!point) continue
        const place = placeFromCity({ city, region: null, lat: point.lat, lng: point.lng })
        if (!place) continue
        out.set(cityKey(city), place)
        geocoded.push(city)
      }
    } catch {
      // Геокодер недоступен — города останутся без координат, и это будет
      // сказано в причинах, а не спрятано.
    }
  }

  return {
    places: out,
    geocoded,
    stillMissing: unique.filter((city) => !out.has(cityKey(city))),
  }
}

/** Машины организации, кроме архивных и тех, что в ремонте. */
async function loadVehicles(
  organisationId: string,
  base: Place,
  settingsRow: FleetSettingsRow | null,
): Promise<Vehicle[]> {
  const rows = await prisma.vehicle.findMany({
    where: { ...scopedWhere(organisationId), archivedAt: null, status: { not: "maintenance" } },
    select: {
      id: true,
      organizationId: true,
      plate: true,
      type: true,
      capacity: true,
      volume: true,
      fuelConsumptionPer100: true,
      operatingCostPerKm: true,
      status: true,
    },
  })
  return rows
    .filter((row) => row.organizationId)
    .map((row) =>
      vehicleFromRow(
        {
          id: row.id,
          organisationId: row.organizationId as string,
          plate: row.plate,
          type: row.type,
          capacity: row.capacity,
          volume: row.volume,
          fuelConsumptionPer100: row.fuelConsumptionPer100,
          operatingCostPerKm: row.operatingCostPerKm,
          status: row.status,
        },
        // У машины своей базы в базе нет — маршрут начинается от базы
        // организации. Это ограничение схемы, а не ядра: контракт Vehicle
        // поддерживает отдельную базу, и когда она появится в карточке,
        // изменится только эта строка.
        base,
        settingsRow,
        base.region,
      ),
    )
}

interface LoadedPool {
  orders: LoadOrder[]
  skipped: Array<{ id: string; problems: string[] }>
  cities: string[]
  /** Какие города пришлось геокодировать в этом расчёте */
  geocoded: string[]
  /** Для каких городов координат так и нет — из-за них грузы отброшены */
  missingCoordinates: string[]
}

/**
 * Пул грузов организации: накопительная база ATI и/или взятые в работу заказы.
 * Только «свежие»: просроченные по дате загрузки не предлагаются.
 */
async function loadPool(
  organisationId: string,
  source: NonNullable<OptimizerInput["source"]>,
  horizonHours: number,
  now: Date,
  geocodeMissing: boolean,
): Promise<LoadedPool> {
  const orders: LoadOrder[] = []
  const skipped: Array<{ id: string; problems: string[] }> = []
  const cities: string[] = []
  const horizonEnd = new Date(now.getTime() + horizonHours * 3600000)

  let atiRows: Array<{
    atiLoadId: string
    organizationId: string | null
    routeFrom: string
    routeTo: string
    distance: number | null
    weight: number | null
    volume: number | null
    truckType: string | null
    price: number | null
    priceType: string | null
    loadingDate: Date | null
    unloadingDate: Date | null
  }> = []
  let orderRows: Array<{
    id: string
    organizationId: string | null
    routeFrom: string
    routeTo: string
    distance: number
    weight: number
    volume: number | null
    price: number | null
    agreedPrice: number | null
    loadingType: string | null
    deadline: Date | null
  }> = []

  if (source === "ati" || source === "both") {
    atiRows = await prisma.atiCache.findMany({
      where: {
        ...scopedWhere(organisationId),
        status: { notIn: ["rejected", "taken", "expired"] },
        OR: [{ loadingDate: null }, { loadingDate: { lte: horizonEnd } }],
      },
      orderBy: { scannedAt: "desc" },
      take: 400,
      select: {
        atiLoadId: true,
        organizationId: true,
        routeFrom: true,
        routeTo: true,
        distance: true,
        weight: true,
        volume: true,
        truckType: true,
        price: true,
        priceType: true,
        loadingDate: true,
        unloadingDate: true,
      },
    })
    for (const row of atiRows) cities.push(row.routeFrom, row.routeTo)
  }

  if (source === "orders" || source === "both") {
    orderRows = await prisma.order.findMany({
      where: {
        ...scopedWhere(organisationId),
        archivedAt: null,
        routeId: null,
        status: { notIn: ["delivered", "cancelled", "rejected", "expired"] },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        organizationId: true,
        routeFrom: true,
        routeTo: true,
        distance: true,
        weight: true,
        volume: true,
        price: true,
        agreedPrice: true,
        loadingType: true,
        deadline: true,
      },
    })
    for (const row of orderRows) cities.push(row.routeFrom, row.routeTo)
  }

  const located = await loadPlaces(cities, geocodeMissing)
  const places = located.places

  const problemsOf: Array<{ id: string; problems: string[] }> = []
  for (const row of atiRows) {
    if (!row.organizationId) continue
    const built = orderFromAtiRow(
      { ...row, organisationId: row.organizationId } as AtiLoadRow,
      places,
    )
    if (built.order) orders.push(built.order)
    else problemsOf.push({ id: row.atiLoadId, problems: built.problems })
  }
  for (const row of orderRows) {
    const built = orderFromOrderRow(
      { ...row, organisationId: row.organizationId } as OrderRow,
      places,
      organisationId,
    )
    if (built.order) orders.push(built.order)
    else problemsOf.push({ id: row.id, problems: built.problems })
  }

  return {
    orders,
    skipped: problemsOf,
    cities,
    geocoded: located.geocoded,
    missingCoordinates: located.stillMissing,
  }
}

/**
 * Посчитать план для организации.
 *
 * Возвращает либо готовый план, либо причины, по которым его нельзя построить.
 * Пустой план без объяснения не возвращается никогда.
 */
export async function planForOrganisation(input: OptimizerInput): Promise<OptimizerOutput> {
  const startedAt = Date.now()
  const now = input.now ?? new Date()
  const horizonHours = input.horizonHours ?? 72
  const source = input.source ?? "both"

  const settingsRowRaw = await prisma.fleetSettings.findFirst({
    where: scopedWhere(input.organisationId),
  })
  const base = baseFromSettings(settingsRowRaw as FleetSettingsRow | null)
  const settingsRow = settingsRowRaw as FleetSettingsRow | null

  const pool = await loadPool(
    input.organisationId,
    source,
    horizonHours,
    now,
    input.geocodeMissing ?? true,
  )
  let vehicles = base ? await loadVehicles(input.organisationId, base, settingsRow) : []
  if (input.vehicleId) {
    const chosen = vehicles.filter((vehicle) => vehicle.id === input.vehicleId)
    // Чужой или неизвестный идентификатор — не повод молча считать весь парк.
    if (chosen.length > 0) vehicles = chosen
  }

  const excludeIds = new Set((input.excludeIds ?? []).filter((id) => typeof id === "string"))
  const keepIds = new Set((input.keepIds ?? []).filter((id) => typeof id === "string"))
  const usableOrders = excludeIds.size > 0 ? pool.orders.filter((order) => !excludeIds.has(order.id)) : pool.orders

  const orderProblems = pool.skipped.flatMap((item) => item.problems)
  if (pool.missingCoordinates.length > 0) {
    orderProblems.push(
      `координаты не найдены: ${pool.missingCoordinates.slice(0, 5).join(", ")}` +
        (pool.missingCoordinates.length > 5 ? ` и ещё ${pool.missingCoordinates.length - 5}` : ""),
    )
  }
  const check = readiness({
    base,
    vehicles,
    orders: usableOrders,
    orderProblems,
  })

  const summary = {
    ordersInPool: pool.orders.length + pool.skipped.length,
    ordersUsable: usableOrders.length,
    ordersExcluded: pool.orders.length - usableOrders.length,
    skipped: pool.skipped.filter((item) => item.problems.length > 0),
    geocoded: pool.geocoded,
    vehicles: vehicles.length,
    horizonHours,
    now: now.toISOString(),
    elapsedMs: 0,
  }

  if (!check.ok || !base) {
    return { readiness: check, plan: null, summary: { ...summary, elapsedMs: Date.now() - startedAt } }
  }

  const settings = settingsFromOrg(settingsRow)
  const regions = regionsFromRows([
    base.region,
    ...pool.orders.flatMap((order) => [order.pickup.region, order.delivery.region]),
  ])

  const planInput: PlanInput = {
    orders: usableOrders.slice(0, input.poolLimit ?? 120),
    vehicles,
    settings,
    regions,
    now,
    osrmUrl: process.env.OSRM_URL ?? null,
  }

  const plan = await planFleet(planInput)

  // Согласованные грузы. Ядро строит цепочки по выгоде и не знает, что логист
  // уже договорился по телефону. Поэтому после расчёта проверяем: если такой
  // груз не попал ни в один вариант — предупреждение с причиной отказа ядра.
  if (keepIds.size > 0) {
    for (const item of plan.perVehicle) {
      const used = new Set(item.variants.flatMap((variant) => variant.orderIds))
      for (const id of keepIds) {
        if (used.has(id)) continue
        const rejection = item.rejected.find((entry) => entry.orderId === id)
        const reason =
          rejection?.reason ??
          (usableOrders.some((order) => order.id === id) ? "в пул не попадает" : "заказа нет в пуле организации")
        const text = `согласованный груз ${id} не вошёл в цепочку: ${reason}`
        if (!item.recommended) continue
        if (!item.recommended.warnings.includes(text)) item.recommended.warnings.push(text)
      }
    }
  }

  summary.elapsedMs = Date.now() - startedAt
  return { readiness: check, plan, summary }
}
