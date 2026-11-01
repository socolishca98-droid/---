// scripts/compare-builders.ts
//
// Сравнение СТАРОГО сборщика (lib/logist-mobile/route-builder.ts, считает в
// браузере) и НОВОГО (lib/routing, считает на сервере) на ОДНОМ И ТОМ ЖЕ пуле
// реальной организации.
//
// Зачем: тесты доказывают, что новый алгоритм лучше на моделях. Но заменить
// экран можно только когда видно, ЧТО ИМЕННО изменится для логиста на его
// собственных данных: какие заказы взяты, сколько километров, сколько денег,
// сколько часов. Этот скрипт печатает такое сравнение по каждой машине.
//
// Запуск:
//   npm run routing:compare -- <organizationId>
//
// ВАЖНО: ничего не пишет в базу. Геокодер может дозаполнить GeoCache (как и
// обычный расчёт), но данные организации не меняются.

import { prisma } from "@/lib/prisma"
import { scopedWhere } from "@/lib/org"
import { fuelPriceForRegion } from "@/lib/fleet/fuel-price"
import { buildRouteVariants, type BuilderLoad, type BuilderVehicle } from "@/lib/logist-mobile/route-builder"
import { baseFromSettings, cityKey, placeFromCity, type CityRow, type FleetSettingsRow } from "@/lib/routing/adapter"
import { planForOrganisation } from "@/lib/routing/service"

type Point = { lat: number; lng: number }

