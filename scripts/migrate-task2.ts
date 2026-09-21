// scripts/migrate-task2.ts
//
// Перенос данных под схему задачи 2:
//   * Route — настоящая таблица (раньше рейс был «виртуальным»: строки Order
//     с одинаковым routeId);
//   * связь «водитель ↔ машина» хранится один раз — в Driver.vehicleId
//     (поле Vehicle.driverId удалено из схемы);
//   * Driver.vehicleType/vehiclePlate — кэш, который должен совпадать с машиной.
//
// Запуск:
//   npm run db:migrate-task2 -- --check     диагностика, ничего не пишем
//   npm run db:migrate-task2                применить (идемпотентно)
//   npm run db:migrate-task2 -- --no-recalc не пересчитывать существующие рейсы
//
// Скрипт безопасен для повторного запуска: уже созданные рейсы не дублируются,
// исправляются только реально расходящиеся данные.
//
// Порядок работ на живой базе:
//   1. резервная копия prisma/dev.db;
//   2. npm run db:push            (или npm run db:sql:routes, если db push нельзя);
//   3. npm run db:migrate-task2 -- --check;
//   4. npm run db:migrate-task2.

import "dotenv/config"

import * as fs from "fs"
import * as path from "path"

import { prisma } from "../lib/prisma"
import {
  buildRouteName,
  deriveRouteStatus,
  summarizeRoute,
  type RouteOrderLike,
} from "@/lib/routes/model"

/**
 * Снимок связи «машина → водитель» из Vehicle.driverId.
 *
 * Колонка Vehicle.driverId удаляется при `prisma db push`, а прочитать её
 * нужно ДО удаления. Поэтому при первом запуске (в том числе --check)
 * сохраняем пары в файл и, если колонки уже нет, берём данные из снимка.
 */
const SNAPSHOT_FILE = path.join(process.cwd(), "prisma", ".task2-vehicle-links.json")

type VehicleLink = { vehicleId: string; driverId: string }

const args = process.argv.slice(2)
const CHECK_ONLY = args.includes("--check")
const RECALC = !args.includes("--no-recalc")

type Report = {
  errors: string[]
  warnings: string[]
  done: string[]
}

const report: Report = { errors: [], warnings: [], done: [] }

const log = (msg: string) => console.log(msg)
const ok = (msg: string) => {
  report.done.push(msg)
  console.log(`  ✓ ${msg}`)
}
const warn = (msg: string) => {
  report.warnings.push(msg)
  console.log(`  ! ${msg}`)
}
const fail = (msg: string) => {
  report.errors.push(msg)
  console.log(`  ✗ ${msg}`)
}

/** Есть ли колонка в таблице (SQLite). Нужна, пока Vehicle.driverId ещё не удалён. */
async function hasColumn(table: string, column: string): Promise<boolean> {
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `PRAGMA table_info("${table}")`,
    )) as { name: string }[]
    return rows.some((r) => r.name === column)
  } catch {
    // не SQLite или нет прав — считаем, что колонки уже нет
    return false
  }
}

async function tableExists(table: string): Promise<boolean> {
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      table,
    )) as { name: string }[]
    return rows.length > 0
  } catch {
    return false
  }
}

function readSnapshot(): VehicleLink[] {
  try {
    const raw = fs.readFileSync(SNAPSHOT_FILE, "utf-8")
    const parsed = JSON.parse(raw) as { links?: VehicleLink[] }
    return Array.isArray(parsed.links) ? parsed.links : []
  } catch {
    return []
  }
}

