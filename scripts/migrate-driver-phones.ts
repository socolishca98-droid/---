// scripts/migrate-driver-phones.ts
//
// Перенос телефонов водителей и их учётных записей на канонический вид.
//
// Зачем: телефон водителя — это одновременно ключ уникальности карточки
// (Driver.phone @unique) и логин в приложение (lib/auth/login.ts ищет учётку по
// normalizePhone). Пока в базе лежали номера «как ввели» («+7 (900) 111-22-33»,
// «8-900-111-22-33», «79001112233»), один и тот же человек считался разными
// людьми: уникальность не срабатывала, вход не находил карточку, а логист видел
// в автопарке дубли. Новые записи роуты пишут каноническими
// (app/api/drivers/route.ts), этот скрипт приводит к тому же виду старые.
//
// Что делает:
//   1. Driver.phone → только цифры, ведущая 8 заменяется на 7;
//   2. User.phone   → то же (учётки водителей и сотрудников, где телефон заполнен);
//   3. номера, которые не похожи на телефон (меньше 10 цифр), НЕ трогает и
//      выводит списком — их разбирает человек;
//   4. если после приведения две карточки (или две учётки) заняли бы один номер,
//      такие строки тоже не трогаются: база всё равно ответит нарушением
//      уникальности, а решать, кто из двух людей настоящий, должен логист;
//   5. отдельно показывает пары «карточка водителя ↔ её учётка», у которых номера
//      расходятся: под таким номером водитель войти не сможет.
//
// Запуск:
//   npm run db:migrate-driver-phones              сухой прогон (ничего не пишем)
//   npm run db:migrate-driver-phones -- --apply   применить
//
// Порядок работ на живой базе:
//   1. резервная копия базы;
//   2. npm run db:migrate-driver-phones            (посмотреть план);
//   3. разобрать конфликты вручную, если они есть;
//   4. npm run db:migrate-driver-phones -- --apply;
//   5. npm run db:migrate-driver-phones            (убедиться, что менять нечего).
//
// Скрипт идемпотентен: повторный запуск не находит неканонических номеров.

import "dotenv/config"

import { prisma } from "../lib/prisma"
import { normalizePhone } from "../lib/auth/constants"
import { formatPhone } from "../lib/ui/phone"

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")

/** Номер похож на телефон: не меньше 10 цифр. Всё остальное — на разбор человеку. */
const MIN_DIGITS = 10

function log(message = "") {
  console.log(message)
}

function header(title: string) {
  log("")
  log(`═══ ${title} ${"═".repeat(Math.max(0, 60 - title.length))}`)
}

type PhoneRow = {
  id: string
  name: string
  phone: string | null
  organizationId: string | null
}

type Plan = {
  /** строки, которые приводим к канону */
  changes: { id: string; from: string; to: string; name: string }[]
  /** значения, не похожие на номер: не трогаем, показываем человеку */
  unrecognized: { id: string; value: string; name: string }[]
  /** разные записи, которые после приведения заняли бы один номер */
  conflicts: { canonical: string; rows: { id: string; name: string; from: string }[] }[]
}

function planFor(rows: PhoneRow[]): Plan {
  const plan: Plan = { changes: [], unrecognized: [], conflicts: [] }
  const byCanonical = new Map<string, { id: string; name: string; from: string; canonical: boolean }[]>()

  for (const row of rows) {
    const raw = (row.phone ?? "").trim()
    if (!raw) continue

    const canonical = normalizePhone(raw)
    if (canonical.length < MIN_DIGITS) {
      plan.unrecognized.push({ id: row.id, value: raw, name: row.name })
      continue
    }

    const alreadyCanonical = canonical === raw
    const bucket = byCanonical.get(canonical) ?? []
    bucket.push({ id: row.id, name: row.name, from: raw, canonical: alreadyCanonical })
    byCanonical.set(canonical, bucket)

    if (!alreadyCanonical) plan.changes.push({ id: row.id, from: raw, to: canonical, name: row.name })
  }

  for (const [canonical, bucket] of byCanonical) {
    if (bucket.length > 1) {
      plan.conflicts.push({
        canonical,
        rows: bucket.map(({ id, name, from }) => ({ id, name, from })),
      })
    }
  }

  return plan
}

/** План правок без конфликтующих номеров: конфликты решает человек. */
function safeChanges(plan: Plan): Plan["changes"] {
  const conflicted = new Set(plan.conflicts.flatMap((conflict) => conflict.rows.map((row) => row.id)))
  return plan.changes.filter((change) => !conflicted.has(change.id))
}

