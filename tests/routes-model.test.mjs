/**
 * Тесты доменной модели рейса (задача 2): статусы, переходы, итоги, имя рейса.
 * База данных не нужна — проверяются чистые функции lib/routes/model.ts.
 * Запуск: npm test
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  ROUTE_STATUSES,
  ROUTE_STATUS_LABELS,
  ACTIVE_ORDER_STATUSES,
  MOVING_ORDER_STATUSES,
  CLOSED_ORDER_STATUSES,
  OCCUPYING_ORDER_STATUSES,
  isRouteStatus,
  normalizeRouteStatus,
  routeStatusLabel,
  allowedRouteTransitions,
  canTransitionRoute,
  deriveRouteStatus,
  summarizeRoute,
  buildRouteName,
  formatRouteTitle,
} = require("../.test-build/lib/routes/model.js")

const order = (overrides = {}) => ({
  id: "o1",
  status: "confirmed",
  routeFrom: "Ярославль",
  routeTo: "Иваново",
  distance: 120,
  weight: 5000,
  volume: 20,
  price: 45000,
  isAdditionalLoad: false,
  routeSequence: 1,
  ...overrides,
})

// ───────────────────────────── справочники статусов ─────────────────────────────

test("статусы рейса и заказов согласованы", () => {
  assert.deepEqual([...ROUTE_STATUSES], [
    "planned",
    "active",
    "in_transit",
    "completed",
    "cancelled",
  ])
  for (const status of ROUTE_STATUSES) {
    assert.ok(ROUTE_STATUS_LABELS[status], `нет подписи для ${status}`)
    assert.equal(typeof ROUTE_STATUS_LABELS[status], "string")
  }
  // статусы, занимающие водителя и машину, — это активные заказы
  // наборы приходят из канона lib/orders/stages.ts: занимающие машину и водителя —
  // это подмножество активных (заказ в рейсе, на документах, назначен, на контроле)
  for (const s of OCCUPYING_ORDER_STATUSES) {
    assert.ok(ACTIVE_ORDER_STATUSES.includes(s), `${s} должен быть в активных`)
  }
  assert.ok(OCCUPYING_ORDER_STATUSES.length < ACTIVE_ORDER_STATUSES.length)
  for (const s of MOVING_ORDER_STATUSES) {
    assert.ok(ACTIVE_ORDER_STATUSES.includes(s), `${s} должен быть в активных`)
  }
  for (const s of CLOSED_ORDER_STATUSES) {
    assert.ok(!ACTIVE_ORDER_STATUSES.includes(s), `${s} не должен быть в активных`)
  }
})

test("проверка и нормализация статуса рейса", () => {
  assert.equal(isRouteStatus("in_transit"), true)
  assert.equal(isRouteStatus("delivered"), false, "delivered — статус заказа, не рейса")
  assert.equal(isRouteStatus(null), false)
  assert.equal(isRouteStatus(42), false)
  assert.equal(normalizeRouteStatus("planned"), "planned")
  assert.equal(normalizeRouteStatus("что-то"), null)
})

test("подпись статуса: известная — по-русски, неизвестная — как есть", () => {
  assert.equal(routeStatusLabel("in_transit"), "В пути")
  assert.equal(routeStatusLabel("completed"), "Завершён")
  assert.equal(routeStatusLabel("неизвестный"), "неизвестный")
  assert.equal(routeStatusLabel(null), "")
})

// ─────────────────────────────── переходы статусов ───────────────────────────────

test("разрешённые переходы статусов рейса", () => {
  assert.equal(canTransitionRoute("planned", "active").ok, true)
  assert.equal(canTransitionRoute("planned", "in_transit").ok, true)
  assert.equal(canTransitionRoute("planned", "completed").ok, true, "все точки доставлены сразу")
  assert.equal(canTransitionRoute("active", "in_transit").ok, true)
  assert.equal(canTransitionRoute("in_transit", "completed").ok, true)
  assert.equal(canTransitionRoute("in_transit", "cancelled").ok, true)
})

test("запрещённые переходы объясняются понятной причиной", () => {
  const back = canTransitionRoute("completed", "in_transit")
  assert.equal(back.ok, false)
  assert.match(back.reason, /Завершён/)

  const fromCancelled = canTransitionRoute("cancelled", "completed")
  assert.equal(fromCancelled.ok, false)
  assert.match(fromCancelled.reason, /Нельзя перевести/)

  assert.equal(canTransitionRoute("cancelled", "planned").ok, true, "отменённый рейс можно вернуть в план")
})

test("повторная установка того же статуса — не ошибка", () => {
  const same = canTransitionRoute("in_transit", "in_transit")
  assert.equal(same.ok, true)
  assert.equal(same.reason, "Статус не меняется")
})

test("неизвестный статус не проходит проверку перехода", () => {
  assert.equal(canTransitionRoute("planned", "delivered").ok, false)
  assert.equal(canTransitionRoute("wat", "planned").ok, false)
})

test("из каждого статуса есть хотя бы один переход, кроме завершённого", () => {
  for (const status of ROUTE_STATUSES) {
    const allowed = allowedRouteTransitions(status)
    if (status === "completed") {
      assert.equal(allowed.length, 0, "завершённый рейс — терминальный")
    } else {
      assert.ok(allowed.length > 0, `у ${status} нет переходов`)
    }
  }
})

// ──────────────────────────── вывод статуса по заказам ────────────────────────────

test("рейс без заказов — запланирован", () => {
  assert.equal(deriveRouteStatus([]), "planned")
})

test("подтверждённые заказы дают «запланирован», а начатый рейс — «назначен»", () => {
  assert.equal(deriveRouteStatus(["confirmed", "confirmed"]), "planned")
  assert.equal(deriveRouteStatus(["confirmed"], { startedAt: new Date() }), "active")
})

test("заказ в работе переводит рейс в путь", () => {
  assert.equal(deriveRouteStatus(["confirmed", "in_transit"]), "in_transit")
  assert.equal(deriveRouteStatus(["loading"]), "in_transit")
  assert.equal(deriveRouteStatus(["unloading"]), "in_transit")
})

test("все точки доставлены — рейс завершён", () => {
  assert.equal(deriveRouteStatus(["delivered", "delivered"]), "completed")
  assert.equal(deriveRouteStatus(["delivered", "cancelled"]), "completed")
  assert.equal(deriveRouteStatus(["confirmed"], { completedAt: new Date() }), "completed")
})

test("все заказы отменены — рейс отменён", () => {
  assert.equal(deriveRouteStatus(["cancelled"]), "cancelled")
  assert.equal(deriveRouteStatus(["cancelled", "rejected"]), "cancelled")
  assert.equal(deriveRouteStatus(["rejected", "rejected"], { completedAt: new Date() }), "cancelled",
    "явный финиш не перевешивает полную отмену")
})

test("смешанные незакрытые заказы держат рейс в работе", () => {
  assert.equal(deriveRouteStatus(["delivered", "confirmed"]), "planned")
  assert.equal(deriveRouteStatus(["delivered", "in_transit"]), "in_transit")
})

test("мусор на входе не ломает вывод статуса", () => {
  assert.equal(deriveRouteStatus([undefined, null, ""]), "planned")
  assert.equal(deriveRouteStatus(null), "planned")
})

// ───────────────────────────────── итоги рейса ─────────────────────────────────

test("итоги рейса считаются по заказам", () => {
  const summary = summarizeRoute([
    order({ distance: 100, weight: 1000, volume: 10, price: 50000 }),
    order({ id: "o2", distance: 250, weight: 2500, volume: 12.5, price: 70000, isAdditionalLoad: true }),
    order({ id: "o3", status: "delivered", distance: 50, weight: 500, volume: 2, price: 10000 }),
  ])

  assert.equal(summary.totalOrders, 3)
  assert.equal(summary.totalDistance, 400)
  assert.equal(summary.cargoWeight, 4000)
  assert.equal(summary.cargoVolume, 24.5)
  assert.equal(summary.revenue, 130000)
  assert.equal(summary.deliveredOrders, 1)
  assert.equal(summary.pendingOrders, 2)
  assert.equal(summary.additionalLoads, 1)
})

test("отменённые заказы не дают выручку, но остаются в составе рейса", () => {
  const summary = summarizeRoute([
    order({ price: 50000 }),
    order({ id: "o2", status: "cancelled", price: 90000 }),
    order({ id: "o3", status: "rejected", price: 90000 }),
  ])

  assert.equal(summary.revenue, 50000)
  assert.equal(summary.totalOrders, 3)
  assert.equal(summary.cancelledOrders, 2)
  assert.equal(summary.pendingOrders, 1)
})

test("итоги пустого рейса — нули", () => {
  const summary = summarizeRoute([])
  assert.deepEqual(summary, {
    totalOrders: 0,
    totalDistance: 0,
    cargoWeight: 0,
    cargoVolume: 0,
    revenue: 0,
    deliveredOrders: 0,
    activeOrders: 0,
    cancelledOrders: 0,
    pendingOrders: 0,
    additionalLoads: 0,
  })
})

test("итоги не ломаются на null/undefined и строковых числах", () => {
  const summary = summarizeRoute([
    order({ distance: null, weight: undefined, volume: null, price: null }),
    { status: "confirmed", distance: "120", weight: "1000", price: "5000" },
  ])
  assert.equal(summary.totalDistance, 120)
  assert.equal(summary.cargoWeight, 1000)
  assert.equal(summary.revenue, 5000)
})

// ───────────────────────────────── имя рейса ─────────────────────────────────

test("имя рейса строится по точкам в порядке маршрута", () => {
  const name = buildRouteName([
    order({ routeFrom: "Ярославль", routeTo: "Иваново", routeSequence: 1 }),
    order({ id: "o2", routeFrom: "Иваново", routeTo: "Санкт-Петербург", routeSequence: 2 }),
  ])
  assert.equal(name, "Ярославль → Иваново → Санкт-Петербург")
})

test("порядок берётся из routeSequence, а не из порядка массива", () => {
  const name = buildRouteName([
    order({ id: "o2", routeFrom: "Иваново", routeTo: "Санкт-Петербург", routeSequence: 2 }),
    order({ routeFrom: "Ярославль", routeTo: "Иваново", routeSequence: 1 }),
  ])
  assert.equal(name, "Ярославль → Иваново → Санкт-Петербург")
})

test("подряд идущие одинаковые города схлопываются, регистр не важен", () => {
  const name = buildRouteName([
    order({ routeFrom: "Москва", routeTo: "иваново", routeSequence: 1 }),
    order({ id: "o2", routeFrom: "Иваново", routeTo: "Кострома", routeSequence: 2 }),
  ])
  assert.equal(name, "Москва → иваново → Кострома")
})

test("пустые города пропускаются, пустой рейс даёт пустое имя", () => {
  assert.equal(buildRouteName([]), "")
  assert.equal(buildRouteName([order({ routeFrom: "", routeTo: "  " })]), "")
  assert.equal(
    buildRouteName([order({ routeFrom: null, routeTo: "Тула" })]),
    "Тула",
  )
})

test("короткая подпись рейса: имя и число точек", () => {
  assert.equal(formatRouteTitle({ name: "Ярославль → Иваново" }, 3), "Ярославль → Иваново · 3 точки")
  assert.equal(formatRouteTitle({ name: "Ярославль → Иваново" }, 1), "Ярославль → Иваново · 1 точка")
  assert.equal(formatRouteTitle({ name: "Ярославль → Иваново" }, 5), "Ярославль → Иваново · 5 точек")
  assert.equal(formatRouteTitle({ name: null, status: "in_transit" }), "В пути")
  assert.equal(formatRouteTitle({ name: "Рейс 1" }, 0), "Рейс 1")
})
