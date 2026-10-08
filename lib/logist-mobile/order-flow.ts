// lib/logist-mobile/order-flow.ts
//
// «Туннель» заказа: где заказ сейчас, что делать дальше и что мешает.
//
// Идея простая: логисту на телефоне не нужен список статусов — ему нужен один
// понятный следующий шаг и причина, почему заказ стоит. Модуль считает это из
// тех же данных заказа и того же канона этапов (lib/orders/stages.ts), что и
// сервер, — поэтому экраны не могут разойтись с моделью процесса.
//
// Модуль намеренно чистый: без Prisma, без Next.js, без React. Его проверяют
// юнит-тесты tests/logist-mobile-order-flow.test.mjs.

import {
  CLOSED_ORDER_STATUSES,
  allowedOrderStatuses,
  normalizeOrderStatus,
  orderStageOf,
  ORDER_STAGES,
  type OrderStage,
  type OrderStatus,
} from "../orders/stages"
import { formatDeadline, shortRef } from "./format"

// ---------------------------------------------------------------------------
// Этапы и шаги
// ---------------------------------------------------------------------------

/** Этапы понятными словами — то, что логист читает на телефоне. */
export const MOBILE_STAGE_TITLES: Record<OrderStage, string> = {
  search: "Ищем машину",
  negotiation: "Договариваемся",
  route: "В рейсе",
  documents: "Документы",
  assignment: "Назначение",
  control: "Доставка",
  closed: "Закрыт",
}

/** Шаги туннеля: шесть рабочих этапов, «Закрыт» — не шаг, а выход. */
export const ORDER_PIPELINE: OrderStage[] = ORDER_STAGES.filter(
  (stage): stage is Exclude<OrderStage, "closed"> => stage !== "closed",
)

export type StepState = "done" | "current" | "todo" | "closed"

export interface OrderStep {
  stage: OrderStage
  title: string
  state: StepState
}

/**
 * Шаги процесса для заказа: пройденные, текущий и предстоящие.
 * У закрытого заказа все шаги помечены closed — рисовать «прогресс» нечестно.
 */
export function orderSteps(status: unknown): OrderStep[] {
  const current = mobileStageOf(status)
  const index = current && current !== "closed" ? ORDER_PIPELINE.indexOf(current) : -1

  return ORDER_PIPELINE.map((stage, position) => ({
    stage,
    title: MOBILE_STAGE_TITLES[stage],
    state:
      current === "closed"
        ? ("closed" as const)
        : position < index
          ? ("done" as const)
          : position === index
            ? ("current" as const)
            : ("todo" as const),
  }))
}

/** «Этап 3 из 6» — короткая подпись прогресса. Закрытый заказ — без прогресса. */
export function progressLabel(status: unknown): string {
  const stage = mobileStageOf(status)
  if (!stage) return "Этап неизвестен"
  if (stage === "closed") return "Заказ закрыт"
  const index = ORDER_PIPELINE.indexOf(stage)
  return `Этап ${index + 1} из ${ORDER_PIPELINE.length} · ${MOBILE_STAGE_TITLES[stage]}`
}

// ---------------------------------------------------------------------------
// Следующий шаг
// ---------------------------------------------------------------------------

export interface NextStep {
  /** Куда переведём заказ */
  status: OrderStatus
  /** Текст на кнопке */
  title: string
  /** Зачем это делать — объяснение человеческим языком */
  why: string
  tone: "primary" | "success"
}

/**
 * Главный шаг для каждого статуса. Именно он показывается одной большой
 * кнопкой: остальные переходы — в «других действиях», чтобы не выбирать
 * из семи равных вариантов.
 */
const NEXT_STEP: Partial<Record<OrderStatus, { to: OrderStatus; title: string; why: string }>> = {
  search: {
    to: "negotiation",
    title: "Взять в работу",
    why: "Позвоните клиенту и договоритесь о цене и сроке",
  },
  negotiation: {
    to: "agreed",
    title: "Договорились",
    why: "Согласованные заказы можно ставить в рейс — остальные в рейс не попадут",
  },
  agreed: {
    to: "in_route",
    title: "Отправить в рейс",
    why: "Соберите рейс из согласованных заказов или отправьте отдельной машиной",
  },
  in_route: {
    to: "documents",
    title: "Собрать документы",
    why: "Накладные и счёт — пока машина ещё не выехала",
  },
  documents: {
    to: "assigned",
    title: "Назначить машину",
    why: "Пока не назначены водитель и машина, заказ не поедет",
  },
  assigned: {
    to: "control",
    title: "Машина в пути",
    why: "Заказ у водителя — отмечайте этапы рейса по мере движения",
  },
  control: {
    to: "delivered",
    title: "Доставлен",
    why: "Подтвердите выгрузку и закройте заказ",
  },
}

export function nextStep(status: unknown): NextStep | null {
  const current = normalizeOrderStatus(status)
  if (!current) return null
  const step = NEXT_STEP[current]
  if (!step) return null
  // Переход берём только если он разрешён каноном — кнопка не может врать
  if (!allowedOrderStatuses(current).includes(step.to)) return null
  return {
    status: step.to,
    title: step.title,
    why: step.why,
    tone: step.to === "delivered" ? "success" : "primary",
  }
}

