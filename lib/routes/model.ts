// lib/routes/model.ts
//
// Доменная модель рейса: статусы, разрешённые переходы, итоги и имя рейса.
// Только чистые функции — без Prisma и без Next.js, поэтому логику можно
// проверить юнит-тестами (tests/routes-model.test.mjs) без базы данных.

export const ROUTE_STATUSES = [
  "planned",
  "active",
  "in_transit",
  "completed",
  "cancelled",
] as const

export type RouteStatus = (typeof ROUTE_STATUSES)[number]

export const ROUTE_STATUS_LABELS: Record<RouteStatus, string> = {
  planned: "Запланирован",
  active: "Назначен",
  in_transit: "В пути",
  completed: "Завершён",
  cancelled: "Отменён",
}

/** Статусы заказов, которые считаются «рейс ещё идёт». */
export const ACTIVE_ORDER_STATUSES = [
  "confirmed",
  "in_transit",
  "loading",
  "unloading",
] as const

/** Статусы заказов, при которых машина реально движется/работает на точках. */
export const MOVING_ORDER_STATUSES = ["in_transit", "loading", "unloading"] as const

/** Статусы заказов, которые уже закрыты (дальше не меняются). */
export const CLOSED_ORDER_STATUSES = ["delivered", "cancelled", "rejected"] as const

/** Заказ «в рейсе» — именно эти статусы освобождают водителя/машину при закрытии рейса. */
export const OCCUPYING_ORDER_STATUSES = ACTIVE_ORDER_STATUSES

export function isRouteStatus(value: unknown): value is RouteStatus {
  return typeof value === "string" && (ROUTE_STATUSES as readonly string[]).includes(value)
}

export function normalizeRouteStatus(value: unknown): RouteStatus | null {
  return isRouteStatus(value) ? value : null
}

/** Русская подпись статуса рейса (для неизвестного значения возвращает его как есть). */
export function routeStatusLabel(value: unknown): string {
  return isRouteStatus(value) ? ROUTE_STATUS_LABELS[value] : String(value ?? "")
}

const ROUTE_TRANSITIONS: Record<RouteStatus, readonly RouteStatus[]> = {
  // запланированный рейс можно закрыть сразу, если все точки уже доставлены
  planned: ["active", "in_transit", "completed", "cancelled"],
  active: ["planned", "in_transit", "completed", "cancelled"],
  in_transit: ["active", "completed", "cancelled"],
  completed: [],
  cancelled: ["planned"],
}

export function allowedRouteTransitions(from: RouteStatus): readonly RouteStatus[] {
  return ROUTE_TRANSITIONS[from] ?? []
}

/**
 * Разрешён ли переход статуса рейса. Повторная установка того же статуса
 * считается допустимой (no-op), чтобы клиент не ловил ошибку при повторном клике.
 */
export function canTransitionRoute(
  from: RouteStatus,
  to: RouteStatus,
): { ok: boolean; reason: string } {
  if (!isRouteStatus(from) || !isRouteStatus(to)) {
    return { ok: false, reason: "Неизвестный статус рейса" }
  }
  if (from === to) return { ok: true, reason: "Статус не меняется" }
  const allowed = ROUTE_TRANSITIONS[from] ?? []
  if (allowed.includes(to)) {
    return { ok: true, reason: "" }
  }
  if (allowed.length === 0) {
    return {
      ok: false,
      reason: `Рейс в статусе «${ROUTE_STATUS_LABELS[from]}» — статус больше не меняется`,
    }
  }
  return {
    ok: false,
    reason: `Нельзя перевести рейс из «${ROUTE_STATUS_LABELS[from]}» в «${ROUTE_STATUS_LABELS[to]}»`,
  }
}

/** Минимальный набор полей заказа, нужный для расчётов по рейсу. */
export type RouteOrderLike = {
  id?: string
  status: string
  routeFrom?: string | null
  routeTo?: string | null
  distance?: number | null
  weight?: number | null
  volume?: number | null
  price?: number | null
  isAdditionalLoad?: boolean
  routeSequence?: number | null
}

export type RouteSummary = {
  totalOrders: number
  totalDistance: number
  cargoWeight: number
  cargoVolume: number
  revenue: number
  deliveredOrders: number
  activeOrders: number
  cancelledOrders: number
  pendingOrders: number
  additionalLoads: number
}

const toInt = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value ?? 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}

