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
  orderFromAtiRow,
  orderFromOrderRow,
  readiness,
  regionsFromRows,
  settingsFromOrg,
  vehicleFromRow,
  type AtiLoadRow,
  type FleetSettingsRow,
  type OrderRow,
  type Readiness,
  type VehicleRow,
} from "./adapter"
import { planFleet, type FleetPlan, type PlanInput } from "./index"
import { loadPlaces as loadPlacesGeo, regionOfCity as regionOfCityFromSource, type GeoSource } from "./geo/places"
import type { DistanceCacheStore } from "./distance"
import { cityLookupKey, parseAddress } from "./geo/address"
import type { LoadOrder, Place, Vehicle } from "./types"
import { rateStatus } from "@/lib/pricing/status"
import { quoteMany } from "@/lib/pricing/service"

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
    /**
     * Грузы, по которым нет ни цены, ни оценки: они не пошли в расчёт.
     * Отдельным списком — чтобы логист видел, что делать (звонить), а не
     * только «грузов нет».
     */
    unpriced: Array<{ id: string; status: string; reason: string }>
    /** Города, координаты которых пришлось получить в этом расчёте */
    geocoded: string[]
    vehicles: number
    horizonHours: number
    now: string
    elapsedMs: number
  }
}

/**
 * Координаты и регионы мест пула.
 *
 * Порядок источников зафиксирован в `geo/places.ts`:
 *   1. справочник ATI (AtiCity) — 128 079 пунктов с регионом;
 *   2. GeoCache — только записи со статусом `verified`;
 *   3. геокодер — только по явному разрешению вызывающего.
 *
 * Что изменилось: раньше город искался ТОЧНЫМ совпадением всей строки
 * («Ярославль, Ярославская область» против «Ярославль» в справочнике), поэтому
 * справочник не находился почти никогда и всё зависело от геокодера. Замер: из
 * 671 уникального места пула без сети не разрешалось 518.
 *
 * Сеть в этом расчёте по умолчанию НЕ вызывается: планировщик не должен ни
 * ждать геокодер, ни писать в общий кэш во время чтения (прежняя версия делала
 * и то, и другое: до 12 запросов с паузой в секунду и upsert в GeoCache).
 */
const MAX_GEOCODE_CITIES = 12

/**
 * Источник данных для geo/places.ts — обёртка над Prisma.
 *
 * Поиск идёт по `AtiCity.nameKey` — ключу названия без типа, района, регистра и
 * ё. Искать по `name` целиком нельзя: в справочнике лежит «Энгельс,
 * Саратовская область», а в грузе — «Энгельс», и точное совпадение не
 * срабатывало никогда. Ключ считается той же функцией, что и в расчёте, поэтому
 * база и память дают одинаковое разбиение.
 */
const geoSource: GeoSource = {
  cities: async (names) => {
    const keys = [...new Set(names.map((name) => cityLookupKey(name)).filter(Boolean))]
    if (keys.length === 0) return []
    return prisma.atiCity.findMany({
      where: { nameKey: { in: keys } },
      select: { name: true, region: true, lat: true, lon: true },
    })
  },
  cache: async (addresses) => {
    const unique = [
      ...new Set(addresses.map((address) => address.trim().toLowerCase()).filter(Boolean)),
    ]
    if (unique.length === 0) return []
    return prisma.geoCache.findMany({
      where: { address: { in: unique } },
      select: { address: true, lat: true, lng: true, region: true, status: true },
    })
  },
}

/**
 * Геокодер как последний источник. Включается флагом, а не по умолчанию.
 *
 * Ответ сохраняется со статусом `unverified`: он ещё не проверен по региону, а
 * значит для маршрута не годится (именно так в кэш когда-то попало Шарапово из
 * Тверской области). Проверенные точки ставит человек или сверка со
 * справочником (`scripts/verify-geocache.mjs`).
 */
async function geocodeMissingPlaces(
  cities: string[],
): Promise<Map<string, { lat: number; lng: number }>> {
  const result = new Map<string, { lat: number; lng: number }>()
  try {
    const found = await geocodeAddresses(cities)
    for (const [city, point] of found) {
      if (!point) continue
      result.set(city, point)
      try {
        await prisma.geoCache.upsert({
          where: { address: city.trim().toLowerCase() },
          create: {
            address: city.trim().toLowerCase(),
            lat: point.lat,
            lng: point.lng,
            source: "geocoder",
            status: "unverified",
            checkedAt: new Date(),
          },
          update: { lat: point.lat, lng: point.lng, checkedAt: new Date() },
        })
      } catch {
        // кэш не критичен: координаты уже получены
      }
    }
  } catch {
    // геокодер недоступен — места останутся без координат, и это будет сказано
  }
  return result
}

/**
 * Регион населённого пункта по справочнику — для базы организации.
 *
 * Само правило живёт в geo/places.ts (regionOfCity), здесь только источник
 * данных: одна и та же логика должна работать и в расчёте, и в проверках.
 */