/**
 * Что произойдёт при переводе заказа в этот статус. Текст показывается в
 * подтверждении: логист должен видеть последствие, а не название кнопки.
 */
export const STATUS_CHANGE_HINTS: Partial<Record<OrderStatus, string>> = {
  search: "Заказ вернётся в поиск: он снова свободен, срок и назначение сбросятся",
  negotiation: "Заказ перейдёт в согласование — зафиксируйте цену и условия",
  agreed: "Заказ станет согласованным: его можно ставить в рейс и назначать машину",
  in_route: "Заказ уйдёт в рейс и появится у водителя",
  documents: "Заказ перейдёт к документам: накладные, счёт, доверенность",
  assigned: "Заказ станет «Назначен»: работа переходит к водителю и машине",
  control: "Заказ перейдёт на контроль исполнения — машина считается в пути",
  delivered: "Заказ закроется как выполненный: он уйдёт в закрытые",
  cancelled: "Заказ отменится. Вернуть в работу можно только сменой статуса",
  rejected: "Заказ отклонится и уйдёт в закрытые",
  expired: "Заказ закроется как неактуальный: срок прошёл",
}

// ---------------------------------------------------------------------------
// Что мешает заказу
// ---------------------------------------------------------------------------

/** Поля заказа, которых достаточно для подсказок и фильтров. */
export interface FlowOrder {
  id: string
  status: string
  routeFrom: string
  routeTo: string
  deadline?: string | null
  createdAt?: string | null
  clientName?: string | null
  clientContact?: string | null
  cargoType?: string | null
  price?: number | null
  agreedPrice?: number | null
  assignedDriverId?: string | null
  assignedVehicleId?: string | null
  routeId?: string | null
}

/** Куда ведёт подсказка: что именно править на экране заказа. */
export type CheckFix = "assign" | "price" | "contact" | "deadline"

export interface OrderCheck {
  id: string
  text: string
  tone: "warn" | "info"
  fix: CheckFix | null
}

/**
 * Этап заказа для мобильных экранов.
 *
 * Отличие от канонического orderStageOf одно: доставленный заказ у нас попадает
 * в «Закрыт», а не в «Доставку». В модели этапов delivery относится к контролю,
 * но для логиста работа по такому заказу закончена — и в счётчиках «сколько
 * осталось» он не должен висеть в этапе, где ещё что-то делают.
 */
export function mobileStageOf(status: unknown): OrderStage | null {
  const normalized = normalizeOrderStatus(status)
  if (!normalized) return null
  if ((CLOSED_ORDER_STATUSES as readonly string[]).includes(normalized)) return "closed"
  return orderStageOf(normalized)
}

/** Заказ закрыт — дальше по процессу не идёт. */
export function isClosedStatus(status: unknown): boolean {
  return mobileStageOf(status) === "closed"
}

/**
 * Что мешает заказу: список подсказок «чего не хватает».
 * Порядок — по важности для логиста: сначала то, из-за чего заказ не поедет.
 */
export function orderChecks(order: FlowOrder): OrderCheck[] {
  const status = normalizeOrderStatus(order.status)
  if (!status || isClosedStatus(status)) return []

  const checks: OrderCheck[] = []
  const crewNeeded = (
    ["agreed", "in_route", "documents", "assigned", "control"] as OrderStatus[]
  ).includes(status)

  if (crewNeeded && !order.assignedDriverId) {
    checks.push({
      id: "driver",
      text: "Не назначен водитель — заказ не поедет",
      tone: "warn",
      fix: "assign",
    })
  }
  if (crewNeeded && !order.assignedVehicleId) {
    checks.push({
      id: "vehicle",
      text: "Не назначена машина — заказ не поедет",
      tone: "warn",
      fix: "assign",
    })
  }

  const price = order.agreedPrice ?? order.price ?? 0
  if (!price) {
    checks.push({
      id: "price",
      text: "Цена не указана — уточните у клиента",
      tone: "info",
      fix: "price",
    })
  }

  if (!order.clientContact?.trim()) {
    checks.push({
      id: "contact",
      text: "Нет телефона клиента — позвонить некуда",
      tone: "info",
      fix: "contact",
    })
  }

  const deadline = deadlineState(order.deadline)
  if (!order.deadline) {
    checks.push({
      id: "deadline",
      text: "Не указан срок выгрузки",
      tone: "info",
      fix: "deadline",
    })
  } else if (deadline.overdue) {
    checks.push({ id: "overdue", text: deadline.text, tone: "warn", fix: "deadline" })
  }

  return checks
}

/**
 * Одна строка-подсказка для карточки в списке: что делать с заказом дальше
 * или что ему мешает. Больше одной строки в списке не показываем — иначе
 * карточки перестают отличаться друг от друга.
 */
