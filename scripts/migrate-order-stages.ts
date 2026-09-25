// scripts/migrate-order-stages.ts
//
// Перенос заказов на единый канон жизненного цикла (задача 2):
//   Поиск → Согласование → Маршрут → Документы → Назначение → Контроль → Доставлен
//
// Что делает:
//   1. приводит прежние значения Order.status («new», «processing», «confirmed»,
//      «in_transit», «loading», «unloading», «completed» …) к канону из
//      lib/orders/stages.ts — по таблице LEGACY_ORDER_STATUS_MAP;
//   2. проставляет Order.negotiationStatus там, где он однозначно следует из этапа
//      (согласованные и прошедшие дальше → «agreed», отклонённые → «lost»,
//      идущее согласование → «in_progress»);
//   3. восстанавливает связь заказа со строкой накопленной базы ATI
//      (Order.atiCacheId) по sourceId — только если строка существует и в этой
//      организации нет другого заказа на ту же строку (уникальность
//      [organizationId, atiCacheId]);
//   4. сообщает о значениях статуса, которых нет ни в каноне, ни в таблице
//      переноса: такие строки не меняются, их нужно разобрать вручную.
//
// Деньги не выдумываются: agreedPrice остаётся пустым, пока его не укажет логист.
// Записи в ленту согласования (OrderNegotiation) скрипт не создаёт: это перенос
// данных, а не событие переговоров.
//
// Запуск:
//   npm run db:migrate-order-stages              сухой прогон (ничего не пишем)
//   npm run db:migrate-order-stages -- --apply   применить
//
// Порядок работ на живой базе:
//   1. резервная копия базы;
//   2. npm run db:generate && npm run db:push
//      (новые колонки Order + таблица OrderNegotiation);
//   3. npm run db:migrate-order-stages           (посмотреть, что изменится);
//   4. npm run db:migrate-order-stages -- --apply;
//   5. npm run db:migrate-order-stages           (убедиться, что переносить нечего).
//
// Скрипт идемпотентен: повторный запуск не находит прежних значений.

import "dotenv/config"

import { prisma } from "../lib/prisma"
import {
  LEGACY_ORDER_STATUS_MAP,
  ORDER_STATUSES,
  normalizeOrderStatus,
  orderStageLabel,
  orderStatusLabel,
  type OrderStatus,
} from "../lib/orders/stages"

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")

function log(message = "") {
  console.log(message)
}

function header(title: string) {
  log("")
  log(`═══ ${title} ${"═".repeat(Math.max(0, 60 - title.length))}`)
}

type OrderRow = {
  id: string
  status: string
  organizationId: string | null
  source: string | null
  sourceId: string | null
  atiCacheId: string | null
  negotiationStatus: string | null
}

/** Состояние переговоров, которое однозначно следует из этапа заказа. */
function negotiationStatusFor(status: OrderStatus): "agreed" | "lost" | "in_progress" | null {
  switch (status) {
    case "agreed":
    case "in_route":
    case "documents":
    case "assigned":
    case "control":
    case "delivered":
      return "agreed"
    case "rejected":
      return "lost"
    case "negotiation":
      return "in_progress"
    default:
      return null
  }
}