function reportPlan(title: string, plan: Plan) {
  header(title)

  const changes = safeChanges(plan)
  log(`  к каноническому виду: ${changes.length}`)
  for (const change of changes.slice(0, 20)) {
    log(`    • ${change.name}: «${change.from}» → «${change.to}»`)
  }
  if (changes.length > 20) log(`    … и ещё ${changes.length - 20}`)

  if (plan.conflicts.length > 0) {
    log("")
    log(`  КОНФЛИКТЫ (не меняем, нужен человек): ${plan.conflicts.length}`)
    for (const conflict of plan.conflicts) {
      log(`    • ${formatPhone(conflict.canonical)} — ${conflict.rows.length} записи:`)
      for (const row of conflict.rows) log(`        – ${row.name} (${row.id}), сейчас «${row.from}»`)
    }
  }

  if (plan.unrecognized.length > 0) {
    log("")
    log(`  НЕ ПОХОЖЕ НА НОМЕР (не меняем): ${plan.unrecognized.length}`)
    for (const item of plan.unrecognized.slice(0, 20)) {
      log(`    • ${item.name} (${item.id}): «${item.value}»`)
    }
    if (plan.unrecognized.length > 20) log(`    … и ещё ${plan.unrecognized.length - 20}`)
  }

  return changes
}

async function applyChanges(
  update: (id: string, phone: string) => Promise<{ count: number }>,
  changes: Plan["changes"],
  label: string,
) {
  if (changes.length === 0) {
    log(`  ${label}: менять нечего`)
    return
  }
  let updated = 0
  for (const change of changes) {
    const result = await update(change.id, change.to)
    updated += result.count
  }
  log(`  ${label}: обновлено ${updated} из ${changes.length}`)
}

async function main() {
  header(APPLY ? "ПЕРЕНОС ТЕЛЕФОНОВ (применяем)" : "ПЕРЕНОС ТЕЛЕФОНОВ (сухой прогон)")
  log("Канон: только цифры, ведущая 8 → 7. На нём держится уникальность карточки и вход водителя.")

  const drivers = await prisma.driver.findMany({
    select: { id: true, name: true, phone: true, organizationId: true },
    orderBy: { name: "asc" },
  })
  const users = await prisma.user.findMany({
    where: { phone: { not: null } },
    select: { id: true, name: true, phone: true, organizationId: true, role: true, driverId: true },
    orderBy: { name: "asc" },
  })

  const driverPlan = planFor(drivers)
  const userPlan = planFor(users)

  const driverChanges = reportPlan(`КАРТОЧКИ ВОДИТЕЛЕЙ (${drivers.length})`, driverPlan)
  const userChanges = reportPlan(`УЧЁТНЫЕ ЗАПИСИ С ТЕЛЕФОНОМ (${users.length})`, userPlan)

  // Расхождение «карточка ↔ её учётка»: вход ищется по номеру учётки, поэтому
  // под номером карточки такой водитель войти не сможет.
  header("РАСХОЖДЕНИЯ «КАРТОЧКА ↔ УЧЁТКА»")
  const canonicalOf = (value: string | null) => {
    const digits = normalizePhone(value ?? "")
    return digits.length >= MIN_DIGITS ? digits : (value ?? "").trim()
  }
  const driverById = new Map(drivers.map((driver: any) => [driver.id, driver]))
  const mismatched = users.filter((user: any) => {
    if (!user.driverId) return false
    const driver = driverById.get(user.driverId) as any
    if (!driver) return false
    return canonicalOf(driver.phone) !== canonicalOf(user.phone)
  })
  if (mismatched.length === 0) {
    log("  расхождений нет: номер карточки совпадает с номером входа")
  } else {
    log(`  ${mismatched.length} — требуется решение человека (сброс пароля или правка номера):`)
    for (const user of mismatched.slice(0, 20)) {
      const driver = driverById.get(user.driverId as string) as any
      log(
        `    • ${user.name}: учётка «${user.phone}», карточка «${driver?.phone}» (${driver?.name})`,
      )
    }
    if (mismatched.length > 20) log(`    … и ещё ${mismatched.length - 20}`)
  }

  if (!APPLY) {
    header("СУХОЙ ПРОГОН")
    log("Ничего не записано. Чтобы применить: npm run db:migrate-driver-phones -- --apply")
    return
  }

  header("ЗАПИСЬ")
  await applyChanges(
    (id, phone) => prisma.driver.updateMany({ where: { id }, data: { phone } }),
    driverChanges,
    "карточки водителей",
  )
  await applyChanges(
    (id, phone) => prisma.user.updateMany({ where: { id }, data: { phone } }),
    userChanges,
    "учётные записи",
  )

  header("ГОТОВО")
  log("Повторный запуск (без --apply) должен показать, что менять нечего.")
}

main()
  .catch((error) => {
    console.error("[migrate-driver-phones] Ошибка:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
