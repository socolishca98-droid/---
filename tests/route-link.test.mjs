import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { needsOwnRoute, canAssignToDriver } = require("../.test-build/lib/orders/route-link.js")

test("заказ в рейсе с водителем и без рейса получает свой рейс", () => {
  // Именно этого не хватало: статус «в рейсе» менялся, а водитель не видел
  // заказ, потому что routeId оставался пустым
  assert.equal(needsOwnRoute({ status: "in_route", assignedDriverId: "d1" }), true)
  assert.equal(needsOwnRoute({ status: "assigned", assignedDriverId: "d1", routeId: null }), true)
  assert.equal(needsOwnRoute({ status: "control", assignedDriverId: "d1" }), true)
})

test("без водителя рейс не создаём — ехать некому", () => {
  assert.equal(needsOwnRoute({ status: "in_route", assignedDriverId: null }), false)
})

test("уже привязанный или закрытый заказ не трогаем", () => {
  assert.equal(needsOwnRoute({ status: "in_route", assignedDriverId: "d1", routeId: "r1" }), false)
  assert.equal(needsOwnRoute({ status: "delivered", assignedDriverId: "d1" }), false)
  assert.equal(needsOwnRoute({ status: "negotiation", assignedDriverId: "d1" }), false)
  assert.equal(needsOwnRoute({ status: "неизвестный", assignedDriverId: "d1" }), false)
})

test("в «Назначен» нельзя без водителя", () => {
  assert.equal(canAssignToDriver({ nextStatus: "assigned", driverId: "d1" }), true)
  assert.equal(canAssignToDriver({ nextStatus: "assigned", driverId: null }), false)
  // остальные переходы не ограничиваем
  assert.equal(canAssignToDriver({ nextStatus: "in_route", driverId: null }), true)
})
