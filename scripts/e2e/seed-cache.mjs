// scripts/e2e/seed-cache.mjs — наполняет базу ATI (AtiCache) демо-грузами.
//
// Нужна, чтобы в песочнице заказов было что искать: заказы собираются из этих
// грузов кнопкой «Взять в работу». Пишем через встроенный node:sqlite — никаких
// зависимостей, скрипт работает и из репозитория, и из копии стенда.
//
// Запуск: node scripts/e2e/seed-cache.mjs [file:/path/dev.db]

import { DatabaseSync } from "node:sqlite"

const rawUrl = process.argv[2] ?? process.env.DATABASE_URL ?? "file:/tmp/e2e2/prisma/dev.db"
const dbPath = rawUrl.replace(/^file:/, "")

const db = new DatabaseSync(dbPath)
const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()

const loads = [
  ["seed-cache-1", "ATI-1001", "Москва", "Казань", 820, 20000, "Тент", 54000],
  ["seed-cache-2", "ATI-1002", "Казань", "Екатеринбург", 980, 18000, "Фура", 95000],
  ["seed-cache-3", "ATI-1003", "Москва", "Санкт-Петербург", 710, 15000, "Реф", 48000],
  ["seed-cache-4", "ATI-1004", "Екатеринбург", "Москва", 1780, 20000, "Тент", 128000],
  ["seed-cache-5", "ATI-1005", "Казань", "Москва", 820, 10000, "Изотерм", 32000],
]

db.exec("DELETE FROM AtiCache")

const insert = db.prepare(
  `INSERT INTO AtiCache
     (id, atiLoadId, routeFrom, routeTo, distance, weight, cargoType, truckType,
      price, priceType, vatIncluded, firmName, contactName, contactPhone,
      status, scannedAt, expiresAt)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'per_trip', 0, ?, ?, ?, 'new', ?, ?)`,
)

for (const [id, atiLoadId, from, to, distance, weight, truck, price] of loads) {
  insert.run(
    id,
    atiLoadId,
    from,
    to,
    distance,
    weight,
    "Генеральный груз",
    truck,
    price,
    "ООО «СтройТранс»",
    "+7 (900) 111-22-33",
    "+79001112233",
    iso(now),
    iso(now + 3 * 24 * 60 * 60 * 1000),
  )
}

const total = db.prepare("SELECT COUNT(*) AS n FROM AtiCache").get()
console.log(`грузов в базе ATI: ${total.n}`)
db.close()