/** Координаты городов: сначала справочник ATI, потом общий геокэш. */
async function loadPoints(cities: string[]): Promise<Map<string, Point>> {
  const out = new Map<string, Point>()
  const unique = [...new Set(cities.map((city) => String(city ?? "").trim()).filter(Boolean))]
  if (unique.length === 0) return out

  try {
    const rows = await prisma.atiCity.findMany({
      where: { name: { in: unique } },
      select: { name: true, region: true, lat: true, lon: true },
    })
    for (const row of rows) {
      const place = placeFromCity({ city: row.name, region: row.region, lat: row.lat, lng: row.lon } as CityRow)
      if (place) out.set(cityKey(row.name), place.point)
    }
  } catch {
    /* справочник может быть пуст */
  }

  const missing = unique.filter((city) => !out.has(cityKey(city)))
  if (missing.length > 0) {
    try {
      const geo = await prisma.geoCache.findMany({
        where: { address: { in: missing.map((city) => city.toLowerCase()) } },
        select: { address: true, lat: true, lng: true },
      })
      for (const row of geo) {
        const key = cityKey(row.address)
        if (!out.has(key)) out.set(key, { lat: row.lat, lng: row.lng })
      }
    } catch {
      /* нет кеша — города останутся без координат */
    }
  }
  return out
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`
}

function hours(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 3600000)
}

async function main() {
  const orgId = process.argv[2] || (await prisma.organization.findFirst({ select: { id: true } }))?.id
  if (!orgId) {
    console.log("в базе нет ни одной организации")
    return
  }

  const settingsRow = (await prisma.fleetSettings.findFirst({ where: scopedWhere(orgId) })) as FleetSettingsRow | null
  const base = baseFromSettings(settingsRow)
  if (!base) {
    console.log(`организация ${orgId}: не задан адрес базы — сравнивать нечего`)
    return
  }
  const fuelPrice = fuelPriceForRegion(base.region)
  // Работа машины, ₽/км: своя ставка у машины, иначе ставка организации.
  const orgOpCost =
    typeof settingsRow?.operatingCostPerKm === "number" && settingsRow.operatingCostPerKm > 0
      ? settingsRow.operatingCostPerKm
      : null

  const now = new Date()
  const horizonEnd = new Date(now.getTime() + 72 * 3600000)

  const [vehicleRows, atiRows] = await Promise.all([
    prisma.vehicle.findMany({
      where: { ...scopedWhere(orgId), archivedAt: null, status: { not: "maintenance" } },
      select: {
        id: true,
        plate: true,
        type: true,
        capacity: true,
        volume: true,
        status: true,
        fuelConsumptionPer100: true,
        operatingCostPerKm: true,
        features: true,
      },
    }),
    prisma.atiCache.findMany({
      where: {
        ...scopedWhere(orgId),
        status: { notIn: ["rejected", "taken", "expired"] },
        OR: [{ loadingDate: null }, { loadingDate: { lte: horizonEnd } }],
      },
      orderBy: { scannedAt: "desc" },
      take: 120,
      select: {
        id: true,
        atiLoadId: true,
        routeFrom: true,
        routeTo: true,
        distance: true,
        weight: true,
        volume: true,
        cargoType: true,
        truckType: true,
        price: true,
        priceType: true,
        vatIncluded: true,
        firmName: true,
        firmId: true,
        contactPhone: true,
        loadingDate: true,
        status: true,
      },
    }),
  ])

  const cities = atiRows.flatMap((row) => [row.routeFrom, row.routeTo])
  const points = await loadPoints(cities)

  // ── Вход СТАРОГО сборщика ────────────────────────────────────────────────
  const oldLoads: BuilderLoad[] = []
  let withoutPoints = 0
  for (const row of atiRows) {
    const from = points.get(cityKey(row.routeFrom)) ?? null
    const to = points.get(cityKey(row.routeTo)) ?? null
    if (!from || !to) {
      withoutPoints += 1
      continue
    }
    oldLoads.push({
      id: row.id,
      loadId: row.atiLoadId,
      fromCity: row.routeFrom,
      toCity: row.routeTo,
      weightKg: row.weight,
      volumeM3: row.volume,
      cargoType: row.cargoType,
      truckType: row.truckType,
      priceRub: row.price,
      priceWithNds: row.vatIncluded ? row.price : null,
      distanceKm: row.distance,
      firmName: row.firmName,
      firmUrl: row.firmId ? `https://ati.su/firms/${row.firmId}/info` : null,
      contactPhone: row.contactPhone,
      loadingDate: row.loadingDate ? row.loadingDate.toISOString() : null,
      status: row.status,
      fromPoint: from,
      toPoint: to,
    })
  }

  // Старый сборщик сравниваем так, как его видит логист на экране: расход
  // топлива там тоже оценивается по типу машины (иначе прибыль не считается
  // вовсе и сравнение было бы нечестным — «старый не умеет» вместо «старый
  // решил иначе»).
  const estimateConsumption = (type: string): number => {
    const lower = type.toLowerCase()
    if (/газел|малый|малотон|микро/.test(lower)) return 18
    if (/фур|полуфур|тент|рефриж|изотерм|борт/.test(lower)) return 30
    return 24
  }

  const oldVehicles: BuilderVehicle[] = vehicleRows.map((row) => {
    const declared = row.fuelConsumptionPer100 && row.fuelConsumptionPer100 > 0 ? row.fuelConsumptionPer100 : null
    return {
      id: row.id,
      plate: row.plate,
      type: row.type,
      capacity: row.capacity,
      volume: row.volume,
      status: row.status,
      fuelConsumptionPer100: declared ?? estimateConsumption(row.type),
      fuelEstimated: !declared,
    }
  })

  console.log(`организация: ${orgId}`)
  console.log(`база: ${base.city}${base.region ? ` (${base.region})` : ""}, дизель ${fuelPrice} ₽/л`)
  console.log(`пул ATI: ${atiRows.length} строк, из них с координатами ${oldLoads.length}` + (withoutPoints ? `, без координат ${withoutPoints}` : ""))
  console.log(`машин: ${oldVehicles.length}\n`)

  // ── НОВЫЙ расчёт (серверный, тем же путём, что и API) ────────────────────
  const fresh = await planForOrganisation({ organisationId: orgId, source: "ati", poolLimit: 120 })
  if (!fresh.readiness.ok || !fresh.plan) {
    console.log("новый сборщик: расчёт невозможен —", fresh.readiness.blockers.join("; "))
  }

  // Старый сборщик считает прибыль как «выручка − топливо»: работа машины
  // (водитель, износ, ТО, шины, платные дороги) из неё не вычитается вовсе.
  // Чтобы сравнение было честным, пересчитываем его результат по той же
  // полной себестоимости, что использует новый сборщик.
  let oldWins = 0
  let newWins = 0
  let same = 0
  let overstated = 0
  const rowsOut: string[] = []

  for (const vehicle of oldVehicles) {
    const oldVariants = buildRouteVariants({
      startCity: base.city,
      startPoint: base.point,
      loads: oldLoads,
      vehicles: [vehicle],
      fuelPriceRubPerL: fuelPrice,
      maxHours: 72,
    })
    const oldRoute = oldVariants[0]?.route ?? null

    const newItem = fresh.plan?.perVehicle.find((item) => item.vehicleId === vehicle.id) ?? null
    const newPlan = newItem?.recommended ?? newItem?.variants[0] ?? null

    const oldIds = oldRoute?.legs.map((leg) => leg.load.id).join(",") ?? ""
    const newIds = newItem?.recommended?.orderIds.join(",") ?? ""
    const oldProfit = oldRoute?.totalProfitRub ?? null
    const newProfit = newPlan?.economics.netRub ?? null
    const ownOpCost = vehicleRows.find((row) => row.id === vehicle.id)?.operatingCostPerKm
    const opCost = ownOpCost && ownOpCost > 0 ? ownOpCost : orgOpCost
    const oldHonestNet =
      oldRoute && oldProfit !== null && opCost !== null && oldRoute.totalDistanceKm
        ? Math.round(oldRoute.totalRevenue - (oldRoute.totalFuelCostRub ?? 0) - opCost * oldRoute.totalDistanceKm)
        : null
    if (oldRoute && oldHonestNet !== null && oldProfit !== null && oldProfit - oldHonestNet > 100) overstated += 1
    const oldKm = oldRoute?.totalDistanceKm ?? null
    const newKm = newPlan?.economics.totalKm ?? null
    const oldHours = oldRoute ? hours(oldRoute.departAt, oldRoute.homeAt) : null
    const newHours = newPlan ? hours(newPlan.schedule.startAt, newPlan.schedule.endAt) : null

    let verdict: string
    if (!oldRoute && !newPlan) verdict = "оба: маршрута нет"
    else if (!oldRoute) verdict = "новый нашёл маршрут, старый — нет"
    else if (!newPlan) verdict = "старый нашёл маршрут, новый — нет"
    else if (oldHonestNet === null) verdict = "у старого прибыль не считается (нет расхода топлива)"
    else if (Math.round(newProfit ?? 0) > Math.round(oldHonestNet)) {
      verdict = `новый выгоднее на ${money((newProfit ?? 0) - oldHonestNet)}`
      newWins += 1
    } else if (Math.round(newProfit ?? 0) < Math.round(oldHonestNet)) {
      verdict = `старый выгоднее на ${money(oldHonestNet - (newProfit ?? 0))}`
      oldWins += 1
    } else {
      verdict = "одинаково"
      same += 1
    }

    rowsOut.push(
      [
        `машина ${vehicle.plate} (${vehicle.type}, ${vehicle.capacity} кг)`,
        `  старый: ${oldRoute ? `${oldRoute.legs.length} плеч, ${oldKm} км, ${money(oldProfit)}, ${oldHours} ч` : "—"}`,
        `  новый:  ${newPlan ? `${newItem?.recommended ? "" : "(не рекомендован) "}${newPlan.orderIds.length} заказов, ${newKm} км, ${money(newProfit)}, ${newHours} ч` : "—"}`,
        oldRoute && oldHonestNet !== null
          ? `  прибыль по полной себестоимости: старый ${money(oldHonestNet)} (на экране ${money(oldProfit)}), новый ${money(newProfit)}`
          : "",
        `  цепочка: старый [${oldIds || "—"}] / новый [${newIds || "—"}]`,
        `  вывод: ${verdict}`,
      ].join("\n"),
    )
  }

  console.log(rowsOut.join("\n\n"))

  console.log("\nитог по машинам (деньги — по полной себестоимости, иначе сравнение нечестное):")
  console.log(`  новый выгоднее: ${newWins}, старый выгоднее: ${oldWins}, одинаково: ${same}`)
  if (overstated > 0) {
    console.log(
      `  ВАЖНО: у ${overstated} маршрутов старый сборщик показывает прибыль ВЫШЕ, чем есть: ` +
        "работа машины (водитель, износ, ТО) не вычитается",
    )
  }

  if (fresh.plan) {
    const stats = fresh.plan.stats
    console.log(
      `\nновый: рассмотрено состояний ${stats.consideredStates}, отсечений ${stats.prunedStates}, ` +
        `запросов расстояний ${stats.distanceCalls} (из кеша ${stats.distanceCacheHits}), ${fresh.summary.elapsedMs} мс`,
    )
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
