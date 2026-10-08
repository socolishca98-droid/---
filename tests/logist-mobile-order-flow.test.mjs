/**
 * Тесты «туннеля» заказа в мобильной панели (lib/logist-mobile/order-flow.ts).
 *
 * Здесь защищается главное обещание экрана заказов: логист всегда видит один
 * понятный следующий шаг, подсказку о том, что мешает, и фильтры, которые не
 * врут счётчиками. База данных не нужна — проверяются чистые функции.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  ORDER_PIPELINE,
  MOBILE_STAGE_TITLES,
  orderSteps,
  progressLabel,
  nextStep,
  orderChecks,
  listHint,
  daysToDeadline,
  matchesView,
  matchesQuery,
  filterOrders,
  stageCounters,
  viewCounts,
  sortOrders,
} = require("../.test-build/lib/logist-mobile/order-flow.js")

/** Заказ-заготовка: поля можно переопределить в конкретном тесте. */
function order(overrides = {}) {
  return {
    id: "demo-order-7",
    status: "search",
    routeFrom: "Москва, улица Складская, 8",
    routeTo: "Калуга, улица Московская, 289",
    deadline: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    clientName: "ООО «Ромашка»",
    clientContact: "Петрова, +7 495 123-45-67",
    cargoType: "Паллеты",
    price: 38000,
    agreedPrice: null,
    assignedDriverId: null,
    assignedVehicleId: null,
    ...overrides,
  }
}

const NOW = new Date("2026-10-08T12:00:00.000Z")

test("этапы заказа: пройденные, текущий и предстоящие", () => {
  assert.equal(ORDER_PIPELINE.length, 6)

  const steps = orderSteps("documents")
  assert.deepEqual(
    steps.map((item) => item.state),
    ["done", "done", "done", "current", "todo", "todo"],
  )
  assert.equal(steps[3].title, MOBILE_STAGE_TITLES.documents)

  // Первый этап — текущий, остальные впереди
  assert.deepEqual(
    orderSteps("search").map((item) => item.state),
    ["current", "todo", "todo", "todo", "todo", "todo"],
  )

  // Закрытый заказ: прогресс не рисуем — все шаги закрыты
  assert.deepEqual(
    orderSteps("cancelled").map((item) => item.state),
    ["closed", "closed", "closed", "closed", "closed", "closed"],
  )

  // Прежние (легас) значения нормализуются: in_transit — это «на контроле»
  assert.equal(orderSteps("in_transit").at(-1).state, "current")
  assert.equal(orderSteps("loading").at(-1).state, "current")
  // Доставленный заказ — закрытый: прогресс по нему не рисуем
  assert.equal(orderSteps("completed").at(-1).state, "closed")

  assert.equal(progressLabel("documents"), "Этап 4 из 6 · Документы")
  assert.equal(progressLabel("cancelled"), "Заказ закрыт")
})

test("следующий шаг: одна понятная кнопка на каждый статус", () => {
  const expected = {
    search: "negotiation",
    negotiation: "agreed",
    agreed: "in_route",
    in_route: "documents",
    documents: "assigned",
    assigned: "control",
    control: "delivered",
  }

  for (const [from, to] of Object.entries(expected)) {
    const step = nextStep(from)
    assert.equal(step?.status, to, `из ${from} ждём шаг в ${to}`)
    assert.ok(step.title.length > 0, `у ${from} должна быть подпись кнопки`)
    assert.ok(step.why.length > 10, `у ${from} должно быть объяснение, зачем шаг`)
  }

  // Закрытые заказы дальше не идут
  for (const status of ["delivered", "cancelled", "rejected", "expired"]) {
    assert.equal(nextStep(status), null, `${status} не должен предлагать шаг`)
  }

  // Прежний статус «new» — это «в поиске»
  assert.equal(nextStep("new")?.status, "negotiation")
  // Неизвестный статус не выдумываем
  assert.equal(nextStep("какой-то-статус"), null)

  // Доставка — «успешный» шаг, он зелёный
  assert.equal(nextStep("control")?.tone, "success")
  assert.equal(nextStep("negotiation")?.tone, "primary")
})

