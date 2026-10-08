// lib/logist-mobile/route-flow.ts
//
// Туннель рейса: что это за рейс, что в нём дальше делать и сколько он принёс.
//
// Логика чистая (без Next, без Prisma, без React) — её проверяют юнит-тесты
// tests/logist-mobile-route-flow.test.mjs, а экраны /lm/routes и /lm/routes/[id]
// только рисуют то, что здесь посчитано. Так список, карточка и помощник
// сборки говорят об одном и том же одними словами.
//
// Что здесь есть:
//   routeStageLabel     — статус рейса словами (как в компьютерной версии);
//   routeOrderProgress  — сколько точек уже доставлено, сколько в пути;
//   routeNextStep       — следующий шаг логиста и кнопка для него;
//   routeListHint       — то же одной строкой для списка;
//   routeWaypoints      — маршрут по точкам: «Москва → Тула → Воронеж»;
//   routeMoney          — деньги рейса: выручка, расходы, прибыль, ₽/км;
//   routeTotals         — итоги рейса: заказы, километры, вес, выручка.

import { isOrderClosed, normalizeOrderStatus } from "../orders/stages"
import { plural } from "./format"

/**
 * Заказ реально едет: машина в дороге или на выгрузке.
 * Это не то же самое, что MOVING_ORDER_STATUSES в доменной модели
 * (там «движение» = «на контроле» для холста сборки): логисту в карточке рейса
 * нужно простыми словами — «уже везут», «ещё не выехали», «доставлено».
 */
const ON_THE_ROAD_ORDER_STATUSES = ["in_route", "control"] as const

// ---------------------------------------------------------------------------
// Вход
// ---------------------------------------------------------------------------

export interface RouteFlowOrder {
  id: string
  status: string
  routeFrom: string
  routeTo: string
  clientName?: string | null
  cargoType?: string | null
  weight?: number | null
  volume?: number | null
  price?: number | null
  agreedPrice?: number | null
  routeSequence?: number | null
  distance?: number | null
}

/** Экономика рейса — то, что считает lib/routes/economics.ts */
export interface RouteMoneyInput {
  revenueRub?: number | null
  factCostRub?: number | null
  estimatedCostRub?: number | null
  profitRub?: number | null
  rubPerKmRevenue?: number | null
  costPerKm?: number | null
  unprofitable?: boolean
  basis?: string | null
}

export interface RouteFlowInput {
  status: string
  driverId?: string | null
  driverName?: string | null
  vehicleId?: string | null
  vehiclePlate?: string | null
  startedAt?: string | null
  completedAt?: string | null
  orders: readonly RouteFlowOrder[]
  economics?: RouteMoneyInput | null
  distanceKm?: number | null
}

// ---------------------------------------------------------------------------
// Статус и прогресс
// ---------------------------------------------------------------------------

/**
 * Статус рейса словами — теми же, что в компьютерной версии
 * (lib/routes/model.ts ROUTE_STATUS_LABELS). Здесь те же слова, потому что
 * логист ходит между телефоном и компьютером и не должен переводить в голове.
 */
export function routeStageLabel(status: string): string {
  switch (status) {
    case "planned":
      return "Запланирован"
    case "active":
      return "Назначен"
    case "in_transit":
    case "in_progress":
      return "В пути"
    case "completed":
      return "Завершён"
    case "cancelled":
      return "Отменён"
    case "draft":
      return "Черновик"
    default:
      return status
  }
}

export interface RouteProgress {
  total: number
  /** Доставлено (или закрыто иным способом) */
  delivered: number
  /** В движении: в пути, на выгрузке, на контроле */
  moving: number
  /** Ещё не начали: ждёт машину, согласование, документы */
  awaiting: number
}

/** Сколько в рейсе точек и на каком они этапе. */
export function routeOrderProgress(orders: readonly RouteFlowOrder[]): RouteProgress {
  const list = Array.isArray(orders) ? orders : []
  let delivered = 0
  let moving = 0

  for (const order of list) {
    const status = normalizeOrderStatus(order.status) ?? order.status
    if (isOrderClosed(status)) delivered += 1
    else if ((ON_THE_ROAD_ORDER_STATUSES as readonly string[]).includes(status)) moving += 1
  }

  return {
    total: list.length,
    delivered,
    moving,
    awaiting: list.length - delivered - moving,
  }
}

