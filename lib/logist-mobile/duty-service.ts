// lib/logist-mobile/duty-service.ts
//
// Серверная часть дежурного: «пора ли смотреть», «посмотреть и запомнить»,
// «что показать на экране». Ядро расчётов — в duty.ts (чистый модуль), здесь
// только база и склейка с уже готовыми сборщиками пула и грузов.
//
// Главное отличие от ночной сводки: дежурный работает ПО ИНТЕРВАЛУ в рабочих
// часах организации. Грузы выкладывают в течение дня, у каждой компании свой
// график, а ночью новых почти нет — «сводка за ночь» показывала бы пустое утро.

import { prisma } from "@/lib/prisma"
import { mergeLoads } from "@/lib/logist-mobile/pool"
import type { BuilderLoad, BuilderVehicle, Point } from "@/lib/logist-mobile/route-builder"
import { DEFAULT_OPERATING_COST_PER_KM } from "@/lib/logist-mobile/route-builder"
import {
  buildDutyFeedDetailed,
  DUTY_FEED_LIMIT,
  dutyHeadline,
  dutyIsDue,
  normalizeDutySettings,
  vehicleHints,
  type AwayVehicle,
  type DutyItem,
  type DutySettings,
  type DutyVehicleHint,
} from "@/lib/logist-mobile/duty"
import { displayCity } from "@/lib/logist-mobile/format"

/** Что видит экран дежурного. */
export interface DutyState {
  settings: DutySettings
  /** Пора ли смотреть прямо сейчас */
  due: boolean
  /** Почему да или почему нет — словами */
  reason: string
  /** Когда дежурный посмотрит снова */
  nextAt: string | null
  /** Когда смотрел в прошлый раз */
  lastRunAt: string | null
  /** Сколько грузов лежит в накопленной базе организации */
  poolSize: number
  items: DutyItem[]
  hints: DutyVehicleHint[]
  headline: string
}

/**
 * Грузы с координатами: без точек нельзя посчитать ни подъезд, ни возврат,
 * а значит и «сколько останется» было бы выдумкой. Точки уже лежат в rawJson
 * груза — их кладёт туда скан (fromPoint/toPoint), поэтому здесь не геокодим
 * заново и не тратим лимиты.
 */
async function poolWithPoints(organizationId: string): Promise<BuilderLoad[]> {
  const rows = await prisma.atiCache.findMany({
    where: { organizationId, status: { not: "archived" } },
    orderBy: { scannedAt: "desc" },
    take: 600,
  })
  const merged = mergeLoads(rows as never[], []) as unknown as Array<Record<string, unknown>>
  return merged.map((row) => {
    let fromPoint: Point | null = null
    let toPoint: Point | null = null
    const raw = row.rawJson
    if (typeof raw === "string" && raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw) as { fromPoint?: Point | null; toPoint?: Point | null }
        fromPoint = parsed.fromPoint ?? null
        toPoint = parsed.toPoint ?? null
      } catch {
        // битый rawJson — груз остаётся без точек, это не ошибка экрана
      }
    }
    return {
      id: String(row.id),
      loadId: String(row.atiLoadId ?? row.id),
      fromCity: String(row.routeFrom ?? ""),
      toCity: String(row.routeTo ?? ""),
      weightKg: (row.weight as number | null) ?? null,
      volumeM3: (row.volume as number | null) ?? null,
      truckType: (row.truckType as string | null) ?? null,
      priceRub: (row.price as number | null) ?? null,
      priceWithNds: null,
      distanceKm: (row.distance as number | null) ?? null,
      firmName: (row.firmName as string | null) ?? null,
      loadingDate: (row.loadingDate as Date | null) ?? null,
      status: String(row.status ?? "new"),
      fromPoint,
      toPoint,
    } as BuilderLoad
  })
}

/** Настройки дежурного организации (лежат в FleetSettings). */
export async function dutySettingsFor(organizationId: string): Promise<{
  settings: DutySettings
  operatingCostPerKm: number
  baseCity: string
  basePoint: Point | null
}> {
  const settings = await prisma.fleetSettings.findFirst({
    where: { organizationId },
    select: {
      baseAddress: true,
      baseLat: true,
      baseLng: true,
      operatingCostPerKm: true,
      dutyEnabled: true,
      dutyIntervalMin: true,
      dutyFromHour: true,
      dutyToHour: true,
    },
  })
  const basePoint =
    settings?.baseLat != null && settings?.baseLng != null
      ? { lat: settings.baseLat, lng: settings.baseLng }
      : null
  return {
    settings: normalizeDutySettings({
      enabled: settings?.dutyEnabled ?? true,
      intervalMin: settings?.dutyIntervalMin ?? 15,
      fromHour: settings?.dutyFromHour ?? 7,
      toHour: settings?.dutyToHour ?? 21,
    }),
    operatingCostPerKm: settings?.operatingCostPerKm ?? DEFAULT_OPERATING_COST_PER_KM,
    // Город базы, а не область: в адресе «Московская область, Домодедово, …»
    // первым идёт регион, и проверка «груз у базы» не срабатывала ни на одном
    // грузе — дежурный молчал при полной бирже.
    baseCity: settings?.baseAddress ? displayCity(settings.baseAddress) : "",
    basePoint,
  }
}

