// scripts/ati-build-city-map-from-full.ts
// Запуск:
//   npx ts-node scripts/ati-build-city-map-from-full.ts
//
// Читает ВСЕ файлы вида from-<start>-<end>.json (полные дампы),
// строит карту:
//   city-all-ids.json  — город → список fromId с долей и количеством рейсов
//
// Важно: учитывает НЕ только главный город, а все из fromCities.

import * as fs from "fs/promises"
import * as path from "path"

interface FromCityStat {
  name: string
  count: number
}

interface FullRow {
  fromId: number
  loadsTotal: number
  fromCities: FromCityStat[]
}

async function main() {
  const dir = process.cwd()

  const files = (await fs.readdir(dir)).filter((name) =>
    /^from-\d+-\d+\.json$/i.test(name) && !name.includes("summary"),
  )

  if (!files.length) {
    console.error("Нет файлов from-*-*.json в текущей папке")
    process.exit(1)
  }

  console.log("Найдены полные файлы:", files.join(", "))

  const cityMap: Record<
    string,
    { fromId: number; share: number; loadsTotal: number; count: number }[]
  > = {}

  for (const file of files) {
    const fullPath = path.join(dir, file)
    const text = await fs.readFile(fullPath, "utf8")

    let arr: any
    try {
      arr = JSON.parse(text)
    } catch (e: any) {
      console.error("Ошибка парсинга файла", file, ":", e?.message || e)
      continue
    }

    if (!Array.isArray(arr)) continue

    for (const row of arr as FullRow[]) {
      const fromId = row.fromId
      const loadsTotal = row.loadsTotal || 0
      const fromCities = row.fromCities || []

      if (!fromId || !loadsTotal || !fromCities.length) continue

      for (const cityStat of fromCities) {
        const city = cityStat.name || "UNKNOWN"
        const count = cityStat.count || 0
        if (!count) continue

        const share = +(count / loadsTotal).toFixed(2)

        if (!cityMap[city]) {
          cityMap[city] = []
        }
        cityMap[city].push({
          fromId,
          share,
          loadsTotal,
          count,
        })
      }
    }
  }

  for (const city of Object.keys(cityMap)) {
    cityMap[city].sort((a, b) => {
      if (b.share !== a.share) return b.share - a.share
      return b.loadsTotal - a.loadsTotal
    })
  }

  const outFile = "city-all-ids.json"
  await fs.writeFile(outFile, JSON.stringify(cityMap, null, 2), {
    encoding: "utf8",
  })

  console.log("➜ Записан файл карты городов (по всем вхождениям):", outFile)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})