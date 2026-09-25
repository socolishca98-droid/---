// lib/reports/insights.ts
//
// Разбор отчёта (задача 8): выводы и рекомендации по настоящим числам.
//
// Здесь нет ни языковой модели, ни ключей к внешним сервисам: правила считают
// отклонения, доли и пороги прямо по агрегатам. Поэтому такой разбор нельзя
// «попросить придумать» — каждая строка опирается на число, которое видно в
// отчёте выше, и на источник данных (журнал расходов рейса, оплаты, рейсы).
//
// Если появится внешний ИИ, этот модуль остаётся основой: правила дают факты,
// а модель — только язык. Ни один факт при этом не выдумывается.

import type { ReportResult } from "./aggregate"

export type InsightLevel = "risk" | "warn" | "ok" | "info"

export type Insight = {
  id: string
  level: InsightLevel
  title: string
  detail: string
  /** Что сделать — иначе это не разбор, а пересказ */
  action: string | null
  /** Где это видно в интерфейсе: название вкладки отчёта */
  source: string
}

export type InsightsInput = {
  report: ReportResult
  /** Заголовок периода для текста сводки */
  periodLabel: string
  companyName?: string | null
}

/** Проценты округляются до одного знака — так их видно и в отчёте, и в тексте. */
function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null
  return round(((current - previous) / Math.abs(previous)) * 100, 1)
}

