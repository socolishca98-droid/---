// scripts/warm-geocache.ts
//
// Прогрев справочника координат: города из пула грузов и заказов → GeoCache.
//
// Зачем отдельный скрипт. Геокодер в приложении работает лениво: первый расчёт
// маршрута упирается в города, которых нет в кэше, и тратит на них сеть с
// паузой 1 запрос/сек. На боевом пуле это 27 грузов из 120, выпавших из
// планирования с причиной «нет координат точки погрузки». Прогрев один раз
// снимает эту задержку навсегда: GeoCache — общий справочник, он не привязан
// к организации.
//
// Скрипт идемпотентен: уже известные адреса не запрашиваются повторно.
//
// Запуск (DATABASE_URL — рабочая база):
//   npm run geo:warm
//   npm run geo:warm -- --org cmuy6ylgv000014ci9aec7mpf --limit 300
//
// Сколько городов осталось без координат, скрипт печатает в конце — молча
// «всё хорошо» он не отвечает.

import { prisma } from "../lib/prisma"
import { geocodeAddresses } from "../lib/geo/geocode"

/** Сколько адресов просим за одну пачку (в геокодере свой лимит на вызов). */
const BATCH = 12

const argv = process.argv.slice(2)
const get = (flag: string): string | undefined => {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}
const onlyOrg = get("--org")
const limit = Number(get("--limit") ?? 0) || 0

/** «Город #142335» — ATI не дал названия: геокодировать нечего. */
const isPlaceholder = (value: string) => /^Город #\d+$/i.test(value.trim())

async function collectCities(): Promise<string[]> {
  const where = onlyOrg ? { organizationId: onlyOrg } : {}
  const [loads, orders] = await Promise.all([
    prisma.atiCache.findMany({ where, select: { routeFrom: true, routeTo: true }, take: 20000 }),
    prisma.order.findMany({ where, select: { routeFrom: true, routeTo: true }, take: 20000 }),
  ])
  const out = new Set<string>()
  for (const row of [...loads, ...orders]) {
    for (const value of [row.routeFrom, row.routeTo]) {
      const city = (value ?? "").trim()
      if (city.length >= 3 && !isPlaceholder(city)) out.add(city)
    }
  }
  return [...out].sort()
}

async function main(): Promise<void> {
  console.log(`[geo:warm] собираю города${onlyOrg ? ` организации ${onlyOrg}` : ""}…`)
  const cities = await collectCities()
  console.log(`[geo:warm] городов всего: ${cities.length}`)

  const known = await prisma.geoCache.findMany({
    where: { address: { in: cities.map((city) => city.trim().toLowerCase()) } },
    select: { address: true },
  })
  const knownSet = new Set(known.map((row) => row.address))
  let queue = cities.filter((city) => !knownSet.has(city.trim().toLowerCase()))
  console.log(`[geo:warm] уже есть в кэше: ${cities.length - queue.length}, спрашивать: ${queue.length}`)
  if (limit > 0 && queue.length > limit) queue = queue.slice(0, limit)

  let found = 0
  let missing: string[] = []
  for (let start = 0; start < queue.length; start += BATCH) {
    const batch = queue.slice(start, start + BATCH)
    const coords = await geocodeAddresses(batch)
    for (const city of batch) {
      if (coords.get(city)) found += 1
      else missing.push(city)
    }
    const done = Math.min(start + BATCH, queue.length)
    console.log(`[geo:warm] ${done}/${queue.length}: найдено ${found}, без координат ${missing.length}`)
  }

  // Справочник ATI получает те же координаты: расчёт сначала смотрит в него,
  // и это дешевле, чем идти в GeoCache по каждому городу.
  const filled = await fillAtiCity()
  console.log(`[geo:warm] в справочнике AtiCity координаты проставлены для ${filled} городов`)

  console.log(`[geo:warm] итог: найдено ${found}, без координат ${missing.length}`)
  if (missing.length > 0) {
    console.log(`[geo:warm] не нашлись: ${missing.slice(0, 20).join("; ")}${missing.length > 20 ? " и ещё " + (missing.length - 20) : ""}`)
  }
}

/**
 * Перенос координат из GeoCache в справочник городов ATI.
 *
 * В AtiCity координат не было вовсе: схема их описывает, а таблица пришла из
 * словаря ATI без них. Берём город из адреса («Новороссийск, Краснодарский
 * край» → «Новороссийск») и проставляем, где ещё пусто.
 */
async function fillAtiCity(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    with geo as (
      select lower(trim(split_part(address, ',', 1))) as city, lat, lng
      from "GeoCache"
      where lat is not null and lng is not null
    )
    update "AtiCity" c
    set lat = geo.lat, lon = geo.lng
    from geo
    where lower(trim(c.name)) = geo.city and (c.lat is null or c.lon is null)
    returning 1
  `.catch(() => [])
  return rows.length
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error("[geo:warm] ошибка:", error)
    await prisma.$disconnect()
    process.exit(1)
  })