async function regionOfCity(city: string | null): Promise<string | null> {
  try {
    return await regionOfCityFromSource(geoSource, city)
  } catch {
    return null
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
  /** По каждой неразрешённой строке — статус и причина словами */
  unresolved: Array<{ raw: string; status: string; note: string | null }>
  /** Откуда взялись точки: справочник / кэш / геокодер / нет */
  geoStats: {
    total: number
    fromReference: number
    fromCache: number
    fromGeocoder: number
    ambiguous: number
    noCoordinates: number
    missing: number
  }
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
  preferredRegion: string | null,
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

  const located = await loadPlacesGeo(cities, geoSource, {
    geocode: geocodeMissing ? (batch) => geocodeMissingPlaces(batch) : undefined,
    geocodeLimit: MAX_GEOCODE_CITIES,
    preferredRegion,
  })
  const places = located.places
  const unresolved = located.unresolved

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
    missingCoordinates: unresolved.map((item) => item.raw),
    unresolved,
    geoStats: located.stats,
  }
}

/**
 * Точки входа маршрутизатора, которые подключаются БЕЗ настройки.
 *
 * Решение: если своего OSRM не задано, километры берутся у публичного демо-
 * сервера OSM. Почему не «оставить оценку»: замер на 10 парах
 * (`scripts/router-compare.mjs`) показал, что «прямая × 1,2» ошибается от −30 %
 * (Краснодар → Сочи, горный серпантин) до +13 % (Ярославль → Москва), а
 * экономика рейса считается именно по километрам.
 *
 * Платные сервисы сюда не подставляются НИКОГДА: их включает владелец явно
 * (`OSRM_FALLBACK_URLS`), потому что это его деньги.
 *
 * Отключить публичный источник можно одной переменной: `OSRM_PUBLIC=off`.
 */