async function main() {
  header(
    APPLY ? "ПЕРЕНОС СТАТУСОВ ЗАКАЗОВ (применяем)" : "ПЕРЕНОС СТАТУСОВ ЗАКАЗОВ (сухой прогон)",
  )
  log(
    APPLY
      ? "Режим --apply: изменения будут записаны в базу."
      : "Режим сухого прогона: база не меняется. Чтобы применить — добавьте --apply.",
  )

  const orders = (await prisma.order.findMany({
    select: {
      id: true,
      status: true,
      organizationId: true,
      source: true,
      sourceId: true,
      atiCacheId: true,
      negotiationStatus: true,
    },
    orderBy: { createdAt: "asc" },
  })) as OrderRow[]

  log(`Заказов в базе: ${orders.length}`)
  if (orders.length === 0) {
    log("Переносить нечего.")
    return
  }

  // ── 1. Статусы ────────────────────────────────────────────────────────────
  const plan = new Map<string, { to: OrderStatus; count: number }>()
  const unknown = new Map<string, number>()
  const canonical = new Map<string, number>()

  for (const order of orders) {
    const raw = String(order.status ?? "")
    if ((ORDER_STATUSES as readonly string[]).includes(raw)) {
      canonical.set(raw, (canonical.get(raw) ?? 0) + 1)
      continue
    }
    const mapped = LEGACY_ORDER_STATUS_MAP[raw]
    if (mapped) {
      const entry = plan.get(raw) ?? { to: mapped, count: 0 }
      entry.count += 1
      plan.set(raw, entry)
      continue
    }
    unknown.set(raw, (unknown.get(raw) ?? 0) + 1)
  }

  header("1. СТАТУСЫ ЗАКАЗОВ")
  if (plan.size === 0) {
    log("Прежних значений статуса нет — перенос не требуется.")
  } else {
    log("Будут приведены к канону:")
    for (const [from, entry] of [...plan.entries()].sort((a, b) => b[1].count - a[1].count)) {
      log(
        `  • «${from}» → «${entry.to}» (${orderStatusLabel(entry.to)}, этап «${orderStageLabel(
          entry.to,
        )}») — ${entry.count} шт.`,
      )
    }
  }

  if (canonical.size > 0) {
    log("Уже в каноне:")
    for (const [status, count] of [...canonical.entries()].sort((a, b) => b[1] - a[1])) {
      log(`  • «${status}» (${orderStatusLabel(status)}) — ${count} шт.`)
    }
  }

  if (unknown.size > 0) {
    log("НЕИЗВЕСТНЫЕ ЗНАЧЕНИЯ (не меняем, нужно разобрать вручную):")
    for (const [status, count] of [...unknown.entries()].sort((a, b) => b[1] - a[1])) {
      log(`  • «${status || "(пусто)"}» — ${count} шт.`)
    }
  }

  // ── 2. Состояние переговоров ──────────────────────────────────────────────
  const negotiationPlan: {
    status: OrderStatus
    value: "agreed" | "lost" | "in_progress"
    ids: string[]
  }[] = []

  for (const order of orders) {
    const status = normalizeOrderStatus(order.status)
    if (!status) continue
    const expected = negotiationStatusFor(status)
    if (!expected || order.negotiationStatus === expected) continue
    let entry = negotiationPlan.find((item) => item.status === status && item.value === expected)
    if (!entry) {
      entry = { status, value: expected, ids: [] }
      negotiationPlan.push(entry)
    }
    entry.ids.push(order.id)
  }

  header("2. СОСТОЯНИЕ СОГЛАСОВАНИЯ (negotiationStatus)")
  if (negotiationPlan.length === 0) {
    log("Проставлять нечего.")
  } else {
    for (const entry of negotiationPlan) {
      log(
        `  • этап «${orderStatusLabel(entry.status)}» → negotiationStatus «${entry.value}» — ${entry.ids.length} шт.`,
      )
    }
  }

  // ── 3. Связь с накопленной базой ATI ──────────────────────────────────────
  const candidates = orders.filter(
    (order) =>
      !order.atiCacheId &&
      order.source === "ATI" &&
      typeof order.sourceId === "string" &&
      order.sourceId.length > 0,
  )

  const linkPlan: { id: string; atiCacheId: string }[] = []
  let missingCache = 0
  let duplicate = 0

  if (candidates.length > 0) {
    const cacheIds = [...new Set(candidates.map((order) => order.sourceId as string))]
    const existingCache = (await prisma.atiCache.findMany({
      where: { id: { in: cacheIds } },
      select: { id: true },
    })) as { id: string }[]
    const knownCacheIds = new Set(existingCache.map((row) => row.id))

    // уникальность [organizationId, atiCacheId]: одна строка базы — один заказ организации
    const taken = new Set(
      orders
        .filter((order) => order.atiCacheId)
        .map((order) => `${order.organizationId ?? ""}:${order.atiCacheId}`),
    )

    for (const order of candidates) {
      const cacheId = order.sourceId as string
      if (!knownCacheIds.has(cacheId)) {
        missingCache += 1
        continue
      }
      const key = `${order.organizationId ?? ""}:${cacheId}`
      if (taken.has(key)) {
        duplicate += 1
        continue
      }
      taken.add(key)
      linkPlan.push({ id: order.id, atiCacheId: cacheId })
    }
  }

  header("3. СВЯЗЬ ЗАКАЗОВ С БАЗОЙ ATI (atiCacheId)")
  if (candidates.length === 0) {
    log("Все заказы ATI уже связаны со строками базы (или таких заказов нет).")
  } else {
    log(`Кандидатов: ${candidates.length}`)
    log(`  • будет связано со строкой базы: ${linkPlan.length}`)
    log(`  • строки базы уже нет (кэш очищен): ${missingCache}`)
    log(`  • пропущено, в организации уже есть заказ на эту строку: ${duplicate}`)
  }

  // ── Итог ──────────────────────────────────────────────────────────────────
  header("ИТОГ")
  const statusTotal = [...plan.values()].reduce((sum, entry) => sum + entry.count, 0)
  const negotiationTotal = negotiationPlan.reduce((sum, entry) => sum + entry.ids.length, 0)
  const unknownTotal = [...unknown.values()].reduce((sum, count) => sum + count, 0)

  log(`Заказов всего: ${orders.length}`)
  log(`  • статус будет приведён к канону: ${statusTotal}`)
  log(`  • состояние согласования будет проставлено: ${negotiationTotal}`)
  log(`  • связь с базой ATI будет восстановлена: ${linkPlan.length}`)
  log(`  • неизвестных статусов (не трогаем): ${unknownTotal}`)

  if (!APPLY) {
    log("")
    log("СУХОЙ ПРОГОН: база не изменена. Для применения запустите:")
    log("  npm run db:migrate-order-stages -- --apply")
    return
  }

  header("ЗАПИСЬ")
  for (const [from, entry] of plan.entries()) {
    const result = await prisma.order.updateMany({
      where: { status: from },
      data: { status: entry.to },
    })
    log(`  • «${from}» → «${entry.to}»: обновлено ${result.count}`)
  }

  for (const entry of negotiationPlan) {
    const result = await prisma.order.updateMany({
      where: { id: { in: entry.ids }, status: entry.status },
      data: { negotiationStatus: entry.value },
    })
    log(
      `  • negotiationStatus «${entry.value}» для этапа «${entry.status}»: обновлено ${result.count}`,
    )
  }

  for (const item of linkPlan) {
    await prisma.order.updateMany({
      where: { id: item.id, atiCacheId: null },
      data: { atiCacheId: item.atiCacheId },
    })
  }
  if (linkPlan.length > 0) log(`  • atiCacheId восстановлен: ${linkPlan.length}`)

  header("ГОТОВО")
  log("Повторный запуск (без --apply) должен показать, что переносить нечего.")
}

main()
  .catch((error) => {
    console.error("[migrate-order-stages] Ошибка:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