test("что мешает заказу: подсказки с понятной причиной", () => {
  // Согласованный заказ без водителя и машины — это стоп
  const stuck = orderChecks(order({ status: "agreed", price: 0, clientContact: "", deadline: null }))
  const ids = stuck.map((item) => item.id)
  assert.ok(ids.includes("driver"))
  assert.ok(ids.includes("vehicle"))
  assert.ok(ids.includes("price"))
  assert.ok(ids.includes("contact"))
  assert.ok(ids.includes("deadline"))
  assert.equal(stuck.find((item) => item.id === "driver").tone, "warn")
  assert.equal(stuck.find((item) => item.id === "price").fix, "price")

  // Полный заказ: не мешает ничего
  assert.deepEqual(
    orderChecks(
      order({
        status: "control",
        price: 38000,
        clientContact: "+7 495 123-45-67",
        deadline: "2026-10-10T18:00:00.000Z",
        assignedDriverId: "driver-1",
        assignedVehicleId: "vehicle-1",
      }),
    ),
    [],
  )

  // На этапе поиска водителя ещё не требует: заказ только ищет машину
  const searching = orderChecks(order({ status: "search", assignedDriverId: null }))
  assert.ok(!searching.some((item) => item.id === "driver"))

  // Просрочка — отдельная подсказка
  const late = orderChecks(order({ status: "assigned", deadline: "2026-10-05T18:00:00.000Z" }))
  assert.ok(late.some((item) => item.id === "overdue" && item.tone === "warn"))

  // У закрытого заказа подсказок нет: работа сделана
  assert.deepEqual(orderChecks(order({ status: "delivered" })), [])
})

test("строка-подсказка в списке: сначала стоп, потом следующий шаг", () => {
  // Мешает водитель → предупреждение важнее плана
  const warn = listHint(order({ status: "agreed", assignedDriverId: null, assignedVehicleId: "vehicle-1" }))
  assert.equal(warn.tone, "warn")
  assert.match(warn.text, /водитель/i)

  // Просрочку показывает строка срока — в подсказке её быть не должно
  const late = listHint(
    order({
      status: "assigned",
      deadline: "2026-10-05T18:00:00.000Z",
      assignedDriverId: "driver-1",
      assignedVehicleId: "vehicle-1",
    }),
  )
  assert.equal(late.tone, "info")
  assert.equal(late.text, "Дальше: машина в пути")

  // Всё в порядке → показываем следующий шаг
  const plan = listHint(
    order({
      status: "assigned",
      deadline: "2026-10-10T18:00:00.000Z",
      assignedDriverId: "driver-1",
      assignedVehicleId: "vehicle-1",
    }),
  )
  assert.equal(plan.tone, "info")
  assert.equal(plan.text, "Дальше: машина в пути")

  // Закрытые заказы в списке ни к чему не зовут
  assert.equal(listHint(order({ status: "delivered" })), null)
})

test("срок: сегодня и просрочено считаются по календарным дням", () => {
  assert.equal(daysToDeadline("2026-10-08T09:00:00.000Z", NOW), 0)
  assert.equal(daysToDeadline("2026-10-09T09:00:00.000Z", NOW), 1)
  assert.equal(daysToDeadline("2026-10-06T09:00:00.000Z", NOW), -2)
  assert.equal(daysToDeadline(null, NOW), null)

  const today = order({ status: "assigned", deadline: "2026-10-08T18:00:00.000Z" })
  const late = order({ status: "assigned", deadline: "2026-10-05T18:00:00.000Z" })
  const later = order({ status: "assigned", deadline: "2026-10-15T18:00:00.000Z" })
  const closedLate = order({ status: "delivered", deadline: "2026-10-05T18:00:00.000Z" })

  assert.equal(matchesView(today, "today", NOW), true)
  assert.equal(matchesView(today, "overdue", NOW), false)
  assert.equal(matchesView(late, "overdue", NOW), true)
  assert.equal(matchesView(late, "today", NOW), false)
  // Закрытый заказ не попадает ни в «сегодня», ни в «просрочено»
  assert.equal(matchesView(closedLate, "overdue", NOW), false)
  assert.equal(matchesView(closedLate, "all", NOW), true)
  assert.equal(matchesView(later, "active", NOW), true)

  const counts = viewCounts([today, late, later, closedLate], NOW)
  assert.deepEqual(counts, { active: 3, today: 1, overdue: 1, all: 4 })
})

