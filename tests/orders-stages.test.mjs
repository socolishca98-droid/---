/**
 * Тесты канона жизненного цикла заказа (задача 2):
 * этапы, статусы, прежние значения, переходы, наборы, лента согласования.
 * База данных не нужна — проверяются чистые функции lib/orders/stages.ts.
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  ORDER_STAGES,
  ORDER_STAGE_LABELS,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  LEGACY_ORDER_STATUS_MAP,
  isOrderStatus,
  normalizeOrderStatus,
  orderStageOf,
  orderStageLabel,
  orderStatusLabel,
  allowedOrderStatuses,
  canChangeOrderStatus,
  CLOSED_ORDER_STATUSES,
  ACTIVE_ORDER_STATUSES,
  OCCUPYING_ORDER_STATUSES,
  MOVING_ORDER_STATUSES,
  CANVAS_ORDER_STATUSES,
  ROUTEABLE_ORDER_STATUSES,
  isOrderClosed,
  isOrderActive,
  isOrderOccupying,
  isOrderMoving,
  isOrderAgreed,
  isOrderRouteable,
  NEGOTIATION_KINDS,
  NEGOTIATION_KIND_LABELS,
  NEGOTIATION_STATUSES,
  NEGOTIATION_STATUS_LABELS,
  isNegotiationKind,
  isNegotiationStatus,
  statusFromNegotiation,
} = require("../.test-build/lib/orders/stages.js")

// ---------------------------------------------------------------------------
// Этапы и статусы
// ---------------------------------------------------------------------------

test("этапы процесса идут в правильном порядке", () => {
  assert.deepEqual([...ORDER_STAGES], [
    "search",
    "negotiation",
    "route",
    "documents",
    "assignment",
    "control",
    "closed",
  ])
  for (const stage of ORDER_STAGES) {
    assert.ok(ORDER_STAGE_LABELS[stage], `нет подписи этапа ${stage}`)
  }
})

test("у каждого статуса есть подпись и этап", () => {
  for (const status of ORDER_STATUSES) {
    assert.ok(ORDER_STATUS_LABELS[status], `нет подписи статуса ${status}`)
    assert.ok(ORDER_STAGES.includes(orderStageOf(status)), `нет этапа у статуса ${status}`)
    assert.equal(orderStatusLabel(status), ORDER_STATUS_LABELS[status])
    assert.equal(orderStageLabel(status), ORDER_STAGE_LABELS[orderStageOf(status)])
  }
})

test("шесть этапов процесса покрывают все рабочие статусы", () => {
  const stagesOfWork = new Set(
    ORDER_STATUSES.filter((s) => !CLOSED_ORDER_STATUSES.includes(s)).map((s) => orderStageOf(s)),
  )
  for (const stage of ["search", "negotiation", "route", "documents", "assignment", "control"]) {
    assert.ok(stagesOfWork.has(stage), `этап ${stage} не покрыт статусами`)
  }
  // «Доставлен» — итог этапа «Контроль», а отмена/отказ/истечение — этап «Закрыт»
  assert.equal(orderStageOf("delivered"), "control")
  for (const status of ["cancelled", "rejected", "expired"]) {
    assert.equal(orderStageOf(status), "closed")
    assert.ok(CLOSED_ORDER_STATUSES.includes(status))
  }
  assert.ok(CLOSED_ORDER_STATUSES.includes("delivered"))
})

// ---------------------------------------------------------------------------
// Прежние значения
// ---------------------------------------------------------------------------

test("прежние значения приводятся к канону", () => {
  const expected = {
    new: "search",
    processing: "negotiation",
    needs_clarification: "negotiation",
    proposed: "negotiation",
    confirmed: "agreed",
    loading: "control",
    unloading: "control",
    in_transit: "control",
    completed: "delivered",
  }
  for (const [legacy, canonical] of Object.entries(expected)) {
    assert.equal(normalizeOrderStatus(legacy), canonical, `${legacy} → ${canonical}`)
    assert.equal(orderStatusLabel(legacy), ORDER_STATUS_LABELS[canonical])
    assert.equal(orderStageOf(legacy), orderStageOf(canonical))
  }
})

test("таблица переноса покрывает прежние значения и не ломает канон", () => {
  for (const [legacy, canonical] of Object.entries(LEGACY_ORDER_STATUS_MAP)) {
    assert.ok(ORDER_STATUSES.includes(canonical), `${legacy} ведёт в неизвестный статус`)
    assert.equal(normalizeOrderStatus(legacy), canonical)
  }
  // значения, которые раньше использовались в коде и лежат в базах
  for (const legacy of ["new", "processing", "confirmed", "in_transit", "loading", "unloading", "completed"]) {
    assert.ok(LEGACY_ORDER_STATUS_MAP[legacy], `в таблице переноса нет «${legacy}»`)
  }
})

test("normalizeOrderStatus не выдумывает статус из мусора", () => {
  assert.equal(normalizeOrderStatus("search"), "search")
  assert.equal(normalizeOrderStatus("delivered"), "delivered")
  assert.equal(normalizeOrderStatus("что-то своё"), null)
  assert.equal(normalizeOrderStatus(""), null)
  assert.equal(normalizeOrderStatus(null), null)
  assert.equal(normalizeOrderStatus(undefined), null)
  assert.equal(normalizeOrderStatus(42), null)
  assert.equal(normalizeOrderStatus({}), null)
  assert.equal(isOrderStatus("confirmed"), false)
  assert.equal(isOrderStatus("agreed"), true)
})

test("подпись неизвестного значения — само значение, а не пустота", () => {
  assert.equal(orderStatusLabel("свой статус"), "свой статус")
  assert.equal(orderStageLabel("свой статус"), "—")
  assert.equal(orderStageOf("свой статус"), null)
})

// ---------------------------------------------------------------------------
// Переходы
// ---------------------------------------------------------------------------

test("заказ проходит весь процесс по шагам", () => {
  const path = [
    "search",
    "negotiation",
    "agreed",
    "in_route",
    "documents",
    "assigned",
    "control",
    "delivered",
  ]
  for (let i = 0; i < path.length - 1; i += 1) {
    assert.ok(
      canChangeOrderStatus(path[i], path[i + 1]),
      `${path[i]} → ${path[i + 1]} должен быть разрешён`,
    )
  }
})

test("шаг назад разрешён: пересогласование и снятие с рейса", () => {
  assert.equal(canChangeOrderStatus("negotiation", "search"), true)
  assert.equal(canChangeOrderStatus("agreed", "negotiation"), true)
  assert.equal(canChangeOrderStatus("in_route", "agreed"), true)
  assert.equal(canChangeOrderStatus("assigned", "in_route"), true)
  assert.equal(canChangeOrderStatus("control", "assigned"), true)
})

test("перепрыгнуть через процесс нельзя", () => {
  assert.equal(canChangeOrderStatus("search", "control"), false)
  assert.equal(canChangeOrderStatus("search", "delivered"), false)
  assert.equal(canChangeOrderStatus("negotiation", "assigned"), false)
  assert.equal(canChangeOrderStatus("search", "in_route"), false)
})

test("закрыть заказ можно с любого открытого статуса", () => {
  for (const status of ACTIVE_ORDER_STATUSES) {
    assert.ok(
      allowedOrderStatuses(status).includes("cancelled"),
      `${status}: отмена должна быть доступна`,
    )
  }
  assert.ok(allowedOrderStatuses("search").includes("rejected"))
  assert.ok(allowedOrderStatuses("agreed").includes("rejected"))
  assert.ok(allowedOrderStatuses("search").includes("expired"))
})

test("закрытые статусы конечны", () => {
  for (const status of CLOSED_ORDER_STATUSES) {
    assert.deepEqual(allowedOrderStatuses(status), [], `${status} не должен никуда вести`)
    assert.equal(canChangeOrderStatus(status, "search"), false)
    assert.equal(canChangeOrderStatus(status, "control"), false)
  }
})

test("повторная установка того же статуса — не ошибка", () => {
  for (const status of ORDER_STATUSES) {
    assert.equal(canChangeOrderStatus(status, status), true, `${status} → ${status}`)
  }
})

test("переходы проверяются и для прежних значений", () => {
  // «confirmed» = «agreed», «in_transit» = «control»
  assert.equal(canChangeOrderStatus("confirmed", "in_route"), true)
  assert.equal(canChangeOrderStatus("new", "negotiation"), true)
  assert.equal(canChangeOrderStatus("in_transit", "delivered"), true)
  assert.equal(canChangeOrderStatus("completed", "in_transit"), false)
  assert.equal(canChangeOrderStatus("неизвестно", "search"), false)
  assert.equal(canChangeOrderStatus("search", "неизвестно"), false)
  assert.deepEqual(allowedOrderStatuses("completed"), [])
})

test("таблица переходов согласована со списком статусов", () => {
  for (const status of ORDER_STATUSES) {
    const allowed = allowedOrderStatuses(status)
    assert.ok(Array.isArray(allowed), `${status}: нет списка переходов`)
    for (const next of allowed) {
      assert.ok(ORDER_STATUSES.includes(next), `${status} → ${next}: неизвестный статус`)
      assert.notEqual(next, status, `${status}: переход в себя не описывается`)
    }
  }
})

// ---------------------------------------------------------------------------
// Наборы статусов
// ---------------------------------------------------------------------------

test("наборы статусов не противоречат друг другу", () => {
  for (const status of CLOSED_ORDER_STATUSES) {
    assert.ok(!ACTIVE_ORDER_STATUSES.includes(status), `${status} не должен быть активным`)
    assert.equal(isOrderClosed(status), true)
    assert.equal(isOrderActive(status), false)
  }
  for (const status of ACTIVE_ORDER_STATUSES) {
    assert.equal(isOrderClosed(status), false)
    assert.equal(isOrderActive(status), true)
  }
  for (const status of MOVING_ORDER_STATUSES) {
    assert.ok(OCCUPYING_ORDER_STATUSES.includes(status), `${status} должен занимать машину`)
  }
  for (const status of OCCUPYING_ORDER_STATUSES) {
    assert.ok(ACTIVE_ORDER_STATUSES.includes(status), `${status} должен быть активным`)
    assert.equal(isOrderOccupying(status), true)
  }
  // активные = все статусы минус закрытые
  assert.equal(
    ACTIVE_ORDER_STATUSES.length + CLOSED_ORDER_STATUSES.length,
    ORDER_STATUSES.length,
  )
})

test("на холст маршрута попадает только согласованный заказ", () => {
  assert.deepEqual([...CANVAS_ORDER_STATUSES], ["agreed"])
  assert.equal(isOrderAgreed("agreed"), true)
  assert.equal(isOrderAgreed("confirmed"), true) // прежнее значение
  assert.equal(isOrderAgreed("search"), false)
  assert.equal(isOrderAgreed("negotiation"), false)
  assert.equal(isOrderAgreed("delivered"), false)
})

test("в рейс можно взять согласованный заказ и тот, что уже в рейсе", () => {
  for (const status of CANVAS_ORDER_STATUSES) {
    assert.ok(ROUTEABLE_ORDER_STATUSES.includes(status), `${status} должен быть в рейсе`)
  }
  for (const status of ["in_route", "documents", "assigned", "control"]) {
    assert.equal(isOrderRouteable(status), true, status)
  }
  for (const status of ["search", "negotiation", "delivered", "cancelled", "rejected", "expired"]) {
    assert.equal(isOrderRouteable(status), false, status)
    assert.equal(isOrderRouteable("неизвестно"), false)
  }
})

test("предикаты понимают прежние значения из базы", () => {
  assert.equal(isOrderMoving("in_transit"), true)
  assert.equal(isOrderMoving("loading"), true)
  assert.equal(isOrderMoving("unloading"), true)
  assert.equal(isOrderMoving("confirmed"), false)
  assert.equal(isOrderClosed("completed"), true)
  assert.equal(isOrderOccupying("confirmed"), false)
  assert.equal(isOrderOccupying("in_transit"), true)
  assert.equal(isOrderActive("new"), true)
})

// ---------------------------------------------------------------------------
// Согласование
// ---------------------------------------------------------------------------

test("лента согласования: виды записей и их подписи", () => {
  assert.deepEqual([...NEGOTIATION_KINDS], [
    "note",
    "price_offer",
    "price_change",
    "call",
    "email",
    "status_change",
    "document",
  ])
  for (const kind of NEGOTIATION_KINDS) {
    assert.ok(NEGOTIATION_KIND_LABELS[kind], `нет подписи вида ${kind}`)
    assert.equal(isNegotiationKind(kind), true)
  }
  assert.equal(isNegotiationKind("что угодно"), false)
  assert.equal(isNegotiationKind(undefined), false)
})

test("состояние переговоров и итог, который переводит заказ", () => {
  assert.deepEqual([...NEGOTIATION_STATUSES], ["new", "in_progress", "agreed", "lost"])
  for (const value of NEGOTIATION_STATUSES) {
    assert.ok(NEGOTIATION_STATUS_LABELS[value], `нет подписи ${value}`)
    assert.equal(isNegotiationStatus(value), true)
  }
  assert.equal(isNegotiationStatus("done"), false)

  // договорились → заказ согласован, не договорились → отклонён
  assert.equal(statusFromNegotiation("agreed"), "agreed")
  assert.equal(statusFromNegotiation("lost"), "rejected")
  // итог ещё не подведён — статус заказа не трогаем
  assert.equal(statusFromNegotiation("new"), null)
  assert.equal(statusFromNegotiation("in_progress"), null)
  assert.equal(statusFromNegotiation("неизвестно"), null)
  assert.equal(statusFromNegotiation(null), null)

  // вывод из переговоров должен быть законным переходом
  assert.equal(canChangeOrderStatus("negotiation", statusFromNegotiation("agreed")), true)
  assert.equal(canChangeOrderStatus("negotiation", statusFromNegotiation("lost")), true)
  assert.equal(canChangeOrderStatus("search", statusFromNegotiation("agreed")), true)
})
