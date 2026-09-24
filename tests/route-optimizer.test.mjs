/**
 * Тесты логики сценариев рейса (задача 3, пункт 2).
 *
 * Проверяется то, что считается без сети и без базы: нормализация городов,
 * отбор заказов, порядок объезда и различия сценариев между собой.
 * Реальные километры/время/деньги здесь не проверяются — их считает сервер
 * (app/api/routes/optimizer/route.ts) на данных OSRM.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  OPTIMIZER_VARIANTS,
  clamp,
  filterOptimizableOrders,
  normalizeCity,
  parseDeadline,
  sequenceOrders,
  variantPolicy,
} = require("../.test-build/lib/routes/optimizer.js")

const order = (id, routeFrom, routeTo, extra = {}) => ({
  id,
  routeFrom,
  routeTo,
  distance: extra.distance ?? 500,
  weight: extra.weight ?? 5000,
  price: extra.price ?? 40000,
  deadline: extra.deadline ?? null,
  status: extra.status ?? "agreed",
})

test("нормализация города: регистр, запятая, ё", () => {
  assert.equal(normalizeCity("Москва, Россия"), "москва")
  assert.equal(normalizeCity("  КОРЁЛЕВО "), "корелево")
  assert.equal(normalizeCity("Тула"), normalizeCity("тула,"))
  assert.equal(normalizeCity(undefined), "")
  assert.equal(normalizeCity(null), "")
})

test("clamp держит границы", () => {
  assert.equal(clamp(5, 0, 10), 5)
  assert.equal(clamp(-3, 0, 10), 0)
  assert.equal(clamp(42, 0, 10), 10)
})

test("parseDeadline понимает дату, строку и мусор", () => {
  const date = new Date("2026-10-01T00:00:00.000Z")
  assert.equal(parseDeadline(date)?.toISOString(), date.toISOString())
  assert.equal(parseDeadline("2026-10-01T00:00:00.000Z")?.toISOString(), date.toISOString())
  assert.equal(parseDeadline("не дата"), null)
  assert.equal(parseDeadline(null), null)
  assert.equal(parseDeadline(undefined), null)
})

test("завершённые заказы в сценарии не попадают, неизвестный статус — попадает", () => {
  const orders = [
    order("a", "Москва", "Тула", { status: "agreed" }),
    order("b", "Тула", "Казань", { status: "delivered" }),
    order("c", "Казань", "Москва", { status: "cancelled" }),
    order("d", "Москва", "Тверь", { status: "rejected" }),
    order("e", "Тверь", "Москва", { status: "search" }),
    order("f", "Москва", "Тула", { status: undefined }),
    order("g", "Москва", "Тула", { status: "какой-то-старый-статус" }),
  ]

  const kept = filterOptimizableOrders(orders).map((item) => item.id)
  assert.deepEqual(kept, ["a", "e", "f", "g"])
})

test("все завершённые заказы отсекаются полностью", () => {
  const orders = [
    order("a", "Москва", "Тула", { status: "delivered" }),
    order("b", "Тула", "Казань", { status: "cancelled" }),
  ]
  assert.equal(filterOptimizableOrders(orders).length, 0)
})

test("порядок объезда продолжает маршрут: выгрузка → погрузка следующего", () => {
  const orders = [
    order("a", "Москва", "Тула"),
    order("b", "Тула", "Казань"),
    order("c", "Казань", "Пермь"),
  ]

  for (const variant of OPTIMIZER_VARIANTS) {
    assert.deepEqual(sequenceOrders(orders, variant), ["a", "b", "c"], variant)
  }
})

test("цепочка собирается и когда заказы переданы вперемешку", () => {
  const orders = [
    order("c", "Казань", "Пермь"),
    order("a", "Москва", "Тула"),
    order("d", "Москва", "Тверь"),
    order("b", "Тула", "Казань"),
  ]

  const ids = sequenceOrders(orders, "balanced")
  // Москва → Тула → Казань → Пермь идут подряд: между ними нет порожних перегонов
  const position = (id) => ids.indexOf(id)
  assert.ok(position("a") < position("b"))
  assert.ok(position("b") < position("c"))
  assert.equal(ids.length, 4)
})

test("сценарии дают разные порядки, когда выгода конфликтует со срочностью", () => {
  const now = Date.now()
  const orders = [
    // срочный, но невыгодный по километру
    order("urgent", "Москва", "Ярославль", {
      price: 8000,
      distance: 400,
      deadline: new Date(now + 6 * 3600 * 1000),
    }),
    // обычный, выгодный
    order("profitable", "Москва", "Владимир", { price: 60000, distance: 200 }),
    // короткий и дешёвый по пробегу
    order("near", "Москва", "Подольск", { price: 15000, distance: 40 }),
  ]

  const fast = sequenceOrders(orders, "fast")
  const cheap = sequenceOrders(orders, "cheap")
  const balanced = sequenceOrders(orders, "balanced")

  assert.equal(fast.length, 3)
  assert.equal(cheap.length, 3)
  assert.equal(balanced.length, 3)

  // разные политики дают разные первые точки хотя бы в одном сравнении
  const different = fast[0] !== cheap[0] || cheap[0] !== balanced[0] || fast[0] !== balanced[0]
  assert.ok(different, `порядки совпали: fast=${fast} cheap=${cheap} balanced=${balanced}`)
})

test("пустой список и один заказ", () => {
  assert.deepEqual(sequenceOrders([], "fast"), [])
  assert.deepEqual(sequenceOrders([order("a", "Москва", "Тула")], "cheap"), ["a"])
})

test("порядок не теряет и не дублирует заказы", () => {
  const orders = [
    order("a", "Москва", "Тула"),
    order("b", "Тверь", "Москва"),
    order("c", "Казань", "Пермь"),
    order("d", "Пермь", "Москва"),
  ]

  for (const variant of OPTIMIZER_VARIANTS) {
    const ids = sequenceOrders(orders, variant)
    assert.equal(ids.length, 4, variant)
    assert.equal(new Set(ids).size, 4, variant)
    assert.deepEqual([...ids].sort(), ["a", "b", "c", "d"], variant)
  }
})

test("у каждого сценария есть понятное название и объяснение", () => {
  for (const variant of OPTIMIZER_VARIANTS) {
    const policy = variantPolicy(variant)
    assert.ok(policy.title.length > 0)
    assert.ok(policy.subtitle.length > 0)
    assert.ok(policy.notes.length > 0)
  }

  assert.equal(variantPolicy("fast").title, "Быстрее")
  assert.equal(variantPolicy("cheap").title, "Дешевле")
  assert.equal(variantPolicy("balanced").title, "Сбалансировано")
})