// ---------------------------------------------------------------------------
// Следующий шаг
// ---------------------------------------------------------------------------

export interface RouteStepAction {
  /** start — зафиксировать выезд машины; finish — закрыть рейс */
  kind: "start" | "finish"
  label: string
  confirm: string
  done: string
  /** Основная кнопка блока или запасная (закрытие с недоставленными точками) */
  tone: "primary" | "secondary"
}

export interface RouteStep {
  key: "handover" | "start" | "wait" | "track" | "finish" | "done" | "cancelled"
  /** Что делать: «Передать водителю», «Подтвердить выезд», «Завершить рейс» */
  label: string
  /** Зачем и что произойдёт, если нажать */
  hint: string
  tone: "accent" | "warn" | "ok" | "muted"
  /** Действие в один тап, если шаг выполняется нажатием */
  action?: RouteStepAction
}

/**
 * Следующий шаг по рейсу — то самое «туннельное» правило: логист всегда видит
 * один следующий шаг, а не список равных кнопок.
 */
export function routeNextStep(route: RouteFlowInput): RouteStep {
  const progress = routeOrderProgress(route.orders)
  const status = route.status
  const driver = route.driverName?.trim() || null

  if (status === "cancelled") {
    return {
      key: "cancelled",
      label: "Рейс отменён",
      hint: "Заказы освобождены — помощник сборки снова может собрать из них рейс",
      tone: "muted",
    }
  }

  if (status === "completed") {
    return {
      key: "done",
      label: "Рейс закрыт",
      hint: progress.total > 0 ? `Точек в рейсе: ${progress.total}` : "Рейс завершён",
      tone: "ok",
    }
  }

  if (!route.driverId) {
    return {
      key: "handover",
      label: "Передать водителю",
      hint: "Рейс собран, но никому не отдан: без водителя он не поедет",
      tone: "warn",
    }
  }

  // Рейс ещё не выехал (запланирован или передан водителю).
  // Статус «В пути» ставит не логист: рейс сам становится «В пути», когда
  // водитель начнёт работу в приложении. Логист фиксирует выезд — время старта.
  if (status === "planned" || status === "active") {
    if (!route.startedAt) {
      return {
        key: "start",
        label: "Подтвердить выезд",
        hint: driver
          ? `${driver} получил рейс. Нажмите, когда машина выедет: время старта зафиксируется, а «В пути» рейс станет сам, когда водитель начнёт работу в приложении`
          : "Нажмите, когда машина выедет: время старта зафиксируется",
        tone: "accent",
        action: {
          kind: "start",
          label: "Подтвердить выезд",
          confirm: "Машина выехала? Зафиксируем время старта рейса.",
          done: "Старт рейса зафиксирован",
          tone: "primary",
        },
      }
    }

    // Выехали, но водитель ещё не отметил работу в приложении: от логиста
    // сейчас ничего не требуется — рейс сам станет «В пути».
    return {
      key: "wait",
      label: "Рейс у водителя",
      hint: driver
        ? `${driver} выехал. Рейс станет «В пути» сам, когда водитель начнёт работу в приложении — следить специально не нужно`
        : "Рейс станет «В пути», когда водитель начнёт работу в приложении",
      tone: "accent",
    }
  }

  // В пути и всё доставлено — рейс пора закрывать: машина и водитель освободятся
  if (progress.total > 0 && progress.delivered === progress.total) {
    return {
      key: "finish",
      label: "Завершить рейс",
      hint: "Все точки доставлены — закройте рейс, машина и водитель освободятся",
      tone: "accent",
      action: {
        kind: "finish",
        label: "Завершить рейс",
        confirm: "Завершить рейс? Все точки доставлены.",
        done: "Рейс завершён",
        tone: "primary",
      },
    }
  }

  const left = Math.max(0, progress.total - progress.delivered)
  return {
    key: "track",
    label: progress.total > 0 ? `Довезти: осталось ${left}` : "Рейс в пути",
    hint:
      progress.total === 0
        ? "Водитель в пути"
        : progress.delivered === 0
          ? `Ни одна точка ещё не закрыта: ${left} ${plural(left, ["точка", "точки", "точек"])} в дороге`
          : `Доставлено ${progress.delivered} из ${progress.total} — ${
              left === 1 ? "одна точка" : `${left} ${plural(left, ["точка", "точки", "точек"])}`
            } в дороге`,
    tone: "accent",
    // Закрыть рейс можно и с недоставленными точками — как на компьютере,
    // но это запасное действие: оставшиеся точки станут «доставлено».
    action: {
      kind: "finish",
      label: "Завершить рейс",
      confirm:
        "Не все точки доставлены. Завершить рейс? Оставшиеся точки будут помечены как «доставлено», машина и водитель освободятся.",
      done: "Рейс завершён",
      tone: "secondary",
    },
  }
}