/** Где сейчас машины: из активных рейсов и назначенных заказов. */
export async function awayVehicles(organizationId: string): Promise<AwayVehicle[]> {
  const routes = await prisma.route.findMany({
    where: { organizationId, status: { in: ["planned", "in_progress", "active"] } },
    select: {
      status: true,
      vehicle: { select: { plate: true } },
      orders: { select: { routeTo: true, status: true, routeSequence: true } },
    },
    take: 20,
  })
  const away: AwayVehicle[] = []
  for (const route of routes) {
    const plate = route.vehicle?.plate ?? null
    if (!plate) continue
    const orders = [...(route.orders ?? [])].sort(
      (a, b) => (a.routeSequence ?? 0) - (b.routeSequence ?? 0),
    )
    const pending = orders.filter((order) => order.status !== "delivered" && order.status !== "completed")
    const city = (pending.length > 0 ? pending[pending.length - 1] : orders[orders.length - 1])?.routeTo
    if (!city) continue
    away.push({
      plate,
      city,
      // В плане машина ещё на базе, в пути — уже едет: и то и другое значит
      // «скоро будет в этом городе», поэтому вид один.
      kind: "доедет",
    })
  }
  return away
}

/**
 * Разбор сохранённой ленты прошлого просмотра.
 * Битый JSON — не повод падать: дежурный просто покажет новое.
 */
function parseFeed(raw: string | null): DutyItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is DutyItem =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as DutyItem).atiLoadId === "string" &&
        typeof (item as DutyItem).score === "number",
    )
  } catch {
    return []
  }
}

/** Что показать на экране дежурного — без запуска сбора. */
export async function getDutyState(organizationId: string, now: Date = new Date()): Promise<DutyState> {
  const config = await dutySettingsFor(organizationId)
  const [lastRun, pool, vehicles, away] = await Promise.all([
    prisma.dutyRun.findFirst({
      where: { organizationId },
      orderBy: { startedAt: "desc" },
    }),
    poolWithPoints(organizationId),
    prisma.vehicle.findMany({
      where: { organizationId, archivedAt: null },
      select: {
        id: true,
        plate: true,
        type: true,
        capacity: true,
        volume: true,
        features: true,
        status: true,
        fuelConsumptionPer100: true,
        operatingCostPerKm: true,
      },
    }),
    awayVehicles(organizationId),
  ])

  const due = dutyIsDue(config.settings, lastRun?.startedAt ?? null, now)
  const seen = await prisma.dutySeen.findMany({
    where: { organizationId },
    select: { atiLoadId: true, firstSeenAt: true, priceRub: true },
    take: 50000,
  })

  const feed = buildDutyFeedDetailed({
    loads: pool,
    seen,
    vehicles: vehicles as unknown as BuilderVehicle[],
    basePoint: config.basePoint,
    baseCity: config.baseCity,
    fuelPriceRubPerL: 70,
    operatingCostPerKm: config.operatingCostPerKm,
    away,
    radiusKm: 400,
    now,
  })
  const found = feed.items

  // Что показал прошлый просмотр. Само по себе «виденное» означает, что
  // повторно дежурный этот груз не покажет, и экран оставался пустым сразу
  // после нажатия «Посмотреть». Поэтому лента прошлого просмотра остаётся,
  // пока груз висит на бирже; новые грузы встают рядом и сортируют её заново.
  const lastFeed = parseFeed(lastRun?.itemsJson ?? null)
  const poolIds = new Set(pool.map((load) => load.loadId || load.id))
  const items = [...found]
  for (const item of lastFeed) {
    if (!poolIds.has(item.atiLoadId)) continue
    if (items.some((existing) => existing.atiLoadId === item.atiLoadId)) continue
    items.push(item)
  }
  items.sort((a, b) => b.score - a.score)
  // Итог считаем по тому, что реально показано: «20 грузов» при двенадцати
  // строках — это ошибка, а не подробность.
  const shown = items.slice(0, DUTY_FEED_LIMIT)

  return {
    settings: config.settings,
    due: due.due,
    reason: due.reason,
    nextAt: due.nextAt ? due.nextAt.toISOString() : null,
    lastRunAt: lastRun?.startedAt ? lastRun.startedAt.toISOString() : null,
    poolSize: pool.length,
    items: shown,
    hints: vehicleHints({
      away,
      loads: pool,
      vehicles: vehicles as unknown as BuilderVehicle[],
    }),
    headline: dutyHeadline(shown, feed.farCount),
  }
}

export interface DutyRunResult {
  ran: boolean
  reason: string
  poolSize: number
  freshCount: number
  itemsCount: number
  note: string
}

/**
 * Просмотр биржи дежурным.
 *
 * force — «посмотреть сейчас» по кнопке, без оглядки на график и часы.
 * Без force: если не пора, ничего не делаем и честно говорим почему.
 */
