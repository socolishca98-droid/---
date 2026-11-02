// scripts/mass-check.ts
//
// МАССОВАЯ ПРОВЕРКА планировщика на рабочей базе.
//
// Зачем отдельно от routing:plan. Тот прогон отвечает на вопрос «что покажет
// логист этой организации прямо сейчас». Этот — на вопрос «а если сдвинуть
// условия»: другая организация, другая машина, другой размер пула, другой
// горизонт. Ошибка, которая вылезает только при пуле в 20 грузов или на
// горизонте в сутки, в обычном прогоне не видна.
//
// Что проверяется по каждому полученному плану (независимо друг от друга):
//   1. независимый валидатор ядра — вес и объём на каждом участке, порядок
//      погрузок/выгрузок, окна, возврат;
//   2. календарь не короче чистой езды (иначе пояса «съедают» время);
//   3. время в плане не идёт назад (ни в остановках, ни в событиях);
//   4. порожний пробег не больше общего, доли посчитаны верно;
//   5. заказы в плане не повторяются, все они из пула своей организации;
//   6. режим возврата соблюдён: «обязательно» — машина дома;
//   7. повторный расчёт с теми же входами даёт тот же маршрут (детерминизм);
//   8. убыточный план не выдаётся за рекомендацию.
//
// Плюс изоляция: планы одной организации не содержат заказов другой.
//
// Запуск (DATABASE_URL — рабочая база):
//   npm run routing:mass
//   npm run routing:mass -- --quick     (меньше сочетаний, быстрее)
//
// Скрипт только читает базу и ничего в ней не меняет.

import { prisma } from "@/lib/prisma"
import { settingsFromOrg, type FleetSettingsRow } from "@/lib/routing/adapter"
import { planForOrganisation } from "@/lib/routing/service"
import type { RoutePlan, Settings } from "@/lib/routing/types"

const argv = process.argv.slice(2)
const quick = argv.includes("--quick")

const POOL_LIMITS = quick ? [60] : [20, 60, 120]
const HORIZONS = quick ? [72] : [24, 72, 168]

interface Failure {
  where: string
  what: string
  detail: string
}

const failures: Failure[] = []
const fail = (where: string, what: string, detail: string) => failures.push({ where, what, detail })

const MS_HOUR = 3600000
const round = (value: number) => Math.round(value)

/** Подписи маршрута для сравнения двух прогонов: модель, порядок, километры. */
function signature(plan: RoutePlan): string {
  return [
    plan.model,
    plan.orderIds.join(">"),
    Math.round(plan.economics.totalKm),
    Math.round(plan.economics.netCommittedRub),
    plan.returned.kind,
  ].join("|")
}

/** Все проверки одного плана, кроме валидатора (он отдельно). */
function checkPlan(where: string, plan: RoutePlan, settings: Settings) {
  const calendarHours = (plan.schedule.endAt.getTime() - plan.schedule.startAt.getTime()) / MS_HOUR
  const drivingHours = plan.schedule.drivingHours

  // 2. Календарь не может быть короче чистой езды: смена пояса не создаёт время.
  if (calendarHours + 0.05 < drivingHours) {
    fail(where, "календарь короче езды", `${round(calendarHours * 10) / 10} ч < ${drivingHours} ч езды`)
  }

  // 3. Время не идёт назад.
  let previous = plan.schedule.startAt.getTime()
  for (const stop of plan.stops) {
    if (stop.arriveAt.getTime() < previous - 1000) {
      fail(where, "время остановок идёт назад", `${stop.kind}@${stop.place.city}`)
      break
    }
    if (stop.endAt.getTime() < stop.startAt.getTime()) {
      fail(where, "остановка кончается раньше, чем начинается", `${stop.kind}@${stop.place.city}`)
      break
    }
    previous = stop.endAt.getTime()
  }
  for (const event of plan.schedule.events) {
    if (event.at.getTime() < plan.schedule.startAt.getTime() - 1000) {
      fail(where, "событие раньше выезда", `${event.kind}@${event.place?.city ?? "—"}`)
      break
    }
  }

  // 4. Порожний пробег и доли.
  const economics = plan.economics
  if (economics.emptyKm < -1) fail(where, "отрицательный порожний пробег", `${economics.emptyKm} км`)
  if (economics.emptyKm > economics.totalKm + 1) {
    fail(where, "порожний пробег больше общего", `${economics.emptyKm} > ${economics.totalKm}`)
  }
  if (economics.loadedKm + economics.emptyKm > economics.totalKm + 2) {
    fail(where, "сумма пробегов больше общего", `${economics.loadedKm}+${economics.emptyKm} > ${economics.totalKm}`)
  }
  if (economics.emptyShare < -0.001 || economics.emptyShare > 1.001) {
    fail(where, "доля порожняка вне 0…1", String(economics.emptyShare))
  }

  // 5. Заказы: без повторов.
  const uniqueIds = new Set(plan.orderIds)
  if (uniqueIds.size !== plan.orderIds.length) {
    fail(where, "заказ повторяется в маршруте", plan.orderIds.join(","))
  }

  // 6. Режим возврата.
  if (settings.returnMode === "required" && plan.returned.kind === "none") {
    fail(where, "возврат обязателен, а машина не дома", "returned.kind = none")
  }

  // Пустой маршрут в выдаче — это не «нет рейса», а ошибка сборки.
  if (plan.orderIds.length === 0) {
    fail(where, "пустой маршрут", "в плане нет заказов")
  }
}

