// Тесты порядка точек маршрута рейса (lib/routes/route-points.ts).
//
// Проверяем то, из-за чего карта выглядела сломанной: зигзаг между заказами,
// дубли точек и пробег, завышенный в разы.

import test from "node:test"
import assert from "node:assert"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

const {
  sortOrdersByRouteSequence,
  buildRoutePoints,
} = require("../.test-build/lib/routes/route-points.js")

const MOSCOW = { lat: 55.7558, lng: 37.6173 }
const TULA = { lat: 54.193, lng: 37.6181 }
const VORONEZH = { lat: 51.672, lng: 39.184 }
const KALUGA = { lat: 54.507, lng: 36.2522 }

const pointOf = (address) => {
  const map = {
    "Москва": MOSCOW,
    "Тула": TULA,
    "Воронеж": VORONEZH,
    "Калуга": KALUGA,
  }
  return map[address] ?? null
}

test("заказы идут по routeSequence, а не по дате создания", () => {
  const orders = [
    { routeFrom: "Тула", routeTo: "Воронеж", routeSequence: 2, createdAt: new Date("2026-01-01") },
    { routeFrom: "Москва", routeTo: "Воронеж", routeSequence: 1, createdAt: new Date("2026-01-05") },
  ]
  const sorted = sortOrdersByRouteSequence(orders)
  assert.equal(sorted[0].routeFrom, "Москва")
  assert.equal(sorted[1].routeFrom, "Тула")
})

test("заказ без номера точки идёт последним", () => {
  const orders = [
    { routeFrom: "Калуга", routeTo: "Москва", routeSequence: null, createdAt: new Date("2026-01-01") },
    { routeFrom: "Тула", routeTo: "Воронеж", routeSequence: 1, createdAt: new Date("2026-01-05") },
  ]
  const sorted = sortOrdersByRouteSequence(orders)
  assert.equal(sorted[0].routeSequence, 1)
  assert.equal(sorted[1].routeSequence, null)
})

test("точки идут: водитель → погрузки/выгрузки по порядку → база", () => {
  const points = buildRoutePoints({
    orders: [
      { routeFrom: "Тула", routeTo: "Воронеж", routeSequence: 2, createdAt: new Date() },
      { routeFrom: "Москва", routeTo: "Воронеж", routeSequence: 1, createdAt: new Date() },
    ],
    driverPoint: MOSCOW,
    basePoint: MOSCOW,
    pointOf,
  })
  // Москва (водитель) = Москва (погрузка 1-го заказа) — дубль убран
  assert.deepEqual(points, [MOSCOW, VORONEZH, TULA, VORONEZH, MOSCOW])
  assert.equal(points.length, 5)
  assert.deepEqual(points[0], MOSCOW)
  assert.deepEqual(points[points.length - 1], MOSCOW)
})

test("выгрузка одного заказа и погрузка следующего из одного города не дают петлю", () => {
  const points = buildRoutePoints({
    orders: [
      { routeFrom: "Москва", routeTo: "Калуга", routeSequence: 1, createdAt: new Date() },
      { routeFrom: "Калуга", routeTo: "Воронеж", routeSequence: 2, createdAt: new Date() },
    ],
    driverPoint: null,
    basePoint: MOSCOW,
    pointOf,
  })
  assert.deepEqual(points, [MOSCOW, KALUGA, VORONEZH, MOSCOW])
})

test("без водителя маршрут начинается с первой погрузки", () => {
  const points = buildRoutePoints({
    orders: [{ routeFrom: "Тула", routeTo: "Воронеж", routeSequence: 1, createdAt: new Date() }],
    driverPoint: null,
    basePoint: MOSCOW,
    pointOf,
  })
  assert.deepEqual(points, [TULA, VORONEZH, MOSCOW])
})

test("негеокодируемый адрес не ломает порядок — точка пропускается", () => {
  const points = buildRoutePoints({
    orders: [
      { routeFrom: "Никгде", routeTo: "Воронеж", routeSequence: 1, createdAt: new Date() },
      { routeFrom: "Тула", routeTo: "Калуга", routeSequence: 2, createdAt: new Date() },
    ],
    driverPoint: null,
    basePoint: MOSCOW,
    pointOf,
  })
  assert.deepEqual(points, [VORONEZH, TULA, KALUGA, MOSCOW])
})

test("рейс, заканчивающийся на базе, не получает лишний хвост", () => {
  const points = buildRoutePoints({
    orders: [{ routeFrom: "Тула", routeTo: "Москва", routeSequence: 1, createdAt: new Date() }],
    driverPoint: null,
    basePoint: MOSCOW,
    pointOf,
  })
  assert.deepEqual(points, [TULA, MOSCOW])
})
