// scripts/check-osrm.ts
//
// Проверка дорожного маршрутизатора НА КОНКРЕТНЫХ УЧАСТКАХ организации.
//
// Зачем отдельный скрипт: километры — это деньги. Пока маршрутизатора нет,
// расстояние считается «прямая × коэффициент региона», и коэффициент региона
// (1,2 по умолчанию) — догадка. Прежде чем включать OSRM в расчёт, нужно
// увидеть своими глазами: сколько запросов уходит, сколько это занимает и
// насколько оценка расходится с дорогой на ЭТИХ городах.
//
// Запуск:
//   OSRM_URL=http://localhost:5000 npm run routing:osrm -- <organizationId>
//
// Без OSRM_URL берётся публичный демо-сервер OSRM — только для проверки,
// в расчёте он не используется (медленный и без гарантий).

import { prisma } from "@/lib/prisma"
import { scopedWhere } from "@/lib/org"
import { DistanceEngine, straightKm, regionKey } from "@/lib/routing/distance"
import { baseFromSettings, cityKey, placeFromCity, type FleetSettingsRow } from "@/lib/routing/adapter"
import type { Place } from "@/lib/routing/types"

const DEMO_OSRM = "https://router.project-osrm.org"

/** «Домодедово, Московская область» → «Домодедово» */
function shortCity(value: string): string {
  const first = String(value ?? "").split(",")[0]?.trim() ?? ""
  return first || String(value ?? "").trim()
}