export async function runDuty(
  organizationId: string,
  options: { force?: boolean; now?: Date; scan?: boolean } = {},
): Promise<DutyRunResult> {
  const now = options.now ?? new Date()
  const config = await dutySettingsFor(organizationId)
  const lastRun = await prisma.dutyRun.findFirst({
    where: { organizationId },
    orderBy: { startedAt: "desc" },
  })
  const due = dutyIsDue(config.settings, lastRun?.startedAt ?? null, now)
  if (!options.force && !due.due) {
    return {
      ran: false,
      reason: due.reason,
      poolSize: 0,
      freshCount: 0,
      itemsCount: 0,
      note: due.reason,
    }
  }

  const run = await prisma.dutyRun.create({
    data: { organizationId, startedAt: now },
  })

  let note = ""
  if (options.scan !== false) {
    // Свежий сбор с биржи — тем же путём, что кнопка «Собрать». Ошибку биржи
    // не глотаем: дежурный обязан сказать «биржа не ответила», а не сделать
    // вид, что новых грузов нет.
    try {
      const { scanForOrganization } = await import("@/lib/ati/duty-scan")
      const result = await scanForOrganization(organizationId)
      note = result.note
    } catch (error) {
      note = error instanceof Error ? error.message : "Биржа не ответила"
    }
  }

  const pool = await poolWithPoints(organizationId)
  const seenRows = await prisma.dutySeen.findMany({
    where: { organizationId },
    select: { atiLoadId: true, firstSeenAt: true, priceRub: true },
    // Без orderBy: нужны просто «все, кого уже видели». Ограничение большое,
    // чтобы давно висящий груз не всплывал как новый на большой базе.
    take: 50000,
  })
  const seenIds = new Set(seenRows.map((row) => row.atiLoadId))
  const fresh = pool.filter((load) => !seenIds.has(load.loadId || load.id))

  const vehicles = await prisma.vehicle.findMany({
    where: { organizationId, archivedAt: null },
    select: {
      id: true,
      plate: true,
      type: true,
      capacity: true,
      volume: true,
      features: true,
      status: true,
      fuelConsumptionPer100: true,
      operatingCostPerKm: true,
    },
  })
  const away = await awayVehicles(organizationId)
  const feed = buildDutyFeedDetailed({
    loads: pool,
    seen: seenRows,
    vehicles: vehicles as unknown as BuilderVehicle[],
    basePoint: config.basePoint,
    baseCity: config.baseCity,
    fuelPriceRubPerL: 70,
    operatingCostPerKm: config.operatingCostPerKm,
    away,
    radiusKm: 400,
    now,
  })
  const items = feed.items

  // Запоминаем всё, что видели: следующая лента покажет только новое.
  //
  // Пачками, а не по строке: пул региона — это тысячи грузов, и по одному
  // upsert на каждый просмотр превращал «посмотреть биржу» в минуту ожидания.
  // Новые вставляем одним createMany (повторы пропускаем — их видела
  // параллельная вкладка), известным просто обновляем отметку времени.
  const knownIds = new Set(seenRows.map((row) => row.atiLoadId))
  const freshRows = pool
    .filter((load) => !knownIds.has(load.loadId || load.id))
    .map((load) => ({
      organizationId,
      atiLoadId: load.loadId || load.id,
      firstSeenAt: now,
      lastSeenAt: now,
      priceRub: load.priceRub,
      fromCity: load.fromCity,
      toCity: load.toCity,
    }))

  for (let index = 0; index < freshRows.length; index += 500) {
    const batch = freshRows.slice(index, index + 500)
    try {
      await prisma.dutySeen.createMany({ data: batch })
    } catch {
      // Кто-то успел записать тот же груз между чтением и вставкой (две
      // вкладки, cron и кнопка) — досыпаем по одной, повтор пропускаем.
      for (const row of batch) {
        await prisma.dutySeen.upsert({
          where: { organizationId_atiLoadId: { organizationId, atiLoadId: row.atiLoadId } },
          create: row,
          update: { lastSeenAt: now },
        })
      }
    }
  }

  const seenNow = pool
    .map((load) => load.loadId || load.id)
    .filter((atiLoadId) => knownIds.has(atiLoadId))
  for (let index = 0; index < seenNow.length; index += 500) {
    await prisma.dutySeen.updateMany({
      where: { organizationId, atiLoadId: { in: seenNow.slice(index, index + 500) } },
      data: { lastSeenAt: now },
    })
  }

  await prisma.dutyRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      poolSize: pool.length,
      freshCount: fresh.length,
      itemsCount: items.length,
      note: note || null,
      // Лента этого просмотра: следующий GET покажет её, а не пустоту
      itemsJson: JSON.stringify(items),
    },
  })

  return {
    ran: true,
    reason: "Посмотрел биржу",
    poolSize: pool.length,
    freshCount: fresh.length,
    itemsCount: items.length,
    note: note || dutyHeadline(items),
  }
}