/**
 * Строка-подсказка для списка рейсов: та же мысль, но короче — экран списка
 * не должен превращаться в простыню.
 */
export function routeListHint(route: RouteFlowInput): { text: string; tone: RouteStep["tone"] } {
  const step = routeNextStep(route)

  if (step.key === "handover") return { text: "Нет водителя — рейс никому не отдан", tone: "warn" }
  if (step.key === "start") return { text: "Дальше: подтвердить выезд", tone: "accent" }
  if (step.key === "wait") return { text: "У водителя: ждём выезда", tone: "accent" }
  if (step.key === "finish") return { text: "Всё доставлено — можно закрывать рейс", tone: "accent" }
  if (step.key === "track") {
    const progress = routeOrderProgress(route.orders)
    return {
      text:
        progress.delivered > 0
          ? `В пути: доставлено ${progress.delivered} из ${progress.total}`
          : `В пути: ${progress.moving} ${plural(progress.moving, ["точка", "точки", "точек"])} в дороге`,
      tone: "accent",
    }
  }
  if (step.key === "cancelled") return { text: "Рейс отменён", tone: "muted" }
  return { text: "Рейс завершён", tone: "ok" }
}

// ---------------------------------------------------------------------------
// Маршрут по точкам
// ---------------------------------------------------------------------------

/**
 * Точки рейса по порядку: «Москва → Тула → Воронеж».
 * Города берём из адресов, подряд идущие повторы схлопываем: у рейса из двух
 * заказов «Москва → Тула» и «Тула → Воронеж» Тула должна стоять один раз.
 */
export function routeWaypoints(
  orders: readonly RouteFlowOrder[],
  shortCity: (address?: string | null) => string,
): string[] {
  const list = [...(Array.isArray(orders) ? orders : [])].sort((a, b) => {
    const sa = Number.isFinite(Number(a.routeSequence)) && a.routeSequence !== null ? Number(a.routeSequence) : Number.MAX_SAFE_INTEGER
    const sb = Number.isFinite(Number(b.routeSequence)) && b.routeSequence !== null ? Number(b.routeSequence) : Number.MAX_SAFE_INTEGER
    return sa - sb
  })
  if (list.length === 0) return []

  const points: string[] = []
  const push = (value: string) => {
    if (!value || value === "—") return
    if (points[points.length - 1]?.toLowerCase() === value.toLowerCase()) return
    points.push(value)
  }

  push(shortCity(list[0].routeFrom))
  for (const order of list) push(shortCity(order.routeTo))
  return points
}

// ---------------------------------------------------------------------------
// Деньги
// ---------------------------------------------------------------------------

export interface RouteMoney {
  /** Выручка по заказам рейса */
  revenue: number
  /** Расходы: факт по чекам или оценка по топливу; null — посчитать нечем */
  cost: number | null
  /** На чём посчитаны расходы: чеки, оценка или ничего */
  basis: "fact" | "estimate" | null
  /** Прибыль рейса; null — расходы неизвестны */
  profit: number | null
  revenuePerKm: number | null
  costPerKm: number | null
  /** Убыточный рейс (расходы больше выручки) — подсвечиваем словами */
  unprofitable: boolean
  /** Сколько заказов без цены — их деньги в выручку не попали */
  withoutPrice: number
}

