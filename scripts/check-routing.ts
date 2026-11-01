// scripts/check-routing.ts
//
// Проверка нового сборщика на РЕАЛЬНЫХ данных организации (dev-база).
//
// Зачем: тесты доказывают, что алгоритм считает оптимум на моделях, но не
// показывают, что данные организации вообще превращаются в маршрут. Этот
// скрипт проходит весь путь «база → адаптер → ядро → валидатор» и печатает
// результат так, как его увидит логист.
//
// Запуск:
//   npx ts-node --project scripts/tsconfig.seed.json \
//     -r ./scripts/register-path-alias.cjs -r dotenv/config \
//     scripts/check-routing.ts <organizationId>
//
// Без идентификатора берётся первая организация в базе.

import { prisma } from "@/lib/prisma"
import { planForOrganisation } from "@/lib/routing/service"

async function main() {
  const orgId = process.argv[2] || (await prisma.organization.findFirst({ select: { id: true } }))?.id
  if (!orgId) {
    console.log("в базе нет ни одной организации")
    return
  }
  console.log(`организация: ${orgId}\n`)

  const result = await planForOrganisation({ organisationId: orgId, source: "both" })

  console.log("готовность:", result.readiness.ok ? "можно строить" : "строить нельзя")
  for (const blocker of result.readiness.blockers) console.log("  ✖", blocker)
  for (const warning of result.readiness.warnings) console.log("  ! ", warning)

  console.log("\nпул:", {
    всего: result.summary.ordersInPool,
    пригодных: result.summary.ordersUsable,
    машин: result.summary.vehicles,
    геокодировано: result.summary.geocoded.length,
    мс: result.summary.elapsedMs,
  })
  for (const skipped of result.summary.skipped.slice(0, 5)) {
    console.log(`  пропущен ${skipped.id}: ${skipped.problems.join("; ")}`)
  }

  if (!result.plan) {
    console.log("\nплана нет — причины выше")
    return
  }

  for (const item of result.plan.perVehicle) {
    console.log(`\n=== ${item.vehicleId} ===`)
    if (!item.recommended) {
      console.log("  маршрута нет")
      for (const rejection of item.rejected.slice(0, 3)) {
        console.log(`   · ${rejection.orderId}: ${rejection.reason}`)
      }
      continue
    }
    const plan = item.recommended
    const hours = (plan.schedule.endAt.getTime() - plan.schedule.startAt.getTime()) / 3600000
    console.log("  заказы:", plan.orderIds.join(" → ") || "—")
    console.log(
      "  маршрут:",
      plan.stops
        .map(
          (stop) =>
            `${stop.kind === "load" ? "погрузка" : stop.kind === "unload" ? "выгрузка" : "база"} ${stop.place.city}`,
        )
        .join(" → "),
    )
    console.log(
      `  ${plan.economics.totalKm} км (порожним ${plan.economics.emptyKm}, ${Math.round(
        plan.economics.emptyShare * 100,
      )} %), ${Math.round(hours)} ч, смен ${plan.schedule.shifts}`,
    )
    console.log(
      `  выручка ${plan.economics.revenue} ₽ − топливо ${plan.economics.fuelRub} − водитель ${
        plan.economics.driverRub
      } − износ ${plan.economics.maintenanceRub} = ${plan.economics.netRub} ₽`,
    )
    console.log(
      `  достоверность: ${plan.confidence}, оптимум доказан: ${plan.exact ? "да" : "нет"}`,
    )
    for (const warning of plan.warnings) console.log("  ! ", warning)
    for (const assumption of plan.assumptions) console.log("  ~ ", assumption)
    console.log("  вариантов у машины:", item.variants.length)
  }

  const bad = result.plan.validations.filter((item) => !item.result.ok)
  console.log(
    `\nнезависимая проверка: ${result.plan.validations.length - bad.length} из ${
      result.plan.validations.length
    } маршрутов без нарушений`,
  )
  for (const item of bad) {
    console.log(`  ✖ ${item.planId}: ${item.result.issues.map((issue) => issue.message).join("; ")}`)
  }
}

main()
  .catch((error) => {
    console.error("ошибка проверки:", error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
