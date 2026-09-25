// lib/orders/stages.ts
//
// Единый источник правды для жизненного цикла заказа.
//
// Заказ — это процесс из шести этапов:
//   Поиск → Согласование → Маршрут → Документы → Назначение → Контроль
//
// До этого файла статусы заказа жили в трёх местах и не совпадали:
//   lib/types.ts        — 6 значений («new | confirmed | in_transit | …»),
//   lib/validators.ts   — 10 значений (включая «assigned», «in_route», «proposed»),
//   lib/routes/model.ts — свои наборы («loading», «unloading», «rejected»),
//   плюс отдельный список в app/api/drivers/[id]/active-order/route.ts.
// Теперь канон объявлен один раз здесь, а прежние значения принимаются как
// «легас» и нормализуются (LEGACY_ORDER_STATUS_MAP + normalizeOrderStatus),
// чтобы существующие данные продолжали работать до переноса
// (scripts/migrate-order-stages.ts, по умолчанию сухой прогон).
//
// Файл намеренно чистый: без Prisma и без Next.js — его можно импортировать и в
// middleware (edge), и в клиентские компоненты, и тестировать без базы.

// ---------------------------------------------------------------------------
// Этапы и статусы
// ---------------------------------------------------------------------------

/** Шесть этапов процесса плюс «закрыт» для отменённых/отклонённых заказов. */
export const ORDER_STAGES = [
  "search",
  "negotiation",
  "route",
  "documents",
  "assignment",
  "control",
  "closed",
] as const

export type OrderStage = (typeof ORDER_STAGES)[number]

export const ORDER_STAGE_LABELS: Record<OrderStage, string> = {
  search: "Поиск",
  negotiation: "Согласование",
  route: "Маршрут",
  documents: "Документы",
  assignment: "Назначение",
  control: "Контроль",
  closed: "Закрыт",
}

/**
 * Статусы заказа. Один статус = одна точка процесса; детализация исполнения
 * (погрузка / в пути / выгрузка / отдых) живёт в RouteStage и RouteEvent,
 * а не в статусе заказа.
 */
export const ORDER_STATUSES = [
  /** найден в своей базе или в живом поиске, взят в работу */
  "search",
  /** идут переговоры и торг */
  "negotiation",
  /** условия согласованы — только такие заказы попадают на холст маршрута */
  "agreed",
  /** включён в рейс (холст → рейс) */
  "in_route",
  /** оформление и проверка документов */
  "documents",
  /** назначены машина и водитель */
  "assigned",
  /** исполнение: погрузка, путь, выгрузка (детали — в этапах рейса) */
  "control",
  /** выполнен */
  "delivered",
  /** отменён */
  "cancelled",
  /** отклонён (не договорились, не наш груз) */
  "rejected",
  /** истёк: срок погрузки прошёл, груз неактуален */
  "expired",
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  search: "В поиске",
  negotiation: "Согласование",
  agreed: "Согласован",
  in_route: "В рейсе",
  documents: "Документы",
  assigned: "Назначен",
  control: "На контроле",
  delivered: "Доставлен",
  cancelled: "Отменён",
  rejected: "Отклонён",
  expired: "Неактуален",
}

/** Статус → этап процесса. */
const STATUS_STAGE: Record<OrderStatus, OrderStage> = {
  search: "search",
  negotiation: "negotiation",
  agreed: "negotiation",
  in_route: "route",
  documents: "documents",
  assigned: "assignment",
  control: "control",
  delivered: "control",
  cancelled: "closed",
  rejected: "closed",
  expired: "closed",
}

// ---------------------------------------------------------------------------
// Легас-значения (то, что лежит в существующих базах)
// ---------------------------------------------------------------------------

/**
 * Прежние статусы → канон. Используются при чтении (normalizeOrderStatus) и
 * при переносе данных (scripts/migrate-order-stages.ts).
 */
