// scripts/ati-bruteforce-from-ids.ts
// Запуск:
//   npx ts-node scripts/ati-bruteforce-from-ids.ts 1 5000
//
// Скрипт:
//  - перебирает from.id батчами (по BATCH_SIZE),
//  - для каждого ID делает loads/search,
//  - пишет ДВА файла на батч:
//      from-<start>-<end>.json          — полный дамп
//      from-<start>-<end>-summary.json  — кратко: fromId -> главный город
//  - между батчами ждёт PAUSE_BETWEEN_BATCHES_MS

import "dotenv/config"
import * as fs from "fs/promises"

const ATI_TOKEN = process.env.ATI_TOKEN || ""
const ATI_API = "https://loads.ati.su/webapi/v1.0"

if (!ATI_TOKEN) {
  console.error("ATI_TOKEN is empty in env")
  process.exit(1)
}

const BATCH_SIZE = 500
const PAUSE_BETWEEN_BATCHES_MS = 10 * 1000 // 10 секунд между батчами

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function log(...args: any[]) {
  console.log(...args)
}

function collectFromCities(loads: any[]) {
  const counts: Record<string, number> = {}

  for (const load of loads) {
    const loc = load.loading?.location
    const name: string =
      loc?.city ||
      loc?.cityName ||
      load.route?.fromTitle ||
      "UNKNOWN"

    counts[name] = (counts[name] || 0) + 1
  }

  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

async function fetchLoadsByFromId(searchId: number) {
  const filter = {
    dates: { date_option: "today" as const },
    sorting_type: 2,
    from: {
      id: searchId,
      type: 1,
      radius: 0,
      exact_only: true,
    },
  }

  const res = await fetch(`${ATI_API}/loads/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ATI_TOKEN}`,
      Cookie: `sid=${ATI_TOKEN};`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0",
      Referer: "https://loads.ati.su/",
      Origin: "https://loads.ati.su",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      exclude_geo_dicts: true,
      page: 1,
      items_per_page: 30,
      filter,
    }),
  })

  const text = await res.text()
  let data: any
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = {}
  }

  const loads: any[] = data.loads || []
  return loads
}

async function processRange(start: number, end: number) {
  log(`\n=== Processing from.id in [${start}..${end}] ===`)

  const results: {
    fromId: number
    loadsTotal: number
    fromCities: { name: string; count: number }[]
  }[] = []

  const totalIds = end - start + 1

  for (let id = start; id <= end; id++) {
    try {
      const idx = id - start
      if (idx % 20 === 0) {
        const percent = ((idx / totalIds) * 100).toFixed(1)
        log(`  ID ${id} (${percent}%)`)
      }

      const loads = await fetchLoadsByFromId(id)
      if (!loads.length) {
        continue
      }

      const fromCities = collectFromCities(loads)
      results.push({
        fromId: id,
        loadsTotal: loads.length,
        fromCities,
      })

      await delay(400)
    } catch (e: any) {
      log("  Error for id", id, ":", e?.message || e)
      await delay(1000)
    }
  }

  const fullFile = `from-${start}-${end}.json`
  await fs.writeFile(fullFile, JSON.stringify(results, null, 2), {
    encoding: "utf8",
  })
  log(`  ➜ Saved full data to ${fullFile}`)

  const summary = results.map((row) => {
    const main = row.fromCities[0]
    const mainCity = main?.name ?? "UNKNOWN"
    const mainCount = main?.count ?? 0
    const share =
      row.loadsTotal > 0 ? +(mainCount / row.loadsTotal).toFixed(2) : 0

    return {
      fromId: row.fromId,
      mainCity,
      mainCount,
      loadsTotal: row.loadsTotal,
      share,
    }
  })

  const summaryFile = `from-${start}-${end}-summary.json`
  await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2), {
    encoding: "utf8",
  })
  log(`  ➜ Saved summary to ${summaryFile}`)
}

async function main() {
  const startArg = parseInt(process.argv[2] || "1", 10)
  const maxArg = parseInt(process.argv[3] || "500", 10)

  if (isNaN(startArg) || isNaN(maxArg) || startArg <= 0 || maxArg < startArg) {
    console.error(
      "Usage: ts-node scripts/ati-bruteforce-from-ids.ts <startId> <maxId>",
    )
    process.exit(1)
  }

  log(`Bruteforce from.id in range [${startArg}..${maxArg}]`)
  log(
    `Batch size = ${BATCH_SIZE}, pause between batches = ${
      PAUSE_BETWEEN_BATCHES_MS / 1000
    }s`,
  )

  for (
    let batchStart = startArg;
    batchStart <= maxArg;
    batchStart += BATCH_SIZE
  ) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, maxArg)

    await processRange(batchStart, batchEnd)

    if (batchEnd < maxArg) {
      log(
        `\n⏱  Waiting ${
          PAUSE_BETWEEN_BATCHES_MS / 1000
        } seconds before next batch...\n`,
      )
      await delay(PAUSE_BETWEEN_BATCHES_MS)
    }
  }

  log("\n✅ All batches done")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})