export function formatMoney(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`
}

export function formatChange(value: number | null): string {
  if (value === null) return "нет данных для сравнения"
  if (value === 0) return "без изменений"
  const sign = value > 0 ? "+" : "−"
  return `${sign}${Math.abs(value).toLocaleString("ru-RU")}%`
}

/**
 * Правила разбора. Порядок — по важности: сначала то, что стоит денег прямо
 * сейчас (долги и убыточные рейсы), потом эффективность, потом итоги.
 */
export function buildInsights(input: InsightsInput): Insight[] {
  const { report, periodLabel, companyName } = input
  const { finance, previousFinance, payments, fleet, expensesByType, drivers, clients, orders } = report
  const insights: Insight[] = []

  const comparable = report.data.ordersInPeriod > 0 || report.data.expensesInPeriod > 0

  // ── Деньги, которые уже должны были прийти ────────────────────────────────
  if (payments.overdueRub > 0) {
    const worst = payments.overdueClients[0]
    insights.push({
      id: "payments-overdue",
      level: "risk",
      title: `Просроченная оплата: ${formatMoney(payments.overdueRub)}`,
      detail: worst
        ? `Дольше всех не платит ${worst.name}: ${formatMoney(worst.overdueRub)} (${worst.orders} заказ(ов)).`
        : "Есть заказы с истёкшим сроком оплаты.",
      action: "Откройте «Оплаты», отфильтруйте просроченные и отправьте напоминания одной кнопкой.",
      source: "Оплаты",
    })
  } else if (payments.paidRub > 0) {
    insights.push({
      id: "payments-clear",
      level: "ok",
      title: "Просрочек по оплате нет",
      detail: `Получено ${formatMoney(payments.paidRub)}${
        payments.avgDaysToPayment === null
          ? ""
          : `, оплачивают в среднем через ${payments.avgDaysToPayment} дн. после рейса`
      }.`,
      action: null,
      source: "Оплаты",
    })
  }

  if (payments.deferredRub > 0) {
    insights.push({
      id: "payments-deferred",
      level: "info",
      title: `Отсрочка: ${formatMoney(payments.deferredRub)}`,
      detail: "Срок оплаты ещё не наступил — деньги в пути, но не в кассе.",
      action: "Держите эти заказы на вкладке «С отсрочкой»: там видно, у кого срок ближе.",
      source: "Оплаты",
    })
  }

  // ── Прибыль и её изменение ───────────────────────────────────────────────
  const profitChange = percentChange(finance.profitRub, previousFinance.profitRub)

  if (comparable && finance.profitRub < 0) {
    insights.push({
      id: "profit-negative",
      level: "risk",
      title: `Период убыточен: ${formatMoney(finance.profitRub)}`,
      detail: `Выручка ${formatMoney(finance.revenueRub)} против расходов ${formatMoney(
        finance.expensesRub,
      )}.`,
      action: "Проверьте убыточные рейсы ниже — обычно причина в топливе и порожнем пробеге.",
      source: "Парк",
    })
  } else if (comparable) {
    insights.push({
      id: "profit-change",
      level: profitChange !== null && profitChange < -10 ? "warn" : "ok",
      title: `Прибыль ${formatMoney(finance.profitRub)} (${formatChange(profitChange)})`,
      detail: `Выручка ${formatMoney(finance.revenueRub)}, расходы ${formatMoney(
        finance.expensesRub,
      )}${finance.marginPercent === null ? "" : `, маржа ${finance.marginPercent}%`}.`,
      action:
        profitChange !== null && profitChange < -10
          ? "Сравните структуру расходов с прошлым периодом: что выросло, то и забрало прибыль."
          : null,
      source: "Финансы",
    })
  }

  // ── Доля маржи: тонкий или толстый период ───────────────────────────────
  if (comparable && finance.marginPercent !== null && finance.marginPercent < 15 && finance.profitRub >= 0) {
    insights.push({
      id: "margin-thin",
      level: "warn",
      title: `Тонкая маржа: ${finance.marginPercent}%`,
      detail: "После расходов остаётся меньше пятой части выручки — запаса на срыв рейса почти нет.",
      action: "Проверьте цены по направлениям из блока «Направления»: где-то тариф ниже себестоимости.",
      source: "Заказы",
    })
  }

  // ── Структура расходов ──────────────────────────────────────────────────
  const fuel = expensesByType.find((expense) => expense.type === "fuel")
  if (fuel && fuel.sharePercent !== null && fuel.sharePercent >= 45) {
    insights.push({
      id: "expenses-fuel",
      level: fuel.sharePercent >= 65 ? "warn" : "info",
      title: `Топливо — ${fuel.sharePercent}% расходов (${formatMoney(fuel.amountRub)})`,
      detail:
        finance.fuelPer100Km === null
          ? `Залито ${fuel.liters} л; расход на 100 км не посчитать — не хватает пробега по одометру.`
          : `Средний расход ${finance.fuelPer100Km} л/100 км, залито ${fuel.liters} л.`,
      action:
        fuel.sharePercent >= 65
          ? "Проверьте цены АЗС по чекам и расход на 100 км у отдельных машин: перерасход ищется там."
          : "Сравните расход по машинам — разница обычно в манере езды и состоянии двигателя.",
      source: "Расходы",
    })
  } else if (expensesByType.length === 0 && report.data.ordersInPeriod > 0) {
    insights.push({
      id: "expenses-empty",
      level: "warn",
      title: "Расходы рейсов не заведены",
      detail: "Заказы есть, а чеков по топливу нет — прибыль в отчёте завышена на всю сумму неизвестных расходов.",
      action: "Пусть водители фотографируют чеки в мобильном приложении: расход попадает в рейс автоматически.",
      source: "Расходы",
    })
  }

  // ── Машины ──────────────────────────────────────────────────────────────
  if (fleet.vehiclesTotal > 0 && fleet.idleVehicles.length > 0) {
    const share = fleet.utilizationPercent
    insights.push({
      id: "fleet-idle",
      level: fleet.idleVehicles.length >= fleet.vehiclesTotal ? "warn" : "info",
      title: `Простаивает машин: ${fleet.idleVehicles.length} из ${fleet.vehiclesTotal}`,
      detail: `${fleet.idleVehicles
        .slice(0, 5)
        .map((vehicle) => vehicle.plate)
        .join(", ")}${fleet.idleVehicles.length > 5 ? " и другие" : ""}${
        share === null ? "" : ` · загрузка парка ${share}%`
      }.`,
      action: "Простой — это лизинг и зарплата без выручки: проверьте, чего не хватает для загрузки.",
      source: "Парк",
    })
  }

  if (fleet.unprofitableRoutes.length > 0) {
    const worst = fleet.unprofitableRoutes[0]
    insights.push({
      id: "fleet-unprofitable",
      level: "risk",
      title: `Рейсы в минус: ${fleet.unprofitableRoutes.length}`,
      detail: `Худший — ${worst.name}: выручка ${formatMoney(worst.revenueRub)}, расходы ${formatMoney(
        worst.expensesRub,
      )}.`,
      action: "Пересчитайте тариф такого направления или откажитесь от него: рейс не отбивает своё.",
      source: "Парк",
    })
  }

  // ── Водители ────────────────────────────────────────────────────────────
  if (drivers.length >= 2) {
    const byProfit = [...drivers].sort((a, b) => b.profitRub - a.profitRub)
    const best = byProfit[0]
    const worst = byProfit[byProfit.length - 1]

    if (best.profitRub > 0 && worst.profitRub <= 0) {
      insights.push({
        id: "drivers-spread",
        level: "warn",
        title: "Убыточный водитель",
        detail: `${worst.name}: расходы ${formatMoney(worst.expensesRub)} при выручке ${formatMoney(
          worst.revenueRub,
        )}. Для сравнения ${best.name}: ${formatMoney(best.profitRub)} прибыли.`,
        action: "Смотрите чеки и маршруты этого водителя: обычно дело в порожнем пробеге или ценах АЗС.",
        source: "Водители",
      })
    } else {
      insights.push({
        id: "drivers-spread",
        level: "info",
        title: `Разброс прибыли между водителями: ${formatMoney(best.profitRub - worst.profitRub)}`,
        detail: `Лучший — ${best.name} (${formatMoney(best.profitRub)}), слабейший — ${
          worst.name
        } (${formatMoney(worst.profitRub)}).`,
        action: "Разница обычно объясняется расходом топлива и загрузкой обратного направления.",
        source: "Водители",
      })
    }
  }

  const lateDrivers = drivers.filter((driver) => driver.onTimePercent !== null && driver.onTimePercent < 80)
  if (lateDrivers.length > 0) {
    insights.push({
      id: "drivers-late",
      level: "warn",
      title: `Опоздания: ${lateDrivers.length} водител(я/ей)`,
      detail: lateDrivers
        .slice(0, 4)
        .map((driver) => `${driver.name} — ${driver.onTimePercent}% в срок`)
        .join(", "),
      action: "Опоздание — это штрафы и потерянные клиенты; разберите причины по хронологии рейсов.",
      source: "Водители",
    })
  }

  // ── Клиенты ─────────────────────────────────────────────────────────────
  if (clients.concentrationPercent !== null && clients.concentrationPercent >= 40) {
    const top = clients.top[0]
    insights.push({
      id: "clients-concentration",
      level: clients.concentrationPercent >= 60 ? "warn" : "info",
      title: `Зависимость от одного клиента: ${clients.concentrationPercent}%`,
      detail: `${top.name} даёт ${formatMoney(top.revenueRub)} из ${formatMoney(clients.totalRub)}.`,
      action: "Такой клиент может диктовать цены: ищите второго крупного заказчика на те же направления.",
      source: "Клиенты",
    })
  }

  // ── Своевременность доставок ────────────────────────────────────────────
  if (orders.onTimePercent !== null) {
    insights.push({
      id: "orders-ontime",
      level: orders.onTimePercent < 85 ? "warn" : "ok",
      title: `В срок доставлено: ${orders.onTimePercent}%`,
      detail: `${orders.onTimeCount} вовремя, ${orders.lateCount} с опозданием — там, где у заказа указан срок.`,
      action:
        orders.onTimePercent < 85
          ? "Проверьте, не закладываете ли слишком оптимистичный срок при согласовании."
          : null,
      source: "Заказы",
    })
  }

  // ── Направления: где зарабатываем, где нет ──────────────────────────────
  if (orders.topDirections.length >= 2) {
    const best = orders.topDirections[0]
    insights.push({
      id: "orders-directions",
      level: "info",
      title: `Главное направление: ${best.direction}`,
      detail: `${best.count} заказ(ов) на ${formatMoney(best.revenueRub)}${
        best.count ? ` · средний ${formatMoney(Math.round(best.revenueRub / best.count))}` : ""
      }.`,
      action: "Под это направление выгоднее ставить постоянную машину: экономите порожний пробег.",
      source: "Заказы",
    })
  }

  // ── Пустой период ───────────────────────────────────────────────────────
  if (!report.data.hasData) {
    insights.push({
      id: "no-data",
      level: "info",
      title: "За период нет данных",
      detail: `Рейсов, заказов и расходов за «${periodLabel}» в системе нет.`,
      action: "Выберите другой период — или проверьте, что рейсы закрываются в «Маршрутах».",
      source: "Финансы",
    })
  }

  return insights
}

/**
 * Текстовая сводка за период — для кнопки «Скачать» и для чтения целиком.
 * Пишется по тем же правилам, поэтому в ней нет ни одного числа, которого нет
 * в отчёте.
 */
export function buildReportText(input: InsightsInput): string {
  const { report, periodLabel, companyName } = input
  const { finance, previousFinance, payments, fleet, orders, expensesByType, drivers, clients } = report

  const lines: string[] = []
  const periodText = `${report.period.from.toLocaleDateString("ru-RU")} — ${report.period.to.toLocaleDateString(
    "ru-RU",
  )}`

  lines.push(`${companyName ? `${companyName}: ` : ""}отчёт за период «${periodLabel}» (${periodText})`)
  lines.push("")

  lines.push("ДЕНЬГИ")
  lines.push(`  Выручка: ${formatMoney(finance.revenueRub)} (${formatChange(percentChange(finance.revenueRub, previousFinance.revenueRub))} к прошлому периоду)`)
  lines.push(`  Расходы: ${formatMoney(finance.expensesRub)} (${formatChange(percentChange(finance.expensesRub, previousFinance.expensesRub))})`)
  lines.push(`  Прибыль: ${formatMoney(finance.profitRub)}${finance.marginPercent === null ? "" : `, маржа ${finance.marginPercent}%`}`)
  if (finance.costPerKmRub !== null) {
    lines.push(
      `  На километр: выручка ${finance.revenuePerKmRub} ₽, себестоимость ${finance.costPerKmRub} ₽ (пробег ${finance.distanceKm} км)`,
    )
  }
  lines.push("")

  lines.push("ЗАКАЗЫ")
  lines.push(`  Всего: ${finance.ordersCount}, доставлено: ${finance.deliveredCount}, отменено: ${finance.cancelledCount}`)
  lines.push(`  Средний чек: ${formatMoney(orders.avgPriceRub)}, среднее плечо: ${orders.avgDistanceKm} км`)
  if (orders.onTimePercent !== null) {
    lines.push(`  В срок: ${orders.onTimePercent}% (${orders.onTimeCount} из ${orders.onTimeCount + orders.lateCount})`)
  }
  for (const direction of orders.topDirections.slice(0, 5)) {
    lines.push(`  ${direction.direction}: ${direction.count} заказ(ов) на ${formatMoney(direction.revenueRub)}`)
  }
  lines.push("")

  lines.push("РАСХОДЫ")
  if (expensesByType.length === 0) {
    lines.push("  Расходов за период нет")
  } else {
    for (const expense of expensesByType) {
      lines.push(
        `  ${expense.label}: ${formatMoney(expense.amountRub)}${
          expense.sharePercent === null ? "" : ` (${expense.sharePercent}%)`
        }${expense.liters > 0 ? `, ${expense.liters} л` : ""}`,
      )
    }
  }
  lines.push("")

  if (drivers.length > 0) {
    lines.push("ВОДИТЕЛИ")
    for (const driver of drivers.slice(0, 10)) {
      lines.push(
        `  ${driver.name}: рейсов ${driver.routes}, заказов ${driver.orders}, выручка ${formatMoney(
          driver.revenueRub,
        )}, расходы ${formatMoney(driver.expensesRub)}, прибыль ${formatMoney(driver.profitRub)}${
          driver.onTimePercent === null ? "" : `, в срок ${driver.onTimePercent}%`
        }`,
      )
    }
    lines.push("")
  }

  if (report.vehicles.length > 0) {
    lines.push("МАШИНЫ")
    for (const vehicle of report.vehicles.slice(0, 10)) {
      lines.push(
        `  ${vehicle.plate}: рейсов ${vehicle.routes}, заказов ${vehicle.orders}, выручка ${formatMoney(
          vehicle.revenueRub,
        )}, расходы ${formatMoney(vehicle.expensesRub)}, прибыль ${formatMoney(vehicle.profitRub)}${
          vehicle.costPerKmRub === null ? "" : `, себестоимость ${vehicle.costPerKmRub} ₽/км`
        }`,
      )
    }
    lines.push("")
  }

  if (fleet.vehiclesTotal > 0) {
    lines.push("ПАРК")
    lines.push(
      `  Машин: ${fleet.vehiclesTotal}, в работе: ${fleet.vehiclesUsed}${
        fleet.utilizationPercent === null ? "" : ` (${fleet.utilizationPercent}%)`
      }`,
    )
    if (fleet.idleVehicles.length > 0) {
      lines.push(`  Простаивали: ${fleet.idleVehicles.map((vehicle) => vehicle.plate).join(", ")}`)
    }
    for (const route of fleet.unprofitableRoutes) {
      lines.push(
        `  Рейс в минус — ${route.name}: выручка ${formatMoney(route.revenueRub)}, расходы ${formatMoney(
          route.expensesRub,
        )}`,
      )
    }
    lines.push("")
  }

  lines.push("ОПЛАТЫ")
  lines.push(`  Получено: ${formatMoney(payments.paidRub)}`)
  lines.push(`  Ждём: ${formatMoney(payments.pendingRub + payments.deferredRub)} (в т.ч. отсрочка ${formatMoney(payments.deferredRub)})`)
  lines.push(`  Просрочено: ${formatMoney(payments.overdueRub)} по ${payments.overdueCount} заказ(ам)`)
  if (payments.avgDaysToPayment !== null) {
    lines.push(`  Средний срок оплаты: ${payments.avgDaysToPayment} дн. после рейса`)
  }
  if (payments.overdueClients.length > 0) {
    lines.push(
      `  Должники: ${payments.overdueClients
        .slice(0, 5)
        .map((client) => `${client.name} (${formatMoney(client.overdueRub)})`)
        .join(", ")}`,
    )
  }
  lines.push("")

  if (clients.top.length > 0) {
    lines.push("КЛИЕНТЫ")
    for (const client of clients.top.slice(0, 5)) {
      lines.push(
        `  ${client.name}: ${client.orders} заказ(ов) на ${formatMoney(client.revenueRub)}${
          client.debtRub > 0 ? `, долг ${formatMoney(client.debtRub)}` : ""
        }`,
      )
    }
    lines.push("")
  }

  lines.push("РАЗБОР")
  const insights = buildInsights(input)
  if (insights.length === 0) {
    lines.push("  Отклонений не найдено")
  } else {
    for (const insight of insights) {
      const mark = insight.level === "risk" ? "!" : insight.level === "warn" ? "▲" : "·"
      lines.push(`  ${mark} ${insight.title}`)
      lines.push(`    ${insight.detail}`)
      if (insight.action) lines.push(`    Что сделать: ${insight.action}`)
    }
  }

  lines.push("")
  lines.push(
    "Все числа посчитаны по данным системы: рейсы и заказы — из «Маршрутов» и «Заказов», расходы — из журнала расходов рейса (чеки водителей), оплаты — из «Оплат». Выводы сделаны правилами по этим числам, без внешних сервисов.",
  )

  return lines.join("\n")
}
