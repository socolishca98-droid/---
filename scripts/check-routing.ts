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
    // Статьи печатаем только те, что реально заполнены. «водитель 0 ₽» —
    // это не «водитель работает бесплатно», а «в настройках организации
    // раздельной статьи нет: его оплата внутри ставки ₽/км». Писать ноль
    // рядом с работающей статьёй значит врать о структуре расходов.
    const articles: string[] = [`топливо ${plan.economics.fuelRub} ₽`]
    if (plan.economics.driverRub > 0) articles.push(`водитель ${plan.economics.driverRub} ₽`)
    if (plan.economics.maintenanceRub > 0) articles.push(`износ и ТО ${plan.economics.maintenanceRub} ₽`)
    if (plan.economics.tiresRub > 0) articles.push(`шины ${plan.economics.tiresRub} ₽`)
    if (plan.economics.otherRub > 0) articles.push(`прочее ${plan.economics.otherRub} ₽`)
    if (plan.economics.tollsRub !== null && plan.economics.tollsRub > 0) {
      articles.push(`платные дороги ${plan.economics.tollsRub} ₽`)
    }
    console.log(
      `  выручка ${plan.economics.revenue} ₽ − ${articles.join(" − ")} = ${plan.economics.netRub} ₽`,
    )
    // Платные дороги отдельной строкой: «неизвестны» — это не ноль в расчёте,
    // и ставить его в цепочку вычитания нельзя.
    if (plan.economics.tollsRub === null) console.log("  ~  платные участки не размечены — в остатке их нет")
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
