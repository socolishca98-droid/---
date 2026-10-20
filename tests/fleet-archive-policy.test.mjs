// Тесты политики удаления/архивирования водителя и машины
// (этап «сохранность данных»).
//
// Правило: физическое удаление только без единой связанной исторической
// записи; любая история (смены, SOS, фото, события, ТО, рейсы) — архив.

import test from "node:test"
import assert from "node:assert"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

const {
  decideDriverRemoval,
  decideVehicleRemoval,
} = require("../.test-build/lib/fleet/archive-policy.js")

const noHistory = {
  shifts: 0,
  shiftEvents: 0,
  sosAlerts: 0,
  photos: 0,
  routeEvents: 0,
}

test("водитель без истории удаляется физически", () => {
  assert.deepEqual(decideDriverRemoval({ ...noHistory }), { action: "delete" })
})

test("водитель со сменами архивируется", () => {
  assert.deepEqual(decideDriverRemoval({ ...noHistory, shifts: 2 }), { action: "archive" })
})

test("водитель с SOS архивируется", () => {
  assert.deepEqual(decideDriverRemoval({ ...noHistory, sosAlerts: 1 }), { action: "archive" })
})

test("водитель с фото архивируется", () => {
  assert.deepEqual(decideDriverRemoval({ ...noHistory, photos: 4 }), { action: "archive" })
})

test("водитель с событиями рейсов архивируется", () => {
  assert.deepEqual(decideDriverRemoval({ ...noHistory, routeEvents: 1 }), { action: "archive" })
})

test("события смен тоже считаются историей", () => {
  assert.deepEqual(decideDriverRemoval({ ...noHistory, shiftEvents: 3 }), { action: "archive" })
})

const emptyVehicle = {
  maintenanceLogs: 0,
  routes: 0,
  orders: 0,
  routeEvents: 0,
  stages: 0,
}

test("машина без истории удаляется физически", () => {
  assert.deepEqual(decideVehicleRemoval({ ...emptyVehicle }), { action: "delete" })
})

test("машина с ТО архивируется", () => {
  assert.deepEqual(decideVehicleRemoval({ ...emptyVehicle, maintenanceLogs: 1 }), { action: "archive" })
})

test("машина с рейсами архивируется", () => {
  assert.deepEqual(decideVehicleRemoval({ ...emptyVehicle, routes: 1 }), { action: "archive" })
})

test("машина с заказами архивируется", () => {
  assert.deepEqual(decideVehicleRemoval({ ...emptyVehicle, orders: 5 }), { action: "archive" })
})

test("машина с этапами или событиями архивируется", () => {
  assert.deepEqual(decideVehicleRemoval({ ...emptyVehicle, stages: 1 }), { action: "archive" })
  assert.deepEqual(decideVehicleRemoval({ ...emptyVehicle, routeEvents: 2 }), { action: "archive" })
})