export const LEGACY_ORDER_STATUS_MAP: Record<string, OrderStatus> = {
  new: "search",
  processing: "negotiation",
  needs_clarification: "negotiation",
  proposed: "negotiation",
  confirmed: "agreed",
  in_route: "in_route",
  assigned: "assigned",
  loading: "control",
  unloading: "control",
  in_transit: "control",
  completed: "delivered",
  delivered: "delivered",
  cancelled: "cancelled",
  rejected: "rejected",
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value)
}

/**
 * Приводит любое встреченное значение (канон или легас) к канону.
 * Возвращает null, если значение совсем неизвестное — угадывать нельзя.
 */
export function normalizeOrderStatus(value: unknown): OrderStatus | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (isOrderStatus(trimmed)) return trimmed
  return LEGACY_ORDER_STATUS_MAP[trimmed] ?? null
}

/** Этап процесса для статуса (легас-значения сначала нормализуются). */
export function orderStageOf(value: unknown): OrderStage | null {
  const status = normalizeOrderStatus(value)
  return status ? STATUS_STAGE[status] : null
}

/** Название этапа для любого значения статуса (включая прежние). */
export function orderStageLabel(value: unknown): string {
  const stage = orderStageOf(value)
  return stage ? ORDER_STAGE_LABELS[stage] : "—"
}

/** Русская подпись статуса; для неизвестного значения возвращает его как есть. */
export function orderStatusLabel(value: unknown): string {
  const status = normalizeOrderStatus(value)
  return status ? ORDER_STATUS_LABELS[status] : String(value ?? "")
}

// ---------------------------------------------------------------------------
// Переходы
// ---------------------------------------------------------------------------

/**
 * Разрешённые переходы. Логика простая и проверяемая:
 *  — заказ идёт по процессу вперёд и может быть возвращён на шаг назад
 *    (пересогласование, сняли с рейса, отменили назначение);
 *  — закрыть можно с любого открытого статуса;
 *  — delivered/cancelled/rejected/expired — конечные, из них не выходим
 *    (возврат в работу — отдельное осознанное действие, а не смена статуса).
 */
const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  search: ["negotiation", "agreed", "rejected", "expired", "cancelled"],
  negotiation: ["search", "agreed", "rejected", "expired", "cancelled"],
  agreed: ["negotiation", "in_route", "documents", "assigned", "rejected", "cancelled", "expired"],
  in_route: ["agreed", "documents", "assigned", "control", "cancelled"],
  documents: ["agreed", "in_route", "assigned", "control", "cancelled"],
  assigned: ["in_route", "documents", "control", "agreed", "cancelled"],
  control: ["assigned", "delivered", "cancelled"],
  delivered: [],
  cancelled: [],
  rejected: [],
  expired: [],
}

export function allowedOrderStatuses(from: unknown): OrderStatus[] {
  const current = normalizeOrderStatus(from)
  if (!current) return []
  return [...ORDER_TRANSITIONS[current]]
}

export function canChangeOrderStatus(from: unknown, to: unknown): boolean {
  const current = normalizeOrderStatus(from)
  const next = normalizeOrderStatus(to)
  if (!current || !next) return false
  if (current === next) return true
  return ORDER_TRANSITIONS[current].includes(next)
}

// ---------------------------------------------------------------------------
// Наборы статусов (замена прежним спискам из lib/routes/model.ts)
// ---------------------------------------------------------------------------

/** Заказ закрыт — дальше по процессу не идёт. */
export const CLOSED_ORDER_STATUSES: readonly OrderStatus[] = [
  "delivered",
  "cancelled",
  "rejected",
  "expired",
]

/** Заказ жив: занимает людей и машины, по нему идёт работа. */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  "search",
  "negotiation",
  "agreed",
  "in_route",
  "documents",
  "assigned",
  "control",
]

/** Заказ уже привязан к рейсу (машина и водитель реально заняты). */
export const OCCUPYING_ORDER_STATUSES: readonly OrderStatus[] = [
  "in_route",
  "documents",
  "assigned",
  "control",
]

