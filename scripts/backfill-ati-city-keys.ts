// scripts/backfill-ati-city-keys.ts
//
// ВОССТАНОВЛЕНИЕ УТРАЧЕННОГО scripts/backfill-ati-city-keys.mjs.
// На оригинальный .mjs ссылается комментарий в prisma/schema.prisma
// (AtiCity.nameKey), но сам файл не был закоммичен ни в одну ветку и
// потерян при сбросе среды. Эта замена делает то, что описано в схеме:
//   * nameKey — ключ поиска пункта по названию, считается НАСТОЯЩЕЙ
//     функцией cityLookupKey из lib/routing/geo/address.ts (без типа
//     пункта, без района в скобках, без регистра и ё);
//   * lat/lon — координаты из /home/user/ati-cities-ru.json
//     (офлайн-сопоставление GeoNames ↔ ATI, отчёт 120).
//
// Таблица AtiCity пересобирается целиком из того же источника, что и
// seed:ati-cities, — операция идемпотентна.
//
// Запуск: npx ts-node --project scripts/tsconfig.seed.json -r ./scripts/register-path-alias.cjs -r dotenv/config scripts/backfill-ati-city-keys.ts

import { readFileSync } from "node:fs"

import { prisma } from "../lib/prisma"
import { cityLookupKey } from "../lib/routing/geo/address"

const FILE = "/home/user/ati-cities-ru.json"

async function main(): Promise<void> {
  const raw: Record<string, { n?: string; r?: string; lat?: number; lon?: number }> =
    JSON.parse(readFileSync(FILE, "utf8"))

  const ids = Object.keys(raw).filter((id) => Number(id) > 0 && raw[id]?.n)
  console.log(`[backfill-ati-city-keys] записей в источнике: ${ids.length}`)

  const existing = await prisma.atiCity.count()
  if (existing > 0) {
    console.log(`[backfill-ati-city-keys] очищаю старые записи: ${existing}`)
    await prisma.atiCity.deleteMany({})
  }

  const BATCH = 5000
  let done = 0
  let coords = 0
  let keys = 0
  for (let i = 0; i < ids.length; i += BATCH) {
    const data = ids.slice(i, i + BATCH).map((id) => {
      const v = raw[id]
      const hasCoords = typeof v.lat === "number" && typeof v.lon === "number"
      if (hasCoords) coords += 1
      const key = cityLookupKey(v.n ?? "")
      if (key) keys += 1
      return {
        cityId: Number(id),
        name: String(v.n ?? ""),
        region: String(v.r ?? ""),
        lat: hasCoords ? v.lat! : null,
        lon: hasCoords ? v.lon! : null,
        nameKey: key || null,
      }
    })
    await prisma.atiCity.createMany({ data })
    done += data.length
    if (done % 25000 === 0) console.log(`[backfill-ati-city-keys] ${done}…`)
  }

  const total = await prisma.atiCity.count()
  console.log(`[backfill-ati-city-keys] готово: записей ${total}, с координатами ${coords}, с nameKey ${keys}`)
}

main()
  .catch((error) => {
    console.error("[backfill-ati-city-keys] ошибка:", error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