async function collectVehicleLinks(
  vehicleHasDriverId: boolean,
): Promise<{ links: VehicleLink[]; source: "колонка" | "снимок" | "нет данных" }> {
  if (vehicleHasDriverId) {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT "id", "driverId" FROM "Vehicle" WHERE "driverId" IS NOT NULL`,
    )) as { id: string; driverId: string | null }[]

    const links = rows
      .filter((r) => Boolean(r.driverId))
      .map((r) => ({ vehicleId: r.id, driverId: r.driverId as string }))

    // сохраняем до того, как db push удалит колонку
    try {
      fs.writeFileSync(
        SNAPSHOT_FILE,
        `${JSON.stringify({ savedAt: new Date().toISOString(), links }, null, 2)}\n`,
        "utf-8",
      )
    } catch (e) {
      warn(`не удалось сохранить снимок связей (${e instanceof Error ? e.message : e})`)
    }

    return { links, source: "колонка" }
  }

  const links = readSnapshot()
  return { links, source: links.length > 0 ? "снимок" : "нет данных" }
}

type DriverRow = {
  id: string
  name: string
  phone: string
  vehicleId: string | null
  vehiclePlate: string | null
  vehicleType: string | null
}

type VehicleRow = { id: string; plate: string; type: string; capacity: number }

async function main() {
  log("")
  log(CHECK_ONLY ? "═══ Диапазон: только проверка (--check) ═══" : "═══ Миграция данных под схему задачи 2 ═══")
  log("")

  // ─────────────────────────── 0. готова ли схема ───────────────────────────
  log("0. Схема БД")
  if (!(await tableExists("Route"))) {
    fail(
      "Таблицы Route нет в базе. Сначала примените схему: `npm run db:push` " +
        "(или `npm run db:sql:routes`, если db push недоступен), затем повторите миграцию.",
    )
    return 1
  }
  ok("таблица Route на месте")

  const vehicleHasDriverId = await hasColumn("Vehicle", "driverId")
  if (vehicleHasDriverId) {
    warn(
      "Колонка Vehicle.driverId ещё существует — `prisma db push` не применялся до конца. " +
        "Миграция перенесёт из неё данные, но колонку нужно удалить через db push.",
    )
  } else {
    ok("Vehicle.driverId удалён (связь хранится только в Driver.vehicleId)")
  }

  const drivers = (await prisma.driver.findMany({
    orderBy: { name: "asc" },
  })) as unknown as DriverRow[]
  const vehicles = (await prisma.vehicle.findMany()) as unknown as VehicleRow[]
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]))

  // ─────────────────── 1. уникальность телефонов водителей ───────────────────
  log("")
  log("1. Телефоны водителей (Driver.phone теперь @unique)")
  const byPhone = new Map<string, DriverRow[]>()
  for (const d of drivers) {
    const phone = (d.phone || "").trim()
    if (!phone) continue
    const list = byPhone.get(phone) || []
    list.push(d)
    byPhone.set(phone, list)
  }
  const duplicates = [...byPhone.entries()].filter(([, list]) => list.length > 1)
  if (duplicates.length > 0) {
    for (const [phone, list] of duplicates) {
      fail(
        `телефон ${phone} встречается у ${list.length} водителей: ${list
          .map((d) => `${d.name} (${d.id})`)
          .join(", ")} — объедините или исправьте карточки, иначе db push упадёт`,
      )
    }
  } else {
    ok(`дублей нет (${byPhone.size} уникальных телефонов, водителей: ${drivers.length})`)
  }

  // ─────────────── 2. расхождения связи «водитель ↔ машина» ───────────────
  log("")
  log("2. Связь «водитель ↔ машина»")

  const { links: legacyLinks, source: linksSource } = await collectVehicleLinks(vehicleHasDriverId)
  log(`  данные о старом закреплении: ${legacyLinks.length} (источник: ${linksSource})`)

  const toFixFromVehicle: VehicleLink[] = []
  const conflicts: string[] = []
  const danglingLinks: string[] = []

  for (const link of legacyLinks) {
    const vehicle = vehicleById.get(link.vehicleId)
    const plate = vehicle?.plate || link.vehicleId
    const linked = drivers.find((d) => d.vehicleId === link.vehicleId)

    if (!linked) {
      // машина «помнит» водителя, а водитель — нет: переносим на сторону водителя
      const exists = drivers.some((d) => d.id === link.driverId)
      if (exists) {
        toFixFromVehicle.push(link)
      } else {
        danglingLinks.push(`машина ${plate}: driverId ${link.driverId} — такого водителя уже нет`)
      }
    } else if (linked.id !== link.driverId) {
      conflicts.push(
        `машина ${plate}: в Vehicle.driverId — ${link.driverId}, а в Driver.vehicleId — ${linked.id} (${linked.name})`,
      )
    }
  }

  for (const d of danglingLinks) {
    // не ошибка: ссылка устарела, данные не теряются (связь уже на стороне водителя)
    warn(`${d} — значение устарело и будет удалено вместе с колонкой`)
  }

  if (conflicts.length > 0) {
    for (const c of conflicts) {
      warn(`${c} — оставляем значение со стороны водителя (Driver.vehicleId — источник правды)`)
    }
  }

  // машина закреплена за несколькими водителями
  const byVehicle = new Map<string, DriverRow[]>()
  for (const d of drivers) {
    if (!d.vehicleId) continue
    const list = byVehicle.get(d.vehicleId) || []
    list.push(d)
    byVehicle.set(d.vehicleId, list)
  }
  const multi = [...byVehicle.entries()].filter(([, list]) => list.length > 1)
  for (const [vehicleId, list] of multi) {
    fail(
      `машина ${vehicleById.get(vehicleId)?.plate || vehicleId} закреплена за ${list.length} водителями: ${list
        .map((d) => d.name)
        .join(", ")} — оставьте одного`,
    )
  }

  // водитель ссылается на несуществующую машину
  const dangling = drivers.filter((d) => d.vehicleId && !vehicleById.has(d.vehicleId))
  for (const d of dangling) {
    fail(`водитель ${d.name} (${d.id}): vehicleId ${d.vehicleId} не найдена в списке машин`)
  }

  if (
    toFixFromVehicle.length === 0 &&
    conflicts.length === 0 &&
    multi.length === 0 &&
    dangling.length === 0 &&
    danglingLinks.length === 0
  ) {
    ok("расхождений нет")
  } else if (toFixFromVehicle.length > 0) {
    log(`  → к переносу из Vehicle.driverId: ${toFixFromVehicle.length}`)
  }

  // ─────────────────── 3. кэш vehicleType/vehiclePlate ───────────────────
  log("")
  log("3. Кэш номера/типа машины у водителей")
  const staleCache = drivers.filter((d) => {
    if (!d.vehicleId) return Boolean(d.vehiclePlate || d.vehicleType)
    const v = vehicleById.get(d.vehicleId)
    if (!v) return false
    return d.vehiclePlate !== v.plate || d.vehicleType !== v.type
  })
  if (staleCache.length === 0) {
    ok("кэш совпадает с данными машин")
  } else {
    for (const d of staleCache) {
      const v = d.vehicleId ? vehicleById.get(d.vehicleId) : null
      warn(
        `${d.name}: кэш «${d.vehiclePlate || "—"}/${d.vehicleType || "—"}», в машине «${
          v ? `${v.plate}/${v.type}` : "нет машины"
        }»`,
      )
    }
  }

  // ─────────────────────── 4. рейсы без строки Route ───────────────────────
  log("")
  log("4. Рейсы (Order.routeId → Route)")
  const orders = (await prisma.order.findMany({
    where: { routeId: { not: null } },
    orderBy: [{ routeSequence: "asc" }, { createdAt: "asc" }],
  })) as unknown as (RouteOrderLike & {
    id: string
    routeId: string
    assignedDriverId: string | null
    assignedVehicleId: string | null
    createdAt: Date
  })[]

  const existingRoutes = await prisma.route.findMany({ select: { id: true } })
  const existingRouteIds = new Set<string>(existingRoutes.map((r: { id: string }) => r.id))

  const grouped = new Map<string, typeof orders>()
  for (const o of orders) {
    const list = grouped.get(o.routeId) || []
    list.push(o)
    grouped.set(o.routeId, list)
  }

  const missing = [...grouped.keys()].filter((id) => !existingRouteIds.has(id))
  const orphanRoutes = [...existingRouteIds].filter((id) => !grouped.has(id))

  log(`  заказов с routeId: ${orders.length}, групп: ${grouped.size}, строк Route: ${existingRoutes.length}`)
  if (missing.length > 0) log(`  → требуется создать строк Route: ${missing.length}`)
  if (orphanRoutes.length > 0) warn(`рейсов без заказов: ${orphanRoutes.length} (останутся как есть)`)
  if (missing.length === 0) ok("все routeId уже имеют строку Route")

  if (CHECK_ONLY) {
    return finish()
  }

  // ─────────────────────────── 5. применяем правки ───────────────────────────
  log("")
  log("5. Применение")

  if (report.errors.length > 0) {
    fail("есть блокирующие ошибки (см. выше) — изменения не вносим")
    return finish()
  }

  await prisma.$transaction(async (tx) => {
    // 5.1 перенос связи из Vehicle.driverId (или из снимка) в Driver.vehicleId
    for (const fix of toFixFromVehicle) {
      await tx.driver.update({
        where: { id: fix.driverId },
        data: { vehicleId: fix.vehicleId },
      })
    }
    if (toFixFromVehicle.length > 0) {
      ok(`перенесено связей из Vehicle.driverId: ${toFixFromVehicle.length}`)
    }

    // 5.2 создание строк Route для исторических routeId
    let created = 0
    for (const routeId of missing) {
      const routeOrders = grouped.get(routeId) || []
      const summary = summarizeRoute(routeOrders)
      const first = routeOrders[0]
      const earliest = routeOrders.reduce<Date>(
        (min, o) => (o.createdAt && o.createdAt < min ? o.createdAt : min),
        routeOrders[0]?.createdAt || new Date(),
      )

      await tx.route.create({
        data: {
          id: routeId,
          name: buildRouteName(routeOrders) || null,
          status: deriveRouteStatus(
            routeOrders.map((o) => o.status),
          ),
          driverId: first?.assignedDriverId ?? null,
          vehicleId: first?.assignedVehicleId ?? null,
          totalDistance: summary.totalDistance || null,
          cargoWeight: summary.cargoWeight || null,
          cargoVolume: summary.cargoVolume || null,
          createdAt: earliest,
        },
      })
      created += 1
    }
    if (created > 0) ok(`создано рейсов: ${created}`)

    // 5.3 пересчёт существующих рейсов по их заказам
    if (RECALC && existingRoutes.length > 0) {
      let recalced = 0
      for (const routeId of grouped.keys()) {
        const routeOrders = grouped.get(routeId) || []
        const summary = summarizeRoute(routeOrders)
        const status = deriveRouteStatus(routeOrders.map((o) => o.status))
        const current = await tx.route.findUnique({
          where: { id: routeId },
          select: { status: true, totalDistance: true, cargoWeight: true, cargoVolume: true, name: true },
        })
        if (!current) continue

        // отмена — решение диспетчера, такой статус не пересчитываем
        const nextStatus = current.status === "cancelled" ? "cancelled" : status
        const name = buildRouteName(routeOrders) || current.name

        const changed =
          current.status !== nextStatus ||
          current.totalDistance !== (summary.totalDistance || null) ||
          current.cargoWeight !== (summary.cargoWeight || null) ||
          current.cargoVolume !== (summary.cargoVolume || null) ||
          current.name !== name

        if (changed) {
          await tx.route.update({
            where: { id: routeId },
            data: {
              status: nextStatus,
              name,
              totalDistance: summary.totalDistance || null,
              cargoWeight: summary.cargoWeight || null,
              cargoVolume: summary.cargoVolume || null,
            },
          })
          recalced += 1
        }
      }
      if (recalced > 0) ok(`пересчитано рейсов: ${recalced}`)
    }

    // 5.4 синхронизация кэша номера/типа у водителей
    let cacheFixed = 0
    for (const d of drivers) {
      const vehicle = d.vehicleId ? vehicleById.get(d.vehicleId) : null
      const plate = vehicle?.plate ?? null
      const type = vehicle?.type ?? null
      if (d.vehiclePlate !== plate || d.vehicleType !== type) {
        await tx.driver.update({
          where: { id: d.id },
          data: { vehiclePlate: plate, vehicleType: type },
        })
        cacheFixed += 1
      }
    }
    if (cacheFixed > 0) ok(`обновлён кэш номера/типа у водителей: ${cacheFixed}`)
  })

  return finish()
}

function finish(): number {
  log("")
  log("═══ Итог ═══")
  log(`  выполнено: ${report.done.length}, предупреждений: ${report.warnings.length}, ошибок: ${report.errors.length}`)

  if (report.errors.length > 0) {
    log("")
    log("Исправьте ошибки и запустите миграцию снова:")
    for (const e of report.errors) log(`  ✗ ${e}`)
    return 1
  }

  log("")
  log(
    CHECK_ONLY
      ? "Проверка завершена. Для применения: npm run db:migrate-task2"
      : "Миграция завершена. Проверьте разделы «Маршруты» и «Автопарк» в интерфейсе.",
  )

  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch(async (error) => {
    console.error("")
    console.error("Миграция упала:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