export function listHint(order: FlowOrder): { text: string; tone: "warn" | "info" } | null {
  if (isClosedStatus(order.status)) return null

  // Просрочку в списке показывает своя строка со сроком — второй раз не пишем
  const warn = orderChecks(order).find((check) => check.tone === "warn" && check.id !== "overdue")
  if (warn) return { text: warn.text, tone: "warn" }

  const step = nextStep(order.status)
  if (!step) return null
  return { text: `Дальше: ${step.title.toLowerCase()}`, tone: "info" }
}

// ---------------------------------------------------------------------------
// Сроки: сегодня / просрочено
// ---------------------------------------------------------------------------

function startOfDay(value: Date): number {
  const copy = new Date(value)
  copy.setHours(0, 0, 0, 0)
  return copy.getTime()
}

/** Сколько дней до срока: 0 — сегодня, <0 — просрочен. */
export function daysToDeadline(iso?: string | null, now: Date = new Date()): number | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return Math.round((startOfDay(date) - startOfDay(now)) / 86400000)
}

/**
 * Срок словами: «сегодня», «просрочен на 2 дня», «без срока».
 * Текст берём из formatDeadline — на экранах срок должен читаться одинаково.
 */
export function deadlineState(iso?: string | null, now: Date = new Date()): {
  text: string
  overdue: boolean
  today: boolean
} {
  const days = daysToDeadline(iso, now)
  const base = formatDeadline(iso)
  return { text: base.text, overdue: base.overdue, today: days === 0 }
}

// ---------------------------------------------------------------------------
// Фильтры списка
// ---------------------------------------------------------------------------

/** Быстрые представления списка заказов. */
export type OrderView = "active" | "today" | "overdue" | "all"

export const ORDER_VIEWS: { id: OrderView; label: string }[] = [
  { id: "active", label: "В работе" },
  { id: "today", label: "Сегодня" },
  { id: "overdue", label: "Просрочено" },
  { id: "all", label: "Все" },
]

export function matchesView(order: FlowOrder, view: OrderView, now: Date = new Date()): boolean {
  if (view === "all") return true
  if (isClosedStatus(order.status)) return false
  const days = daysToDeadline(order.deadline, now)
  if (view === "today") return days === 0
  if (view === "overdue") return days !== null && days < 0
  return true // active
}

export function matchesStage(order: FlowOrder, stage: OrderStage | "all"): boolean {
  if (stage === "all") return true
  return mobileStageOf(order.status) === stage
}

/**
 * Поиск по номеру и адресу: номер заказа, клиент, контакт, города и груз.
 * Номер ищем и по короткому виду («order-7»), и по хвосту длинного id —
 * так работает поиск по цифрам из накладной.
 */
export function matchesQuery(order: FlowOrder, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true

  const haystack = [
    order.id,
    shortRef(order.id),
    order.clientName,
    order.clientContact,
    order.routeFrom,
    order.routeTo,
    order.cargoType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return haystack.includes(needle)
}

/**
 * Один заказ против всех фильтров экрана.
 * Тип заказа сохраняем (T extends FlowOrder): экраны передают сюда свои
 * MobileOrder и получают обратно их же — без приведений типов.
 */
export function filterOrders<T extends FlowOrder>(
  orders: T[],
  options: { view?: OrderView; stage?: OrderStage | "all"; query?: string; now?: Date },
): T[] {
  const { view = "all", stage = "all", query = "", now = new Date() } = options
  return orders.filter(
    (order) =>
      matchesView(order, view, now) && matchesStage(order, stage) && matchesQuery(order, query),
  )
}

/** Счётчики по этапам: сколько заказов придёт, если нажать на этап. */
export function stageCounters(
  orders: FlowOrder[],
): { stage: OrderStage; title: string; count: number }[] {
  return ORDER_STAGES.map((stage) => ({
    stage,
    title: MOBILE_STAGE_TITLES[stage],
    count: orders.filter((order) => mobileStageOf(order.status) === stage).length,
  }))
}

/** Счётчики быстрых представлений. */
export function viewCounts(orders: FlowOrder[], now: Date = new Date()): Record<OrderView, number> {
  return {
    active: orders.filter((order) => matchesView(order, "active", now)).length,
    today: orders.filter((order) => matchesView(order, "today", now)).length,
    overdue: orders.filter((order) => matchesView(order, "overdue", now)).length,
    all: orders.length,
  }
}

/**
 * Порядок в списке: сначала горящее. Просроченные — выше, дальше по сроку,
 * внутри одного срока — свежие сверху, закрытые — в конце.
 */
export function sortOrders<T extends FlowOrder>(orders: T[]): T[] {
  return [...orders].sort((a, b) => {
    const aClosed = isClosedStatus(a.status) ? 1 : 0
    const bClosed = isClosedStatus(b.status) ? 1 : 0
    if (aClosed !== bClosed) return aClosed - bClosed

    const aDays = daysToDeadline(a.deadline)
    const bDays = daysToDeadline(b.deadline)
    const aRank = aDays === null ? 9999 : aDays
    const bRank = bDays === null ? 9999 : bDays
    if (aRank !== bRank) return aRank - bRank

    const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return bCreated - aCreated
  })
}