test("поиск: по номеру, клиенту, городу и грузу", () => {
  const target = order({ id: "demo-order-7" })

  assert.equal(matchesQuery(target, "order-7"), true)
  assert.equal(matchesQuery(target, "demo-order-7"), true)
  assert.equal(matchesQuery(target, "РОМАШКА"), true)
  assert.equal(matchesQuery(target, "калуга"), true)
  assert.equal(matchesQuery(target, "паллеты"), true)
  assert.equal(matchesQuery(target, "+7 495"), true)
  assert.equal(matchesQuery(target, "   "), true)
  assert.equal(matchesQuery(target, "владивосток"), false)
})

test("фильтры вместе: представление, этап и поиск", () => {
  const orders = [
    order({ id: "demo-order-1", status: "search", deadline: "2026-10-05T18:00:00.000Z" }),
    order({ id: "demo-order-2", status: "documents", deadline: "2026-10-08T18:00:00.000Z" }),
    order({ id: "demo-order-3", status: "documents", deadline: "2026-10-20T18:00:00.000Z" }),
    order({ id: "demo-order-4", status: "delivered", deadline: "2026-10-01T18:00:00.000Z" }),
  ]

  assert.deepEqual(
    filterOrders(orders, { view: "overdue", now: NOW }).map((item) => item.id),
    ["demo-order-1"],
  )
  assert.deepEqual(
    filterOrders(orders, { stage: "documents", now: NOW }).map((item) => item.id),
    ["demo-order-2", "demo-order-3"],
  )
  assert.deepEqual(
    filterOrders(orders, { view: "today", stage: "documents", now: NOW }).map((item) => item.id),
    ["demo-order-2"],
  )
  assert.deepEqual(
    filterOrders(orders, { query: "order-4", now: NOW }).map((item) => item.id),
    ["demo-order-4"],
  )
})

test("счётчики этапов честно говорят, сколько откроется", () => {
  const orders = [
    order({ status: "search" }),
    order({ status: "negotiation" }),
    order({ status: "agreed" }),
    order({ status: "in_route" }),
    order({ status: "documents" }),
    order({ status: "documents" }),
    order({ status: "assigned" }),
    order({ status: "control" }),
    order({ status: "delivered" }),
    order({ status: "cancelled" }),
  ]

  const counters = stageCounters(orders)
  const byStage = Object.fromEntries(counters.map((item) => [item.stage, item.count]))

  assert.equal(counters.length, 7)
  assert.equal(byStage.search, 1)
  assert.equal(byStage.negotiation, 2) // negotiation + agreed — один этап «Договариваемся»
  assert.equal(byStage.route, 1)
  assert.equal(byStage.documents, 2)
  assert.equal(byStage.assignment, 1)
  assert.equal(byStage.control, 1)
  assert.equal(byStage.closed, 2)

  // Сумма по этапам равна числу заказов: ни один не потерялся
  assert.equal(
    counters.reduce((sum, item) => sum + item.count, 0),
    orders.length,
  )
})

test("порядок в списке: горящее сверху, закрытое снизу", () => {
  const sorted = sortOrders([
    order({ id: "closed", status: "delivered", deadline: "2026-10-01T18:00:00.000Z" }),
    order({ id: "later", status: "assigned", deadline: "2026-10-20T18:00:00.000Z" }),
    order({ id: "late", status: "assigned", deadline: "2026-10-05T18:00:00.000Z" }),
    order({ id: "today", status: "assigned", deadline: "2026-10-08T18:00:00.000Z" }),
    order({ id: "no-date", status: "search", deadline: null }),
  ])

  assert.deepEqual(
    sorted.map((item) => item.id),
    ["late", "today", "later", "no-date", "closed"],
  )
})
