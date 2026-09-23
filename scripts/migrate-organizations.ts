// scripts/migrate-organizations.ts
//
// Перенос существующих данных в модель «Организации»:
//   * создаёт организацию (по умолчанию — «ИП Фролов Иван Александрович»);
//   * проставляет organizationId всем записям бизнес-данных, у которых его нет;
//   * проверяет согласованность (водитель и его учётная запись в одной организации,
//     рейс и его заказы/этапы в одной организации);
//   * общие технические кэши (GeoCache, AtiCache, AtiSession) не трогает.
//
// Запуск:
//   npm run db:migrate-orgs -- --check          диагностика, ничего не пишем
//   npm run db:migrate-orgs                     применить (идемпотентно)
//   npm run db:migrate-orgs -- --name "ООО Ромашка"  другое название организации
//
// Порядок работ на живой базе:
//   1. резервная копия prisma/dev.db;
//   2. npm run db:push                       (колонки organizationId создаются как nullable);
//   3. npm run db:migrate-orgs -- --check;
//   4. npm run db:migrate-orgs;
//   5. npm run db:migrate-orgs -- --check    (убедиться, что пропусков не осталось).
//
// Колонки намеренно остаются nullable на уровне базы: в SQLite превращение
// существующей колонки в NOT NULL пересоздаёт таблицу. Обязательность
// обеспечивает код — lib/org.ts не пускает запрос без организации (403),
// а этот скрипт гарантирует, что пропусков в данных нет.

import "dotenv/config"

import { prisma } from "../lib/prisma"

const args = process.argv.slice(2)
const CHECK_ONLY = args.includes("--check")
const DEFAULT_ORG_NAME =
  process.env.DEFAULT_ORG_NAME || "ИП Фролов Иван Александрович"

function argValue(flag: string): string | null {
  const index = args.indexOf(flag)
  if (index >= 0 && args[index + 1]) return args[index + 1]
  const inline = args.find((a) => a.startsWith(`${flag}=`))
  return inline ? inline.slice(flag.length + 1) : null
}

const ORG_NAME = argValue("--name") || DEFAULT_ORG_NAME

function log(message = "") {
  console.log(message)
}

function header(title: string) {
  log("")
  log(`═══ ${title} ${"═".repeat(Math.max(0, 60 - title.length))}`)
}

/** Таблицы бизнес-данных, которые должны принадлежать организации. */
const TABLES = [
  { key: "user", label: "Пользователи", model: "user" },
  { key: "driver", label: "Водители", model: "driver" },
  { key: "vehicle", label: "Машины", model: "vehicle" },
  { key: "order", label: "Заказы", model: "order" },
  { key: "route", label: "Рейсы", model: "route" },
  { key: "routeStage", label: "Этапы рейсов", model: "routeStage" },
  { key: "routeEvent", label: "События рейсов", model: "routeEvent" },
  { key: "driverShift", label: "Смены", model: "driverShift" },
  { key: "shiftEvent", label: "События смен", model: "shiftEvent" },
  { key: "photo", label: "Фото", model: "photo" },
  { key: "maintenanceLog", label: "Журнал ТО", model: "maintenanceLog" },
  { key: "chatMessage", label: "Сообщения чата", model: "chatMessage" },
  { key: "notification", label: "Уведомления", model: "notification" },
  { key: "sosAlert", label: "SOS-сигналы", model: "sosAlert" },
  { key: "fleetSettings", label: "Настройки автопарка", model: "fleetSettings" },
  { key: "atiScanConfig", label: "Конфиги сканирования АТИ", model: "atiScanConfig" },
  { key: "auditLog", label: "Журнал аудита", model: "auditLog" },
] as const

type Delegate = {
  count: (args?: { where?: Record<string, unknown> }) => Promise<number>
  updateMany: (args: {
    where: Record<string, unknown>
    data: Record<string, unknown>
  }) => Promise<{ count: number }>
  findMany: (args?: Record<string, unknown>) => Promise<any[]>
}

function delegate(key: string): Delegate {
  return (prisma as any)[key] as Delegate
}

interface Row {
  label: string
  total: number
  missing: number
  updated: number
}

async function ensureOrganization(): Promise<{ id: string; name: string; created: boolean }> {
  const existing = await prisma.organization.findFirst({
    where: { name: ORG_NAME },
    orderBy: { createdAt: "asc" },
  })
  if (existing) {
    return { id: existing.id, name: existing.name, created: false }
  }

  if (CHECK_ONLY) {
    return { id: "(будет создана)", name: ORG_NAME, created: true }
  }

  const created = await prisma.organization.create({ data: { name: ORG_NAME } })
  return { id: created.id, name: created.name, created: true }
}

