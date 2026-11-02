// scripts/check-plan.ts
//
// Проверка ТОГО ЖЕ пути, которым считает сервер: planForOrganisation().
//
// Зачем отдельно от routing:bases. Тот скрипт собирает пул сам (свои запросы,
// свои координаты) и вызывает planFleet — то есть проверяет ядро, но не
// сервисный слой. А на экране работает именно сервис: он берёт настройки
// организации, базу из карточки, пул ATI и заказов, догружает недостающие
// координаты, отбраковывает просроченное и только потом считает. Ошибка в этом
// слое (например, «нет координат» из-за отсутствующей колонки) видна только
// здесь — и именно поэтому грузы когда-то выпадали из плана, хотя ядро было
// исправно.
//
// Запуск (DATABASE_URL — рабочая база):
//   npm run routing:plan
//   npm run routing:plan -- <organizationId>
//   npm run routing:plan -- <organizationId> --vehicle <vehicleId>
//
// Скрипт только читает базу (кроме геокэша координат) и ничего не меняет.

import { planForOrganisation } from "@/lib/routing/service"
import { prisma } from "@/lib/prisma"

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}
const positional = argv.filter((item) => !item.startsWith("--") && item !== flag("--vehicle"))

const money = (value: number) => Math.round(value).toLocaleString("ru-RU")

async function main(): Promise<void> {
  const organisationId =
    positional[0] || (await prisma.organization.findFirst({ select: { id: true } }))?.id
  if (!organisationId) {
    console.log("в базе нет ни одной организации")
    return
  }

  // Горизонт и размер пула — как у эндпоинта по умолчанию (72 ч, 120 грузов),
  // иначе проверка меряет не то, что увидит логист.
  const poolLimit = Number(flag("--pool") ?? 120) || 120
  const result = await planForOrganisation({
    organisationId,
    vehicleId: flag("--vehicle"),
    poolLimit,
    // Координаты догружаем: это штатное поведение сервера, и проверять надо
    // именно его, а не «как было бы, если бы всё уже лежало в справочнике».
    geocodeMissing: true,
  })

  const { summary, readiness } = result
  console.log(`организация: ${organisationId}`)
  console.log(
    `пул: ${summary.ordersUsable} пригодных из ${summary.ordersInPool}, ` +
      `снято логистом ${summary.ordersExcluded}, машин ${summary.vehicles}, ` +
      `горизонт ${summary.horizonHours} ч, расчёт ${summary.elapsedMs} мс`,
  )
  if (summary.geocoded.length > 0) {
    console.log(`координаты добраны геокодером: ${summary.geocoded.join(", ")}`)
  }
  if (summary.skipped.length > 0) {
    const byProblem = new Map<string, number>()
    for (const item of summary.skipped) {
      for (const problem of item.problems) byProblem.set(problem, (byProblem.get(problem) ?? 0) + 1)
    }
    console.log("грузов не взято в расчёт:")
    for (const [problem, count] of [...byProblem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`  · ${problem} — ${count}`)
    }
  }

  if (!readiness.ok || !result.plan) {
    console.log("\nплана нет. Причины:")
    for (const blocker of readiness.blockers) console.log(`  ! ${blocker}`)
    for (const warning of readiness.warnings) console.log(`  ~ ${warning}`)
    return
  }

  console.log(`\nмашин в плане: ${result.plan.perVehicle.length}`)
  let built = 0
  let invalid = 0
  for (const item of result.plan.perVehicle) {
    const plan = item.recommended
    if (!plan) {
      const reasons = item.rejected.slice(0, 2).map((entry) => entry.reason)
      console.log(`  ${item.vehicleId}: маршрута нет — ${reasons.join("; ") || "причин не записано"}`)
      continue
    }
    built += 1
    const check = result.plan.validations.find((entry) => entry.planId === plan.id)
    if (check && !check.result.ok) invalid += 1
    console.log(
      `  ${item.vehicleId}: ${plan.model === "consolidated" ? "сборная" : "последовательная"}, ` +
        `грузов ${plan.orderIds.length}, ${Math.round(plan.economics.totalKm)} км ` +
        `(порожним ${Math.round(plan.economics.emptyKm)}, ${Math.round(plan.economics.emptyShare * 100)} %), ` +
        `календарь ${Math.round((plan.schedule.endAt.getTime() - plan.schedule.startAt.getTime()) / 3600000)} ч, ` +
        `выручка ${money(plan.economics.revenue)} ₽, остаток ${money(plan.economics.netCommittedRub)} ₽`,
    )
    // Остановка «домой» — не груз, у неё нет заказа: пишем словом, а не «null».
    const order = (id: string | null | undefined) => id ?? "домой"
    console.log(
      `    порядок: ${plan.stops
        .map((stop) => `${stop.kind === "load" ? "+" : stop.kind === "unload" ? "-" : "⟲"}${order(stop.orderId)}@${stop.place.city}`)
        .join(" ")}`,
    )
    console.log(
      `    оптимум: ${plan.exact ? "доказан" : "не доказан (перебор ограничен)"}, ` +
        `достоверность: ${plan.confidence}, проверка: ` +
        `${check ? (check.result.ok ? "без нарушений" : check.result.issues.map((i) => i.message).join("; ")) : "не выполнялась"}`,
    )
    if (plan.reasons.length > 0) console.log(`    почему так: ${plan.reasons.slice(0, 3).join(" | ")}`)
    if (plan.warnings.length > 0) console.log(`    предупреждения: ${plan.warnings.slice(0, 3).join(" | ")}`)
  }
  console.log(
    `\nитог: маршрутов ${built}, нарушений независимого валидатора ${invalid}` +
      (built === 0 ? " — плана нет, причины выше" : ""),
  )
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error("ошибка проверки:", error)
    await prisma.$disconnect()
    process.exit(1)
  })
