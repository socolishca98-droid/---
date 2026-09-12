// scripts/ati-merge-from-summaries.ts
// Запуск:
//   npx ts-node scripts/ati-merge-from-summaries.ts
//
// Делает две вещи:
// 1) Собирает все from-*-summary.json => один файл from-all-summary.json
// 2) Строит карту городов: city-main-ids.json,
//    где для каждого mainCity список fromId с долей и количеством рейсов.

import * as fs from "fs/promises"
import * as path from "path"

interface SummaryRow {
  fromId: number
  mainCity: string
  mainCount: number
  loadsTotal: number
  share: number
}

async function main() {
  const dir = process.cwd()
  const files = (await fs.readdir(dir)).filter((name) =>
    /^from-\d+-\d+-summary\.json$/i.test(name),
  )

  if (!files.length) {
    console.error("Нет файлов from-*-summary.json в текущей папке")
    process.exit(1)
  }

  console.log("Найдены summary-файлы:", files.join(", "))

  const all: SummaryRow[] = []

  for (const file of files) {
    const fullPath = path.join(dir, file)
    const text = await fs.readFile(fullPath, "utf8")
    try {
      const arr = JSON.parse(text)
      if (Array.isArray(arr)) {
        for (const row of arr) {
          if (
            typeof row.fromId === "number" &&
            typeof row.mainCity === "string"
          ) {
            all.push(row as SummaryRow)
          }
        }
      }
    } catch (e: any) {
      console.error("Ошибка парсинга файла", file, ":", e?.message || e)
    }
  }

  console.log("Всего записей (fromId):", all.length)

  const allSummaryFile = "from-all-summary.json"
  await fs.writeFile(
    allSummaryFile,
    JSON.stringify(all, null, 2),
    { encoding: "utf8" },
  )
  console.log("➜ Записан общий файл:", allSummaryFile)

  const cityMap: Record<
    string,
    { fromId: number; share: number; loadsTotal: number }[]
  > = {}

  for (const row of all) {
    const city = row.mainCity || "UNKNOWN"
    if (!cityMap[city]) {
      cityMap[city] = []
    }
    cityMap[city].push({
      fromId: row.fromId,
      share: row.share,
      loadsTotal: row.loadsTotal,
    })
  }

  for (const city of Object.keys(cityMap)) {
    cityMap[city].sort((a, b) => {
      if (b.share !== a.share) return b.share - a.share
      return b.loadsTotal - a.loadsTotal
    })
  }

  const cityMapFile = "city-main-ids.json"
  await fs.writeFile(
    cityMapFile,
    JSON.stringify(cityMap, null, 2),
    { encoding: "utf8" },
  )
  console.log("➜ Записан файл карты городов:", cityMapFile)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})