/** Все организации в базе — нужно, если пользователь уже завёл вторую. */
async function listOrganizations(): Promise<{ id: string; name: string }[]> {
  return prisma.organization.findMany({ orderBy: { createdAt: "asc" } })
}

async function countMissing(): Promise<Row[]> {
  const rows: Row[] = []
  for (const table of TABLES) {
    const model = delegate(table.model)
    const [total, missing] = await Promise.all([
      model.count(),
      model.count({ where: { organizationId: null } }),
    ])
    rows.push({ label: table.label, total, missing, updated: 0 })
  }
  return rows
}

async function fillOrganization(orgId: string, rows: Row[]): Promise<void> {
  for (let i = 0; i < TABLES.length; i++) {
    const table = TABLES[i]
    const model = delegate(table.model)
    if (CHECK_ONLY) continue
    const result = await model.updateMany({
      where: { organizationId: null },
      data: { organizationId: orgId },
    })
    rows[i].updated = result.count
  }
}

/**
 * Настройки автопарка: одна запись на организацию.
 *
 * Вызывается ДО заполнения organizationId: если в базе несколько записей без
 * организации, после заполнения они упрутся в @@unique([organizationId]).
 */
async function normalizeFleetSettings(orgId: string): Promise<string> {
  const all = await prisma.fleetSettings.findMany({ orderBy: { updatedAt: "desc" } })
  if (all.length === 0) {
    if (!CHECK_ONLY) {
      await prisma.fleetSettings.create({
        data: { organizationId: orgId, parkName: ORG_NAME },
      })
    }
    return CHECK_ONLY
      ? "настроек нет — будут созданы для организации"
      : "настроек не было — создана запись для организации"
  }

  const own = all.filter((s: any) => s.organizationId === orgId)
  const foreign = all.filter((s: any) => s.organizationId && s.organizationId !== orgId)
  const orphans = all.filter((s: any) => !s.organizationId)

  // лишние записи без организации: оставляем самую свежую, остальные удаляем
  const extraOrphans = orphans.slice(own.length > 0 ? 0 : 1)
  if (extraOrphans.length > 0 && !CHECK_ONLY) {
    for (const row of extraOrphans) {
      await prisma.fleetSettings.delete({ where: { id: row.id } })
    }
  }

  if (own.length > 1 && !CHECK_ONLY) {
    // больше одной записи на организацию быть не может (ограничение @@unique)
    const [keep, ...extra] = own
    for (const row of extra) {
      await prisma.fleetSettings.delete({ where: { id: row.id } })
    }
  }

  return [
    `записей: ${all.length} (своей организации: ${own.length}, чужих: ${foreign.length}, без организации: ${orphans.length})`,
    extraOrphans.length > 0
      ? CHECK_ONLY
        ? `будут удалены лишние записи без организации (${extraOrphans.length})`
        : `удалены лишние записи без организации (${extraOrphans.length})`
      : "",
    own.length > 1 ? `лишние записи организации удалены (${own.length - 1})` : "",
  ]
    .filter(Boolean)
    .join("; ")
}