/** Идентификаторы заказов, которые принадлежат организации (по её пулу). */
async function ownOrderIds(organisationId: string): Promise<Set<string>> {
  const [ati, orders] = await Promise.all([
    prisma.atiCache.findMany({ where: { organizationId: organisationId }, select: { atiLoadId: true } }),
    prisma.order.findMany({ where: { organizationId: organisationId }, select: { id: true } }),
  ])
  return new Set([...ati.map((row) => row.atiLoadId), ...orders.map((row) => row.id)])
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  const organisations = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  })
  console.log(`организаций в базе: ${organisations.length}`)
  console.log(`сочетания: пул ${POOL_LIMITS.join("/")}, горизонт ${HORIZONS.join("/")} ч${quick ? " (быстрый режим)" : ""}\n`)

  const summary: Array<{
    organisation: string
    poolLimit: number
    horizonHours: number
    vehicles: number
    withPlan: number
    recommended: number
    consolidated: number
    invalid: number
    elapsedMs: number
  }> = []
  const orderOwners = new Map<string, string>()

  for (const organisation of organisations) {
    const settingsRow = (await prisma.fleetSettings.findFirst({
      where: { organizationId: organisation.id },
    })) as unknown as FleetSettingsRow | null
    const settings = settingsFromOrg(settingsRow)
    const own = await ownOrderIds(organisation.id)

    for (const poolLimit of POOL_LIMITS) {
      for (const horizonHours of HORIZONS) {
        const where = `${organisation.name.slice(0, 18)} / пул ${poolLimit} / ${horizonHours} ч`
        const one = { organisationId: organisation.id, poolLimit, horizonHours, geocodeMissing: false }
        const started = Date.now()
        const result = await planForOrganisation(one)
        const elapsed = Date.now() - started
        const second = await planForOrganisation(one)

        if (!result.plan) {
          console.log(
            `${where}: плана нет — ${result.readiness.blockers[0] ?? "причина не записана"} (${elapsed} мс)`,
          )
          failedBlocker(where, result.readiness.blockers)
          summary.push({
            organisation: organisation.name,
            poolLimit,
            horizonHours,
            vehicles: 0,
            withPlan: 0,
            recommended: 0,
            consolidated: 0,
            invalid: 0,
            elapsedMs: elapsed,
          })
          continue
        }

        let withPlan = 0
        let recommended = 0
        let consolidated = 0
        let invalid = 0

        for (const item of result.plan.perVehicle) {
          const plan = item.recommended
          if (!plan) continue
          withPlan += 1
          if (plan.model === "consolidated") consolidated += 1

          // Рекомендация не может быть убыточной — иначе «рекомендую в минус».
          if (plan.economics.netCommittedRub <= 0) {
            fail(where, "рекомендован убыточный рейс", `${item.vehicleId}: ${round(plan.economics.netCommittedRub)} ₽`)
          } else {
            recommended += 1
          }

          const at = `${where} / ${item.vehicleId}`
          // Независимый валидатор ядра: вес и объём на каждом участке, порядок
          // погрузок/выгрузок, окна, возврат.
          const validation = result.plan.validations.find((entry) => entry.planId === plan.id)
          if (validation && !validation.result.ok) {
            invalid += 1
            fail(at, "нарушение независимого валидатора", validation.result.issues.map((i) => i.message).join("; "))
          }
          // Календарь, время, пробеги, повторы заказов, режим возврата.
          checkPlan(at, plan, settings)
          // Изоляция: заказ обязан быть из пула СВОЕЙ организации.
          for (const id of plan.orderIds) {
            if (!own.has(id)) fail(at, "в плане заказ не из пула организации", id)
          }
        }

        // Детерминизм: те же входы — тот же маршрут по каждой машине.
        if (second.plan) {
          const first = new Map(
            result.plan.perVehicle.map((item) => [
              item.vehicleId,
              item.recommended ? signature(item.recommended) : "нет",
            ]),
          )
          for (const item of second.plan.perVehicle) {
            const before = first.get(item.vehicleId) ?? "нет"
            const after = item.recommended ? signature(item.recommended) : "нет"
            if (before !== after) {
              fail(where, "повторный расчёт дал другой маршрут", `${item.vehicleId}: ${before} ≠ ${after}`)
            }
          }
        }

        // Изоляция между организациями: один и тот же заказ не может оказаться
        // в планах двух разных организаций.
        for (const item of result.plan.perVehicle) {
          for (const id of item.recommended?.orderIds ?? []) {
            const owner = orderOwners.get(id)
            if (owner && owner !== organisation.id) {
              fail(where, "чужой заказ в плане", `${id} уже был у ${owner}`)
            }
            orderOwners.set(id, organisation.id)
          }
        }

        console.log(
          `${where}: машин ${result.plan.perVehicle.length}, с маршрутом ${withPlan} ` +
            `(сборных ${consolidated}), рекомендаций ${recommended}, нарушений ${invalid}, ` +
            `${elapsed} мс, пул ${result.summary.ordersUsable}/${result.summary.ordersInPool}`,
        )
        summary.push({
          organisation: organisation.name,
          poolLimit,
          horizonHours,
          vehicles: result.plan.perVehicle.length,
          withPlan,
          recommended,
          consolidated,
          invalid,
          elapsedMs: elapsed,
        })
      }
    }
  }

  // Отдельно: по каждой машине своей организации, на среднем пуле.
  const main = organisations[0]
  if (main) {
    const base = await planForOrganisation({ organisationId: main.id, poolLimit: 120, geocodeMissing: false })
    const vehicles = base.plan?.perVehicle.map((item) => item.vehicleId) ?? []
    console.log(`\nпо машинам (${main.name.slice(0, 20)}): ${vehicles.length}`)
    for (const vehicleId of vehicles) {
      const where = `${vehicleId}`
      const one = await planForOrganisation({
        organisationId: main.id,
        poolLimit: 120,
        vehicleId,
        geocodeMissing: false,
      })
      const plan = one.plan?.perVehicle[0]?.recommended ?? null
      if (!plan) {
        console.log(`  ${where}: маршрута нет — ${one.plan?.perVehicle[0]?.rejected[0]?.reason ?? "—"}`)
        continue
      }
      if (one.plan && one.plan.perVehicle.length !== 1) {
        fail(where, "фильтр по машине не сработал", `машин в плане ${one.plan.perVehicle.length}`)
      }
      const calendar = (plan.schedule.endAt.getTime() - plan.schedule.startAt.getTime()) / MS_HOUR
      console.log(
        `  ${where}: ${plan.model === "consolidated" ? "сборная" : "последовательная"}, ` +
          `грузов ${plan.orderIds.length}, ${round(plan.economics.totalKm)} км, ` +
          `календарь ${round(calendar)} ч, остаток ${round(plan.economics.netCommittedRub)} ₽`,
      )
      const mainSettingsRow = (await prisma.fleetSettings.findFirst({
        where: { organizationId: main.id },
      })) as unknown as FleetSettingsRow | null
      checkPlan(where, plan, settingsFromOrg(mainSettingsRow))
      const check = one.plan?.validations.find((entry) => entry.planId === plan.id)
      if (check && !check.result.ok) {
        fail(where, "нарушение независимого валидатора", check.result.issues.map((i) => i.message).join("; "))
      }
      if (plan.economics.netCommittedRub <= 0) {
        fail(where, "рекомендован убыточный рейс", `${round(plan.economics.netCommittedRub)} ₽`)
      }
    }
  }

  // ── Итог ──────────────────────────────────────────────────────────────────
  const runs = summary.length
  const totalPlans = summary.reduce((sum, row) => sum + row.withPlan, 0)
  const totalInvalid = summary.reduce((sum, row) => sum + row.invalid, 0)
  const slowest = summary.reduce((slow, row) => (row.elapsedMs > slow ? row.elapsedMs : slow), 0)
  console.log("\n── Итог массовой проверки ──")
  console.log(`прогонов: ${runs}, маршрутов: ${totalPlans}, нарушений валидатора: ${totalInvalid}`)
  console.log(`самый долгий расчёт: ${slowest} мс, всего ${Math.round((Date.now() - startedAt) / 1000)} с`)
  if (failures.length === 0) {
    console.log("замечаний нет")
  } else {
    const byKind = new Map<string, Failure[]>()
    for (const failure of failures) {
      const list = byKind.get(failure.what) ?? []
      list.push(failure)
      byKind.set(failure.what, list)
    }
    console.log(`замечаний: ${failures.length}`)
    for (const [what, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  · ${what} — ${list.length}`)
      for (const item of list.slice(0, 3)) console.log(`      ${item.where}: ${item.detail}`)
    }
  }
}

function failedBlocker(where: string, blockers: string[]) {
  // «Плана нет» — не всегда ошибка (у организации может не быть базы), но
  // причина обязана быть: пустой экран без объяснения — это дефект.
  if (blockers.length === 0) fail(where, "плана нет без причины", "blockers пуст")
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error("ошибка массовой проверки:", error)
    await prisma.$disconnect()
    process.exit(1)
  })