function routerFallbacks(): Array<{ name: string; url: string }> {
  const endpoints: Array<{ name: string; url: string }> = []
  const configured = (process.env.OSRM_FALLBACK_URLS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  for (const [index, url] of configured.entries()) {
    endpoints.push({ name: `osrm-fallback-${index + 1}`, url })
  }
  const allowPublic = (process.env.OSRM_PUBLIC ?? "on").toLowerCase() !== "off"
  if (allowPublic && !process.env.OSRM_URL) {
    endpoints.push({ name: "osrm-public", url: "https://router.project-osrm.org" })
  }
  return endpoints
}

/**
 * Постоянный кэш расстояний в базе.
 *
 * Источник и дата измерения хранятся вместе с километрами: без них нельзя
 * отличить измерение от догадки, а ТЗ требует именно этого.
 */
const distanceStore: DistanceCacheStore = {
  load: async (keys) => {
    if (keys.length === 0) return []
    const rows = await prisma.routeDistance.findMany({
      where: {
        OR: keys.map((key) => ({ fromId: key.from, toId: key.to, mode: key.mode })),
      },
      select: { fromId: true, toId: true, mode: true, km: true, source: true, provider: true, measuredAt: true },
    })
    return rows.map((row) => ({
      from: row.fromId,
      to: row.toId,
      mode: row.mode,
      km: row.km,
      source: row.source,
      provider: row.provider,
      measuredAt: row.measuredAt,
    }))
  },
  save: async (rows) => {
    if (rows.length === 0) return
    // Пакетная запись «вставить или обновить»: один запрос на пачку вместо
    // upsert на каждую пару (их бывают сотни).
    const values = rows.map((row) => [
      row.from,
      row.to,
      row.mode,
      row.km,
      row.source,
      row.provider,
      row.measuredAt.toISOString(),
    ])
    try {
      await prisma.$executeRaw`
        INSERT INTO "RouteDistance" ("id", "fromId", "toId", "mode", "km", "source", "provider", "measuredAt")
        SELECT gen_random_uuid()::text, v."fromId", v."toId", v."mode", v.km, v.source, v.provider, v."measuredAt"::timestamptz
        FROM unnest(
          ${values.map((row) => row[0])}::text[],
          ${values.map((row) => row[1])}::text[],
          ${values.map((row) => row[2])}::text[],
          ${values.map((row) => row[3])}::float8[],
          ${values.map((row) => row[4])}::text[],
          ${values.map((row) => row[5])}::text[],
          ${values.map((row) => row[6])}::text[]
        ) AS v("fromId", "toId", "mode", km, source, provider, "measuredAt")
        ON CONFLICT ("fromId", "toId", "mode") DO UPDATE
          SET km = EXCLUDED.km, provider = EXCLUDED.provider, "measuredAt" = EXCLUDED."measuredAt"
      `
    } catch {
      // Кэш не критичен: расстояния этого расчёта уже в памяти.
    }
  },
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
  const settingsRow = settingsRowRaw as FleetSettingsRow | null
  // Регион базы: карточка организации → справочник ATI по городу из адреса.
  // Без региона не определяется часовой пояс базы, а вместе с ним все окна.
  let baseRegionHint: string | null = null
  if (settingsRow && !settingsRow.baseRegion) {
    baseRegionHint = await regionOfCity(parseAddress(settingsRow.baseAddress).city)
  }
  const base = baseFromSettings(settingsRow, { region: baseRegionHint })

  const pool = await loadPool(
    input.organisationId,
    source,
    horizonHours,
    now,
    input.geocodeMissing ?? false,
    baseRegionHint,
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

  // Цена: где её нет в источнике — считаем ориентир по аналогам и кладём в
  // заказ со статусом ESTIMATED. Дальше сборщик работает с этой суммой как с
  // ожиданием: доход рейса делится на подтверждённый и расчётный, и рейс с
  // расчётной ценой прибыльным не объявляется.
  //
  // Оценка НЕ подменяет исходное значение: rate.raw остаётся тем, что пришло
  // из ATI, а rate.estimate — расчёт с диапазоном и уверенностью.
  const quoteTargets = usableOrders.filter((order) => rateStatus(order.rate) !== "CONFIRMED")
  let ordersWithPrices = usableOrders
  if (quoteTargets.length > 0) {
    const quotes = await quoteMany(
      input.organisationId,
      quoteTargets.map((order) => ({
        refKind: "ati" as const,
        refId: order.id,
        fromCity: order.pickup.city,
        toCity: order.delivery.city,
        km: order.exchangeKm ?? null,
        weightKg: order.weightKg,
        volumeM3: order.volumeM3,
        bodyType: order.bodyRequired?.[0] ?? null,
        temperature: null,
        date: new Date(order.window.pickup.from ?? now),
      })),
      { persist: false },
    )
    ordersWithPrices = usableOrders.map((order) => {
      const quote = quotes.get(order.id)
      if (quote && quote.ok) {
        return {
          ...order,
          rate: {
            ...order.rate,
            amount: quote.estimate.amountRub,
            status: "ESTIMATED" as const,
            estimate: quote.estimate,
          },
        }
      }
      return order
    })
  }

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
    orders: ordersWithPrices,
    orderProblems,
  })

  const summary = {
    ordersInPool: pool.orders.length + pool.skipped.length,
    ordersUsable: usableOrders.length,
    ordersExcluded: pool.orders.length - usableOrders.length,
    skipped: pool.skipped.filter((item) => item.problems.length > 0),
    unpriced: [] as Array<{ id: string; status: string; reason: string }>,
    geocoded: pool.geocoded,
    geoStats: pool.geoStats,
    vehicles: vehicles.length,
    horizonHours,
    now: now.toISOString(),
    elapsedMs: 0,
    /** Куда ходили за километрами и сколько участков осталось оценкой */
    router: null as null | {
      providers: Array<{ name: string; requests: number; failures: number }>
      measuredSegments: number
      estimatedSegments: number
    },
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
    orders: ordersWithPrices.slice(0, input.poolLimit ?? 120),
    vehicles,
    settings,
    regions,
    now,
    osrmUrl: process.env.OSRM_URL ?? null,
    fallbackEndpoints: routerFallbacks(),
    store: distanceStore,
    requestBudget: Number(process.env.OSRM_REQUEST_BUDGET ?? 200) || 200,
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

  // Куда ходили за километрами — в сводку, а не только в логи: экран обязан
  // сказать, измерены плечи или оценены.
  const perVehicle = plan.perVehicle.map((item) => item.recommended).filter(Boolean)
  if (perVehicle.length > 0) {
    const merged = new Map<string, { name: string; requests: number; failures: number }>()
    let measured = 0
    let estimated = 0
    for (const vehiclePlan of plan.perVehicle) {
      const router = vehiclePlan.stats?.router
      if (!router) continue
      measured += router.measuredSegments
      estimated += router.estimatedSegments
      for (const provider of router.providers) {
        const existing = merged.get(provider.name)
        if (existing) {
          existing.requests += provider.requests
          existing.failures += provider.failures
        } else {
          merged.set(provider.name, { ...provider })
        }
      }
    }
    summary.router = {
      providers: [...merged.values()],
      measuredSegments: measured,
      estimatedSegments: estimated,
    }
  }

  // Грузы без цены: собрать их по машинам в один список — одно и то же
  // сообщение на каждую машину логисту не нужно.
  const unpricedById = new Map<string, { id: string; status: string; reason: string }>()
  for (const vehiclePlan of plan.perVehicle) {
    for (const item of vehiclePlan.unpriced ?? []) {
      if (!unpricedById.has(item.orderId)) {
        unpricedById.set(item.orderId, { id: item.orderId, status: item.status, reason: item.reason })
      }
    }
  }
  summary.unpriced = [...unpricedById.values()]

  summary.elapsedMs = Date.now() - startedAt
  return { readiness: check, plan, summary }
}
