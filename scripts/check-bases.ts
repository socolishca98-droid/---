// scripts/check-bases.ts
//
// Планировщик с РАЗНЫХ ГОРОДОВ и под РАЗНЫЙ ВЕС — на данных организации.
//
// Зачем отдельная проверка. Тесты доказывают арифметику на моделях, но не
// отвечают на живой вопрос логиста: «а из Москвы он вообще что-нибудь
// соберёт? а в пятитонку?». Один и тот же пул грузов проверяется от нескольких
// баз и на нескольких машинах, и по каждому сочетанию видно: есть ли маршрут,
// сколько плеч, сколько порожнего пробега, сходится ли с независимым
// валидатором и доказан ли оптимум.
//
// Базы: Ярославль, Москва, Екатеринбург, Краснодар (по требованию к
// мультирегиональности) и Красноярск — междугородний маршрут через несколько
// часовых поясов.
//
// Запуск:
//   npm run routing:bases
//   npm run routing:bases -- <organizationId>
//
// Координаты городов берутся из справочника и геокэша; если адрес не находится,
// это печатается, а не подменяется выдуманной точкой.

import { prisma } from "@/lib/prisma"
import { geocodeAddresses } from "@/lib/geo/geocode"
import {
  baseFromSettings,
  cityKey,
  orderFromAtiRow,
  placeFromCity,
  regionsFromRows,
  settingsFromOrg,
  vehicleFromRow,
  type AtiLoadRow,
  type FleetSettingsRow,
} from "@/lib/routing/adapter"
import { planFleet, straightKm } from "@/lib/routing/index"
import { validatePlan } from "@/lib/routing/validator"
import type { LoadOrder, Place, Vehicle } from "@/lib/routing/types"

/** Базы для проверки: требование мультирегиональности + междугородний маршрут. */
const BASES = ["Ярославль", "Москва", "Екатеринбург", "Краснодар", "Красноярск"]

/** Вес машин: от «Газели» до фуры. */
const CAPACITIES = [1500, 5000, 10000, 20000]

const hours = (value: number) => Math.round(value * 10) / 10
const money = (value: number) => Math.round(value).toLocaleString("ru-RU")

