/**
 * Справочник городов ATI.SU (GET /v1.0/dictionaries/cities) → AtiCity.
 *
 *   npm run seed:ati-cities                              — БД из DATABASE_URL
 *   npm run seed:ati-cities -- --file /path/cities.json  — другой источник
 *
 * Зачем: в грузах byboards приходит только CityId; имя города берём из
 * словаря ATI. Полный словарь — 162к городов (121 МБ), в репозитории лежит
 * только компактный срез lib/ati/ati-cities.ts (крупные города), а здесь
 * заливается ВЕСЬ справочник РФ в таблицу AtiCity — резолв идёт из БД.
 *
 * Работает через Prisma (sqlite для стенда, postgres для Supabase — по
 * DATABASE_URL), без внешних зависимостей вроде pg.
 * Идемпотентен: таблица перезаливается целиком перед вставкой.
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

/** Города РФ из словаря ATI (только нужные поля). Поддержка двух форматов:
 *  массив словаря dictionaries/cities или компактный { cityId: {n,r} }. */
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
    if (cityId > 0 && name) {
      out.push({ cityId, name, region: String((v && v.r) || "").trim() })
    }
  }
  return out
}

async function main(): Promise<void> {
  console.log(`[seed:ati-cities] Читаю ${filePath}…`)
  const cities = loadCities(filePath)
  console.log(`[seed:ati-cities] Городов РФ: ${cities.length}`)
  if (cities.length === 0) throw new Error("Словарь пуст — проверь --file")

  // Идемпотентность: справочник общий — перезаливаем целиком (быстрее и
  // предсказуемее, чем 128k upsert-ов).
  const existing = await prisma.atiCity.count()
  if (existing > 0) {
    console.log(`[seed:ati-cities] Очищаю старые записи: ${existing}`)
    await prisma.atiCity.deleteMany({})
  }

  const BATCH = 5000
  let done = 0
  for (let i = 0; i < cities.length; i += BATCH) {
    const batch = cities.slice(i, i + BATCH)
    // skipDuplicates не поддержан SQLite — таблица выше очищена, дублей нет
    await prisma.atiCity.createMany({ data: batch })
    done += batch.length
    if (done % 25000 === 0) console.log(`[seed:ati-cities] ${done}…`)
  }

  const total = await prisma.atiCity.count()
  console.log(`[seed:ati-cities] Готово: всего в таблице ${total}`)
}

main()
  .catch((error) => {
    console.error("[seed:ati-cities] Ошибка:", error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