/** Деньги рейса: из экономики рейса, а если её нет — по самим заказам. */
export function routeMoney(route: RouteFlowInput): RouteMoney {
  const orders = Array.isArray(route.orders) ? route.orders : []
  const sumByOrders = orders.reduce(
    (sum, order) => sum + (Number(order.agreedPrice) || Number(order.price) || 0),
    0,
  )
  const withoutPrice = orders.filter(
    (order) => !(Number(order.agreedPrice) || Number(order.price)),
  ).length

  const economics = route.economics ?? null
  const revenue =
    Number.isFinite(Number(economics?.revenueRub)) && economics?.revenueRub != null
      ? Number(economics.revenueRub)
      : sumByOrders

  const fact = Number.isFinite(Number(economics?.factCostRub)) && economics?.factCostRub != null
    ? Number(economics.factCostRub)
    : null
  const estimate =
    Number.isFinite(Number(economics?.estimatedCostRub)) && economics?.estimatedCostRub != null
      ? Number(economics.estimatedCostRub)
      : null

  const cost = fact !== null ? fact : estimate
  const basis: RouteMoney["basis"] =
    economics?.basis === "fact" || fact !== null
      ? "fact"
      : economics?.basis === "estimate" || estimate !== null
        ? "estimate"
        : null

  const distance = Number(route.distanceKm) > 0 ? Number(route.distanceKm) : null
  const revenuePerKm =
    Number.isFinite(Number(economics?.rubPerKmRevenue)) && economics?.rubPerKmRevenue != null
      ? Number(economics.rubPerKmRevenue)
      : distance !== null
        ? Math.round(revenue / distance)
        : null
  const costPerKm =
    Number.isFinite(Number(economics?.costPerKm)) && economics?.costPerKm != null
      ? Number(economics.costPerKm)
      : distance !== null && cost !== null
        ? Math.round(cost / distance)
        : null

  const profit =
    Number.isFinite(Number(economics?.profitRub)) && economics?.profitRub != null
      ? Number(economics.profitRub)
      : cost !== null
        ? revenue - cost
        : null

  return {
    revenue,
    cost,
    basis,
    profit,
    revenuePerKm,
    costPerKm,
    unprofitable: profit !== null ? profit < 0 : Boolean(economics?.unprofitable),
    withoutPrice,
  }
}

/** На чём посчитаны расходы — словами, чтобы логист понимал, верить ли цифре. */
export function moneyBasisLabel(basis: RouteMoney["basis"]): string {
  if (basis === "fact") return "по расходам рейса"
  if (basis === "estimate") return "оценка по топливу"
  return "расходов пока нет"
}

// ---------------------------------------------------------------------------
// Итоги для списка
// ---------------------------------------------------------------------------

export interface RouteTotals {
  orders: number
  distanceKm: number | null
  weightKg: number | null
  revenue: number
}

export function routeTotals(route: RouteFlowInput): RouteTotals {
  const orders = Array.isArray(route.orders) ? route.orders : []
  const weight = orders.reduce((sum, order) => sum + (Number(order.weight) || 0), 0)
  const distance =
    Number(route.distanceKm) > 0
      ? Number(route.distanceKm)
      : orders.reduce((max, order) => Math.max(max, Number(order.distance) || 0), 0)

  return {
    orders: orders.length,
    distanceKm: distance > 0 ? distance : null,
    weightKg: weight > 0 ? weight : null,
    revenue: routeMoney(route).revenue,
  }
}

/** «2 заказа · 340 км · 8,6 т» — одна строка для списка и карточки. */
export function routeSummaryLine(
  route: RouteFlowInput,
  formatWeight: (value?: number | null) => string,
): string {
  const totals = routeTotals(route)
  const parts = [`${totals.orders} ${plural(totals.orders, ["заказ", "заказа", "заказов"])}`]
  if (totals.distanceKm !== null) parts.push(`${totals.distanceKm} км`)
  if (totals.weightKg !== null) parts.push(formatWeight(totals.weightKg))
  return parts.join(" · ")
}