async function main(): Promise<void> {
  const organisationId =
    process.argv[2] || (await prisma.organization.findFirst({ select: { id: true } }))?.id
  if (!organisationId) {
    console.log("в базе нет ни одной организации")
    return
  }

  const settingsRow = (await prisma.fleetSettings.findFirst({
    where: { organizationId: organisationId },
  })) as FleetSettingsRow | null
  const ownBase = baseFromSettings(settingsRow)
  const settings = settingsFromOrg(settingsRow)
  console.log(`организация: ${organisationId}`)
  console.log(`база из настроек: ${settingsRow?.baseAddress ?? "не задана"}`)

  // Пул — те же грузы, что видит логист.
  const loadRows = (await prisma.atiCache.findMany({
    where: {
      organizationId: organisationId,
      status: { notIn: ["rejected", "taken", "expired"] },
    },
    orderBy: { scannedAt: "desc" },
    take: 120,
  })) as unknown as AtiLoadRow[]

  const cities = [...new Set(loadRows.flatMap((row) => [row.routeFrom, row.routeTo]))]
  const places = await loadPlaces(cities)
  const orders: LoadOrder[] = []
  const skipped: string[] = []
  for (const row of loadRows) {
    const built = orderFromAtiRow({ ...row, organisationId: row.organisationId }, places)
    if (built.order) orders.push(built.order)
    else skipped.push(`${row.atiLoadId}: ${built.problems.join(", ")}`)
  }
  console.log(`грузов в пуле: ${loadRows.length}, пригодных: ${orders.length}`)
  if (orders[0]) console.log(`  организация заказа: ${orders[0].organisationId}, машины: ${organisationId}`)
  if (skipped.length > 0) console.log(`  отброшено: ${skipped.length} (${skipped[0]})`)

  const regions = regionsFromRows([
    ownBase?.region,
    ...orders.flatMap((order) => [order.pickup.region, order.delivery.region]),
  ])

  let planned = 0
  let invalid = 0
  for (const baseCity of BASES) {
    const base = await resolveBase(baseCity, ownBase)
    if (!base) {
      console.log(`\n${baseCity}: координаты базы не найдены — проверка невозможна`)
      continue
    }
    const nearby = orders.filter(
      (order) => straightKm(base.point, order.pickup.point) <= settings.startRadiusKm,
    ).length
    console.log(
      `\n── база ${baseCity} (${base.point.lat.toFixed(3)}, ${base.point.lng.toFixed(3)}): ` +
        `в радиусе ${settings.startRadiusKm} км — ${nearby} грузов ──`,
    )
    for (const capacity of CAPACITIES) {
      const vehicle = syntheticVehicle(base, capacity, settingsRow, organisationId)
      const startedAt = Date.now()
      const plan = await planFleet({
        orders,
        vehicles: [vehicle],
        settings,
        regions,
        now: new Date(),
        osrmUrl: process.env.OSRM_URL ?? null,
      })
      const elapsed = Date.now() - startedAt
      const result = plan.perVehicle[0]
      const recommended = result?.recommended ?? null
      if (!recommended) {
        // Не «первая причина», а раскладка: одна машина отбраковывает весь пул
        // по разным поводам, и по одной строке нельзя понять, дело в весе,
        // в кузове или в географии.
        // Группируем по «скелету» причины (цифры заменены), чтобы «20 т тяжелее
        // машины (1,5 т)» и «14 т тяжелее машины (1,5 т)» не считались разными
        // поводами. Но показываем НАСТОЯЩУЮ причину: раньше в отчёте стояло
        // «груз N т тяжелее машины (N т) (111)» — шаблон с цифрами-заглушками,
        // по которому нельзя понять, о каком грузе и какой машине речь.
        const counts = new Map<string, { count: number; example: string }>()
        for (const rejection of result?.rejected ?? []) {
          const key = rejection.reason.replace(/\d+([.,]\d+)?/g, "N").split(";")[0].trim()
          const entry = counts.get(key)
          if (entry) entry.count += 1
          else counts.set(key, { count: 1, example: rejection.reason.split(";")[0].trim() })
        }
        // Сортируем по частоте: главный повод должен стоять первым.
        const top = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 2)
        const reason =
          top.length > 0
            ? top.map((item) => `${item.example} — таких ${item.count}`).join("; ")
            : "в пуле нет грузов, подходящих этой машине и этой базе"
        console.log(`  ${capacity} кг: маршрута нет — ${reason} (${elapsed} мс)`)
        continue
      }
      planned += 1
      const check = validatePlan(recommended, orders, vehicle, settings)
      if (!check.ok) invalid += 1
      console.log(
        `  ${capacity} кг: ${recommended.model === "consolidated" ? "сборный" : "последовательный"}, ` +
          `грузов ${recommended.orderIds.length}, ${Math.round(recommended.economics.totalKm)} км ` +
          `(порожним ${Math.round(recommended.economics.emptyKm)}, ` +
          `${Math.round(recommended.economics.emptyShare * 100)} %), ` +
          `${hours(recommended.schedule.drivingHours)} ч движ., ${recommended.schedule.shifts} смен, ` +
          `выручка ${money(recommended.economics.revenue)} ₽, остаток ${money(recommended.economics.netCommittedRub)} ₽, ` +
          `оптимум ${recommended.exact ? "доказан" : "не доказан"}, ` +
          `валидатор: ${check.ok ? "без нарушений" : check.issues.map((issue) => issue.message).join("; ")}, ` +
          `${elapsed} мс`,
      )
    }
  }

  console.log(
    `\nитог: маршрутов построено ${planned}, с нарушениями ${invalid}. ` +
      (invalid === 0 ? "Все планы прошли независимую проверку." : "Есть нарушения — разбирать до выкатки."),
  )
}

