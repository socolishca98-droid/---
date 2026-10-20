// Тесты идемпотентного завершения рейса (этап «сохранность данных»).
//
// Повторный вызов для уже завершённого рейса — no-op: completedAt, топливо
// и итоги не переписываются, события не создаются.

import test from "node:test"
import assert from "node:assert"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

const {
  decideRouteCompletion,
  normalizeRouteStatusLoose,
} = require("../.test-build/lib/routes/complete-policy.js")

test("историческое значение in_progress нормализуется в in_transit", () => {
  assert.equal(normalizeRouteStatusLoose("in_progress"), "in_transit")
  assert.equal(normalizeRouteStatusLoose("in_transit"), "in_transit")
  assert.equal(normalizeRouteStatusLoose("planned"), "planned")
  assert.equal(normalizeRouteStatusLoose(null), "")
})

test("завершённый рейс: повторное завершение — no-op", () => {
  const decision = decideRouteCompletion({ status: "completed" })
  assert.equal(decision.kind, "noop")
  assert.match(decision.reason, /уже завершён/i)
})

test("рейс в пути: завершение выполняется", () => {
  assert.equal(decideRouteCompletion({ status: "in_transit" }).kind, "complete")
})

test("исторический in_progress тоже считается незавершённым", () => {
  assert.equal(decideRouteCompletion({ status: "in_progress" }).kind, "complete")
})

test("запланированный и активный рейс можно завершать", () => {
  assert.equal(decideRouteCompletion({ status: "planned" }).kind, "complete")
  assert.equal(decideRouteCompletion({ status: "active" }).kind, "complete")
})

test("отменённый рейс не считается завершённым (переход разрешён матрицей)", () => {
  // cancelled → completed допустим по ROUTE_TRANSITIONS: рейс отменили,
  // но точки могли доехать — решение о завершении принимает вызывающий код.
  assert.equal(decideRouteCompletion({ status: "cancelled" }).kind, "complete")
})
