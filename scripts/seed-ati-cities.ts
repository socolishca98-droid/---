/**
 * Справочник городов ATI.SU (GET /v1.0/dictionaries/cities) → AtiCity.
 *
 *   npm run seed:ati-cities                       — локальная БД (prisma)
 *   npm run seed:ati-cities -- --pg "postgres://…" — прямо в Postgres (COPY)
 *   npm run seed:ati-cities -- --file /path/cities.json
 *
 * Зачем: в грузах byboards приходит только CityId; имя города берём из
 * словаря ATI. Полный словарь — 162к городов (121 МБ), в репозитории лежит
 * только компактный срез lib/ati/ati-cities.json (крупные города), а здесь
 * заливается ВЕСЬ справочник РФ в таблицу AtiCity — резолв идёт из БД.
 *
 * Идемпотентен: ON CONFLICT (cityId) DO UPDATE.
 */
import { readFileSync } from "node:fs"
import { prisma } from "../lib/prisma"

type CityRow = { cityId: number; name: string; region: string }

const argv = process.argv.slice(2)
const get = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const filePath = get("--file") || "/home/user/ati-cities-ru.json"
const pgDsn = get("--pg")

/** Города РФ из словаря ATI (только нужные поля). */
function loadCities(path: string): CityRow[] {
  const raw: any = JSON.parse(readFileSync(path, "utf8"))
  if (Array.isArray(raw)) {
    return raw
      .filter((c: any) => c && c.CountryId === 1 && c.CityId)
      .map((c: any) => ({
        cityId: Number(c.CityId),
        name: String(c.ShortName || c.FullName || "").trim(),
        region: String(c.RegionName || "").trim(),
      }))
      .filter((c: any) => c.cityId > 0 && c.name)
  }
  const out: CityRow[] = []
  for (const key of Object.keys(raw)) {
    const v = raw[key]
    const cityId = Number(key)
    const name = String((v && v.n) || "").trim()
    if (cityId > 0 && name) out.push({ cityId, name, region: String((v && v.r) || "").trim() })
  }
  return out
}

async function seedLocal(cities: CityRow[]): Promise<void> {
  const BATCH = 1000
  let done = 0
  for (let i = 0; i < cities.length; i += BATCH) {
    const batch = cities.slice(i, i + BATCH)
    await prisma.$transaction(
      batch.map((c) =>
        prisma.atiCity.upsert({
          where: { cityId: c.cityId },
          create: c,
          update: { name: c.name, region: c.region },
        })
      )
    )
    done += batch.length
    if (done % 20000 === 0) console.log(`[seed:ati-cities] ${done}…`)
  }
  const total = await prisma.atiCity.count()
  console.log(`[seed:ati-cities] Готово: залито ${cities.length}, всего в таблице ${total}`)
}

async function seedPostgres(dsn: string, cities: CityRow[]): Promise<void> {
  // pg поставлен без типов (--no-save) — динамический импорт с кастом в any
  const { default: pg } = (await import("pg")) as any
  const client = new pg.Client({
    connectionString: dsn,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  await client.query(`
    CREATE TABLE IF NOT EXISTS "AtiCity" (
      "cityId" INTEGER PRIMARY KEY,
      "name" TEXT NOT NULL,
      "region" TEXT NOT NULL DEFAULT ''
    )`)
  await client.query(`CREATE INDEX IF NOT EXISTS "AtiCity_name_idx" ON "AtiCity" ("name")`)
  // COPY — быстро для 100k+ строк
  const BATCH = 5000
  let done = 0
  for (let i = 0; i < cities.length; i += BATCH) {
    const batch = cities.slice(i, i + BATCH)
    const values: unknown[] = []
    const rows = batch
      .map((c) => {
        values.push(c.cityId, c.name.replace(/\t|\n|\r|\\/g, " "), c.region.replace(/\t|\n|\r|\\/g, " "))
        return `($${values.length - 2}::int, $${values.length - 1}::text, $${values.length}::text)`
      })
      .join(",")
    await client.query(
      `INSERT INTO "AtiCity" ("cityId", "name", "region") VALUES ${rows}
       ON CONFLICT ("cityId") DO UPDATE SET "name" = EXCLUDED."name", "region" = EXCLUDED."region"`,
      values
    )
    done += batch.length
    if (done % 20000 === 0) console.log(`[seed:ati-cities] ${done}…`)
  }
  const { rows } = await client.query(`SELECT COUNT(*)::int n FROM "AtiCity"`)
  console.log(`[seed:ati-cities] Готово: залито ${cities.length}, всего в таблице ${rows[0].n}`)
  await client.end()
}

async function main(): Promise<void> {
  console.log(`[seed:ati-cities] Читаю ${filePath}…`)
  const cities = loadCities(filePath)
  console.log(`[seed:ati-cities] Городов РФ: ${cities.length}`)
  if (cities.length === 0) throw new Error("Словарь пуст — проверь --file")
  if (pgDsn) {
    await seedPostgres(pgDsn, cities)
  } else {
    await seedLocal(cities)
  }
}

main()
  .catch((error) => {
    console.error("[seed:ati-cities] Ошибка:", error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