/** «воронеж» из геокэша → «Воронеж»: в отчёте нужны города, а не ключи. */
function titleCity(value: string): string {
  const city = shortCity(value)
  return city ? city[0].toUpperCase() + city.slice(1) : city
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

async function main() {
  const osrmUrl = (process.env.OSRM_URL ?? "").trim() || DEMO_OSRM
  const demo = osrmUrl === DEMO_OSRM
  const orgId = process.argv[2] || (await prisma.organization.findFirst({ select: { id: true } }))?.id
  if (!orgId) {
    console.log("в базе нет ни одной организации")
    return
  }

  const settings = (await prisma.fleetSettings.findFirst({ where: scopedWhere(orgId) })) as FleetSettingsRow | null
  const base = baseFromSettings(settings)
  if (!base) {
    console.log("у организации не задан адрес базы — участки не из чего строить")
    return
  }

  const rows = await prisma.atiCache.findMany({
    where: {
      ...scopedWhere(orgId),
      status: { notIn: ["rejected", "taken", "expired"] },
    },
    take: 60,
    select: { routeFrom: true, routeTo: true, distance: true },
  })

  // Города пула приходят с областью: «Домодедово, Московская область». Ищем
  // и по полной строке (в геокэше адреса хранятся как есть), и по короткому
  // названию (в справочнике ATI — только имя города).
  const fullNames = [...new Set([...rows.flatMap((row) => [row.routeFrom, row.routeTo])])]
  const shortNames = [...new Set([base.city, ...fullNames.map(shortCity)])]
  const known = new Map<string, Place>()

  const cityRows = await prisma.atiCity.findMany({
    where: { name: { in: shortNames } },
    select: { name: true, region: true, lat: true, lon: true },
  })
  for (const row of cityRows) {
    const key = cityKey(row.name)
    if (known.has(key)) continue
    const place = placeFromCity({ city: row.name, region: row.region, lat: row.lat, lng: row.lon })
    if (place) known.set(key, place)
  }

  const geoRows = await prisma.geoCache.findMany({
    where: { address: { in: [...fullNames.map((name) => name.toLowerCase()), ...shortNames.map((name) => name.toLowerCase())] } },
    select: { address: true, lat: true, lng: true },
  })
  for (const row of geoRows) {
    const key = cityKey(shortCity(row.address))
    if (known.has(key)) continue
    const place = placeFromCity({ city: titleCity(row.address), region: null, lat: row.lat, lng: row.lng })
    if (place) known.set(key, place)
  }

  const places = [...known.values()]
  console.log(`организация: ${orgId}`)
  console.log(`база: ${base.city}`)
  console.log(`маршрутизатор: ${osrmUrl}${demo ? " (публичный демо-сервер — только для проверки)" : ""}`)
  console.log(`городов в проверке: ${places.length}\n`)

  if (places.length < 2) {
    console.log("нужно минимум два города с координатами")
    return
  }

  const engine = new DistanceEngine({ osrmUrl, regions: [] })

  // Пары, которые реально нужны расчёту: база→погрузка, погрузка→выгрузка,
  // выгрузка→база.
  const pairs: Array<{ a: Place; b: Place; mode: "loaded" | "deadhead" }> = []
  for (const place of places) {
    if (place.id !== base.id) {
      pairs.push({ a: base, b: place, mode: "deadhead" })
      pairs.push({ a: place, b: base, mode: "deadhead" })
    }
  }
  for (const row of rows) {
    const from = known.get(cityKey(shortCity(row.routeFrom)))
    const to = known.get(cityKey(shortCity(row.routeTo)))
    if (from && to && from.id !== to.id) pairs.push({ a: from, b: to, mode: "loaded" })
  }

  // Одинаковые участки не считаем дважды: у пула бывают грузы «один город —
  // один город» в разных ставках, и это те же километры.
  const uniquePairs = [...new Map(pairs.map((pair) => [`${pair.a.id}|${pair.b.id}|${pair.mode}`, pair])).values()]
  pairs.length = 0
  pairs.push(...uniquePairs)

  const startedAt = Date.now()
  await engine.prefetch(pairs)
  const elapsed = Date.now() - startedAt

  console.log(`пар: ${pairs.length}, запросов к маршрутизатору: ${engine.osrmRequests || engine.tableRequests}, ${elapsed} мс`)

  // Сверка «оценка против дороги» на каждом участке.
  const rowsOut: string[] = []
  const deviations: number[] = []
  let measured = 0
  for (const pair of pairs) {
    const real = engine.segment(pair.a, pair.b, pair.mode)
    if (real.source !== "osrm") continue
    measured += 1
    const estimate = engine.estimate(pair.a, pair.b, pair.mode)
    const straight = straightKm(pair.a.point, pair.b.point)
    const deviation = ((estimate.km - real.km) / real.km) * 100
    deviations.push(deviation)
    if (rowsOut.length < 12) {
      rowsOut.push(
        `  ${pair.a.city} → ${pair.b.city}: прямая ${Math.round(straight)} км, ` +
          `оценка ${estimate.km} км, дорога ${real.km} км, расхождение ${deviation > 0 ? "+" : ""}${deviation.toFixed(0)} %`,
      )
    }
  }

  console.log(rowsOut.join("\n"))

  if (measured === 0) {
    console.log("\nмаршрутизатор не ответил ни на один участок — расчёт останется на оценке")
    return
  }

  // Эмпирический коэффициент дороги на этих участках: сколько раз дорога
  // длиннее прямой. Это и есть «проверка регионального параметра на конкретном
  // участке» — цифра, которую можно поставить в настройки региона.
  const factors = pairs
    .filter((pair) => engine.segment(pair.a, pair.b, pair.mode).source === "osrm")
    .map((pair) => {
      const straight = straightKm(pair.a.point, pair.b.point)
      const real = engine.segment(pair.a, pair.b, pair.mode).km
      return straight > 0 ? real / straight : 0
    })
    .filter((value) => value > 0)

  console.log(`\nучастков с дорогой: ${measured} из ${pairs.length}`)
  console.log(`медианное расхождение оценки с дорогой: ${median(deviations).toFixed(1)} %`)
  console.log(`эмпирический коэффициент «дорога / прямая»: ${median(factors).toFixed(2)}`)
  console.log(
    Math.abs(median(deviations)) > 15
      ? "ВЫВОД: оценка расходится с дорогой больше чем на 15 % — без маршрутизатора экономика врёт, OSRM нужен"
      : "ВЫВОД: оценка близка к дороге на этих участках, но она остаётся догадкой",
  )
  console.log(`регион базы: ${base.region ?? "неизвестен"} (ключ «${regionKey(base.region)}»)`)

  // Скорость: OSRM считает по легковому профилю, а календарь рейса — по
  // модели региона. Если расхождение большое, это видно здесь, а не в
  // обещаниях клиенту.
  const speeds = pairs
    .map((pair) => {
      const real = engine.segment(pair.a, pair.b, pair.mode)
      if (real.source !== "osrm" || !real.osrmHours || real.osrmHours <= 0) return null
      return real.km / real.osrmHours
    })
    .filter((value): value is number => value !== null)
  if (speeds.length > 0) {
    const modelSpeed = 55
    console.log(
      `скорость по OSRM (легковой профиль): медианно ${median(speeds).toFixed(0)} км/ч, ` +
        `в расчёте календаря — ${modelSpeed} км/ч с грузом. ` +
        "Километры берём из дороги, время — из модели: легковое время обещает доставку раньше, чем машина доедет",
    )
  }

  const withExchange = rows.filter((row) => typeof row.distance === "number" && row.distance > 0)
  if (withExchange.length > 0) {
    const diffs = withExchange
      .map((row) => {
        const declared = row.distance
        if (typeof declared !== "number") return null
        const from = known.get(cityKey(shortCity(row.routeFrom)))
        const to = known.get(cityKey(shortCity(row.routeTo)))
        if (!from || !to) return null
        const real = engine.segment(from, to, "loaded")
        if (real.source !== "osrm") return null
        return ((declared - real.km) / real.km) * 100
      })
      .filter((value): value is number => value !== null)
    if (diffs.length > 0) {
      console.log(
        `километраж биржи против дороги: медианно ${median(diffs) > 0 ? "+" : ""}${median(diffs).toFixed(0)} % ` +
          `(биржу не пересчитываем — по ней фрахтователь считает ставку)`,
      )
    }
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