/** Заказ в движении / на точках (детали — в RouteStage). */
export const MOVING_ORDER_STATUSES: readonly OrderStatus[] = ["control"]

/** На холст сборки маршрута попадают только согласованные заказы. */
export const CANVAS_ORDER_STATUSES: readonly OrderStatus[] = ["agreed"]

/** Статусы, при которых заказ можно взять в рейс (холст) или он уже в рейсе. */
export const ROUTEABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  "agreed",
  "in_route",
  "documents",
  "assigned",
  "control",
]

function inList(list: readonly OrderStatus[], value: unknown): boolean {
  const status = normalizeOrderStatus(value)
  return status !== null && (list as readonly string[]).includes(status)
}

export function isOrderClosed(value: unknown): boolean {
  return inList(CLOSED_ORDER_STATUSES, value)
}

export function isOrderActive(value: unknown): boolean {
  return inList(ACTIVE_ORDER_STATUSES, value)
}

export function isOrderOccupying(value: unknown): boolean {
  return inList(OCCUPYING_ORDER_STATUSES, value)
}

export function isOrderMoving(value: unknown): boolean {
  return inList(MOVING_ORDER_STATUSES, value)
}

/** Можно ли положить заказ на холст сборки маршрута. */
export function isOrderAgreed(value: unknown): boolean {
  return inList(CANVAS_ORDER_STATUSES, value)
}

/** Можно ли взять заказ в рейс: он согласован или уже проходит рейс. */
export function isOrderRouteable(value: unknown): boolean {
  return inList(ROUTEABLE_ORDER_STATUSES, value)
}

// ---------------------------------------------------------------------------
// Согласование: виды записей и статус переговоров
// ---------------------------------------------------------------------------

/** Что может быть в ленте согласования заказа. */
export const NEGOTIATION_KINDS = [
  /** свободная заметка */
  "note",
  /** предложение цены (торг) */
  "price_offer",
  /** цена заказа изменена — пишется автоматически */
  "price_change",
  /** звонок клиенту/перевозчику */
  "call",
  /** письмо */
  "email",
  /** статус заказа изменён — пишется автоматически */
  "status_change",
  /** документ приложен/проверен */
  "document",
] as const

export type NegotiationKind = (typeof NEGOTIATION_KINDS)[number]

export const NEGOTIATION_KIND_LABELS: Record<NegotiationKind, string> = {
  note: "Заметка",
  price_offer: "Предложение цены",
  price_change: "Изменение цены",
  call: "Звонок",
  email: "Письмо",
  document: "Документ",
  status_change: "Смена статуса",
}

/** Состояние переговоров по заказу. */
export const NEGOTIATION_STATUSES = ["new", "in_progress", "agreed", "lost"] as const

export type NegotiationStatus = (typeof NEGOTIATION_STATUSES)[number]

export const NEGOTIATION_STATUS_LABELS: Record<NegotiationStatus, string> = {
  new: "Новый",
  in_progress: "В переговорах",
  agreed: "Договорились",
  lost: "Не договорились",
}

export function isNegotiationKind(value: unknown): value is NegotiationKind {
  return typeof value === "string" && (NEGOTIATION_KINDS as readonly string[]).includes(value)
}

export function isNegotiationStatus(value: unknown): value is NegotiationStatus {
  return (
    typeof value === "string" && (NEGOTIATION_STATUSES as readonly string[]).includes(value)
  )
}

/**
 * Статус заказа, который следует из итога переговоров: договорились → «agreed»,
 * не договорились → «rejected». Возвращает null, если итог ещё не подведён.
 */
export function statusFromNegotiation(negotiationStatus: unknown): OrderStatus | null {
  if (negotiationStatus === "agreed") return "agreed"
  if (negotiationStatus === "lost") return "rejected"
  return null
}