const toFloat = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** Итоги рейса по его заказам: километры, вес, объём, выручка, счётчики точек. */
export function summarizeRoute(orders: readonly RouteOrderLike[]): RouteSummary {
  const list = Array.isArray(orders) ? orders : []
  const delivered = list.filter((o) => o.status === "delivered").length
  const cancelled = list.filter((o) => o.status === "cancelled" || o.status === "rejected").length
  const active = list.filter((o) =>
    (MOVING_ORDER_STATUSES as readonly string[]).includes(o.status),
  ).length

  return {
    totalOrders: list.length,
    totalDistance: list.reduce((sum, o) => sum + toInt(o.distance), 0),
    cargoWeight: list.reduce((sum, o) => sum + toInt(o.weight), 0),
    cargoVolume: Number(
      list.reduce((sum, o) => sum + toFloat(o.volume), 0).toFixed(3),
    ),
    revenue: list
      .filter((o) => o.status !== "cancelled" && o.status !== "rejected")
      .reduce((sum, o) => sum + toInt(o.price), 0),
    deliveredOrders: delivered,
    activeOrders: active,
    cancelledOrders: cancelled,
    pendingOrders: list.length - delivered - cancelled,
    additionalLoads: list.filter((o) => o.isAdditionalLoad === true).length,
  }
}

/**
 * Статус рейса, выведенный из статусов его заказов.
 * Это единственный источник правды: поле Route.status всегда должно
 * совпадать с тем, что возвращает эта функция (пересчитывается при каждом
 * изменении заказа/рейса через recalcRoute в lib/routes/service.ts).
 */
export function deriveRouteStatus(
  orderStatuses: readonly string[],
  hints?: { startedAt?: Date | string | null; completedAt?: Date | string | null },
): RouteStatus {
  const statuses = (Array.isArray(orderStatuses) ? orderStatuses : []).map((s) =>
    typeof s === "string" ? s : String(s ?? ""),
  )

  if (statuses.length === 0) return "planned"

  const allCancelled = statuses.every((s) => s === "cancelled" || s === "rejected")
  if (allCancelled) return "cancelled"

  if (hints?.completedAt) return "completed"

  const closed = statuses.filter((s) => (CLOSED_ORDER_STATUSES as readonly string[]).includes(s))
  if (closed.length === statuses.length) {
    return statuses.some((s) => s === "delivered") ? "completed" : "cancelled"
  }

  if (statuses.some((s) => (MOVING_ORDER_STATUSES as readonly string[]).includes(s))) {
    return "in_transit"
  }

  if (hints?.startedAt) return "active"

  return "planned"
}

function sortBySequence(orders: readonly RouteOrderLike[]): RouteOrderLike[] {
  return [...orders].sort((a, b) => {
    const sa = Number.isFinite(Number(a.routeSequence)) ? Number(a.routeSequence) : Number.MAX_SAFE_INTEGER
    const sb = Number.isFinite(Number(b.routeSequence)) ? Number(b.routeSequence) : Number.MAX_SAFE_INTEGER
    return sa - sb
  })
}

/**
 * Человекочитаемое имя рейса: «Ярославль → Иваново → Санкт-Петербург».
 * Точки берутся в порядке routeSequence, подряд идущие дубли схлопываются.
 */
export function buildRouteName(orders: readonly RouteOrderLike[]): string {
  const list = sortBySequence(Array.isArray(orders) ? orders : [])
  const points: string[] = []

  const push = (value: unknown) => {
    const city = typeof value === "string" ? value.trim() : ""
    if (!city) return
    if (points[points.length - 1]?.toLowerCase() === city.toLowerCase()) return
    points.push(city)
  }

  if (list.length === 0) return ""

  push(list[0].routeFrom)
  for (const order of list) push(order.routeTo)

  return points.join(" → ")
}

/**
 * Короткая подпись рейса для списков: имя + число точек.
 * Используется в ответах API, чтобы клиент не собирал строку сам.
 */
export function formatRouteTitle(route: {
  name?: string | null
  status?: string | null
}, orderCount?: number): string {
  const name = (route.name || "").trim()
  const base = name || (isRouteStatus(route.status) ? ROUTE_STATUS_LABELS[route.status] : "Рейс")
  if (!orderCount || orderCount <= 0) return base
  const word = orderCount === 1 ? "точка" : orderCount < 5 ? "точки" : "точек"
  return `${base} · ${orderCount} ${word}`
}