/** Координаты города базы: справочник → геокэш → геокодер (без выдумок). */
async function resolveBase(city: string, ownBase: Place | null): Promise<Place | null> {
  if (ownBase && cityKey(ownBase.city).startsWith(cityKey(city))) return ownBase

  // Порядок важен: в справочнике ATI есть несколько «Москва» (деревня в
  // Приморье тоже Москва). Живая проверка базы «Москва» дала точку 43.35,
  // 132.78 — Владивосток. Поэтому сначала геокэш: там адрес записан так же,
  // как его пишет ATI, и это уже проверенные координаты.
  const cached = await prisma.geoCache.findFirst({
    where: { address: { in: [city.toLowerCase(), `${city.toLowerCase()}, россия`] } },
  })
  if (cached) {
    const place = placeFromCity({ city, region: null, lat: cached.lat, lng: cached.lng })
    if (place) return place
  }

  const coords = await geocodeAddresses([`${city}, Россия`])
  const point = coords.get(`${city}, Россия`)
  if (point) return placeFromCity({ city, region: null, lat: point.lat, lng: point.lng })

  // Последним — справочник ATI, если в нём ровно один такой город.
  const rows = await prisma.atiCity.findMany({
    where: { name: city, lat: { not: null } },
    select: { name: true, region: true, lat: true, lon: true },
  })
  if (rows.length === 1) {
    return placeFromCity({ city: rows[0].name, region: rows[0].region, lat: rows[0].lat, lng: rows[0].lon })
  }
  return null
}

/** Города пула → точки. Справочник ATI, затем GeoCache; чего нет — остаётся без точки. */
async function loadPlaces(cities: string[]): Promise<Map<string, Place>> {
  const out = new Map<string, Place>()
  const unique = [...new Set(cities.map((city) => city.trim()).filter(Boolean))]
  const rows = await prisma.atiCity.findMany({
    where: { name: { in: unique.map((city) => city.split(",")[0].trim()) } },
    select: { name: true, region: true, lat: true, lon: true },
  })
  for (const row of rows) {
    const place = placeFromCity({ city: row.name, region: row.region, lat: row.lat, lng: row.lon })
    if (place) out.set(cityKey(row.name), place)
  }
  const missing = unique.filter((city) => !out.has(cityKey(city)))
  if (missing.length > 0) {
    const cached = await prisma.geoCache.findMany({
      where: { address: { in: missing.map((city) => city.toLowerCase()) } },
      select: { address: true, lat: true, lng: true },
    })
    for (const row of cached) {
      const key = cityKey(row.address)
      if (out.has(key)) continue
      const place = placeFromCity({ city: row.address, region: null, lat: row.lat, lng: row.lng })
      if (place) out.set(key, place)
    }
  }
  // Чего нет ни там, ни там — спрашиваем геокодер (и он же кладёт в кэш).
  const stillMissing = unique.filter((city) => !out.has(cityKey(city)))
  if (stillMissing.length > 0) {
    const geocoded = await geocodeAddresses(stillMissing.slice(0, 12))
    for (const city of stillMissing.slice(0, 12)) {
      const point = geocoded.get(city)
      if (!point) continue
      const place = placeFromCity({ city, region: null, lat: point.lat, lng: point.lng })
      if (place) out.set(cityKey(city), place)
    }
  }
  return out
}

/**
 * Машина заданного веса. Это проверочная машина, а не карточка из автопарка:
 * расход топлива и работа машины берутся из настроек организации, объём — из
 * типового соотношения «тент 20 т → 82 м³», иначе объём ограничивал бы всё
 * одинаково и проверка веса ничего бы не показала.
 */
function syntheticVehicle(
  base: Place,
  capacityKg: number,
  settingsRow: FleetSettingsRow | null,
  organisationId: string,
): Vehicle {
  const volume = capacityKg >= 20000 ? 82 : capacityKg >= 10000 ? 60 : capacityKg >= 5000 ? 32 : 12
  return vehicleFromRow(
    {
      id: `check-${capacityKg}`,
      // Организация — настоящая: ядро отбрасывает заказы чужой организации, и
      // проверочная машина с выдуманным идентификатором получила бы пустой пул.
      organisationId,
      plate: `ПРОВЕРКА-${capacityKg}`,
      type: "Тент",
      // capacity в строке машины — килограммы (так её хранит карточка).
      capacity: capacityKg,
      volume,
      fuelConsumptionPer100: capacityKg >= 15000 ? 30 : capacityKg >= 8000 ? 22 : capacityKg >= 4000 ? 17 : 12,
      operatingCostPerKm: settingsRow?.operatingCostPerKm ?? null,
      status: "active",
    },
    base,
    settingsRow,
    base.region,
  )
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error("ошибка проверки:", error)
    await prisma.$disconnect()
    process.exit(1)
  })