/** Согласованность: связанные записи должны быть в одной организации. */
async function checkConsistency(): Promise<string[]> {
  const problems: string[] = []

  // учётная запись водителя и его карточка
  const usersWithDriver = await prisma.user.findMany({
    where: { driverId: { not: null } },
    select: { id: true, name: true, organizationId: true, driverId: true, driver: { select: { id: true, organizationId: true } } },
  })
  for (const user of usersWithDriver as any[]) {
    if (user.driver && user.driver.organizationId !== user.organizationId) {
      problems.push(
        `водитель ${user.name || user.id}: учётная запись в организации ${user.organizationId}, карточка — в ${user.driver.organizationId}`,
      )
    }
  }

  // заказы рейса
  const routes = await prisma.route.findMany({
    select: { id: true, name: true, organizationId: true, orders: { select: { id: true, organizationId: true } } },
  })
  for (const route of routes as any[]) {
    const foreign = (route.orders || []).filter((o: any) => o.organizationId !== route.organizationId)
    if (foreign.length) {
      problems.push(`рейс ${route.name || route.id}: ${foreign.length} заказов из другой организации`)
    }
  }

  // этапы и события рейса
  const stages = await prisma.routeStage.findMany({
    select: { id: true, organizationId: true, route: { select: { id: true, organizationId: true } } },
  })
  for (const stage of stages as any[]) {
    if (stage.route && stage.route.organizationId !== stage.organizationId) {
      problems.push(`этап ${stage.id}: организация не совпадает с рейсом`)
    }
  }

  // смены и их события
  const shifts = await prisma.driverShift.findMany({
    select: { id: true, organizationId: true, events: { select: { id: true, organizationId: true } } },
  })
  for (const shift of shifts as any[]) {
    const foreign = (shift.events || []).filter((e: any) => e.organizationId !== shift.organizationId)
    if (foreign.length) {
      problems.push(`смена ${shift.id}: ${foreign.length} событий из другой организации`)
    }
  }

  // машины: уникальность номера внутри организации
  const vehicles = await prisma.vehicle.findMany({
    select: { plate: true, organizationId: true },
  })
  const seen = new Map<string, number>()
  for (const v of vehicles as any[]) {
    const key = `${v.organizationId || "—"}|${String(v.plate || "").trim().toUpperCase()}`
    seen.set(key, (seen.get(key) || 0) + 1)
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      const [orgId, plate] = key.split("|")
      problems.push(`госномер ${plate} встречается ${count} раза в организации ${orgId}`)
    }
  }

  return problems
}

async function main(): Promise<number> {
  header(CHECK_ONLY ? "ПРОВЕРКА ПЕРЕНОСА В ОРГАНИЗАЦИИ" : "ПЕРЕНОС ДАННЫХ В ОРГАНИЗАЦИИ")
  log(`Организация: ${ORG_NAME}`)
  log(`Режим:       ${CHECK_ONLY ? "только проверка (--check)" : "применение изменений"}`)

  if (!CHECK_ONLY) {
    log("")
    log("Перед применением убедитесь, что есть резервная копия prisma/dev.db")
  }

  const organizations = await listOrganizations()
  header("Организации в базе")
  if (organizations.length === 0) {
    log(CHECK_ONLY ? "  пока нет — будет создана при применении" : "  пока нет")
  } else {
    for (const org of organizations) log(`  • ${org.name} (${org.id})`)
  }

  const org = await ensureOrganization()
  log("")
  log(
    org.created
      ? CHECK_ONLY
        ? `Будет создана организация «${org.name}»`
        : `Создана организация «${org.name}» → ${org.id}`
      : `Используется существующая организация «${org.name}» → ${org.id}`,
  )

  header("Настройки автопарка (чистим до заполнения)")
  log(`  ${await normalizeFleetSettings(org.id)}`)

  header("Заполнение organizationId")
  const rows = await countMissing()
  await fillOrganization(org.id, rows)

  log("  Таблица                     Всего     Без орг.   Обновлено")
  let totalMissing = 0
  let totalUpdated = 0
  for (const row of rows) {
    totalMissing += row.missing
    totalUpdated += row.updated
    log(
      `  ${row.label.padEnd(27)} ${String(row.total).padStart(6)} ${String(row.missing).padStart(11)} ${String(
        CHECK_ONLY ? "—" : row.updated,
      ).padStart(11)}`,
    )
  }
  log("")
  log(
    CHECK_ONLY
      ? `  Итого записей без организации: ${totalMissing}`
      : `  Итого заполнено: ${totalUpdated} (до переноса без организации: ${totalMissing})`,
  )

  header("Согласованность данных")
  const problems = await checkConsistency()
  if (problems.length === 0) {
    log("  расхождений не найдено")
  } else {
    for (const problem of problems) log(`  ! ${problem}`)
  }

  header("Итог")
  const after = await countMissing()
  const stillMissing = after.reduce((sum, row) => sum + row.missing, 0)
  log(`  Записей без организации после переноса: ${stillMissing}`)

  if (stillMissing > 0) {
    log("  ⚠ остались незаполненные записи — запустите миграцию повторно")
    return 1
  }
  if (problems.length > 0) {
    log("  ⚠ есть расхождения между связанными записями — проверьте список выше")
    return 1
  }

  log("")
  log(
    CHECK_ONLY
      ? "Проверка завершена. Для применения: npm run db:migrate-orgs"
      : "Перенос завершён. Все бизнес-данные принадлежат одной организации.",
  )
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error("")
    console.error("Перенос упал:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
