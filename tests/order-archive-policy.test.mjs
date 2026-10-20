// Тесты политики удаления/архивирования заказа (этап «сохранность данных»).
//
// Проверяем правила, из-за которых раньше терялись деньги и переговоры:
// оплаченный или доставленный заказ не удаляется (отдаём 409), заказ с
// историей архивируется, совсем чистый — удаляется.

import test from "node:test"
import assert from "node:assert"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

const { decideOrderDeletion, canRestoreOrder } = require("../.test-build/lib/orders/archive-policy.js")

test("оплаченный заказ не удаляется — отдаём отказ с предложением архива", () => {
  const decision = decideOrderDeletion({
    status: "control",
    isPaid: true,
    history: { negotiations: 0, expenses: 0, photos: 0 },
  })
  assert.equal(decision.action, "reject")
  assert.match(decision.reason, /оплачен/i)
  assert.match(decision.reason, /архивируйте/i)
})

test("доставленный заказ не удаляется, даже без оплаты", () => {
  const decision = decideOrderDeletion({
    status: "delivered",
    isPaid: false,
    history: { negotiations: 0, expenses: 0, photos: 0 },
  })
  assert.equal(decision.action, "reject")
  assert.match(decision.reason, /доставлен/i)
})

test("заказ с переговорами архивируется, а не удаляется", () => {
  const decision = decideOrderDeletion({
    status: "negotiation",
    isPaid: false,
    history: { negotiations: 3, expenses: 0, photos: 0 },
  })
  assert.equal(decision.action, "archive")
})

test("заказ с расходами или фото тоже архивируется", () => {
  assert.equal(
    decideOrderDeletion({ status: "search", history: { negotiations: 0, expenses: 1, photos: 0 } }).action,
    "archive",
  )
  assert.equal(
    decideOrderDeletion({ status: "search", history: { negotiations: 0, expenses: 0, photos: 2 } }).action,
    "archive",
  )
})

test("совсем чистый заказ удаляется физически", () => {
  const decision = decideOrderDeletion({
    status: "search",
    isPaid: false,
    history: { negotiations: 0, expenses: 0, photos: 0 },
  })
  assert.equal(decision.action, "delete")
})

test("оплата важнее любой истории: даже чистый, но оплаченный — отказ", () => {
  const decision = decideOrderDeletion({
    status: "search",
    isPaid: true,
    history: { negotiations: 0, expenses: 0, photos: 0 },
  })
  assert.equal(decision.action, "reject")
})

test("canRestoreOrder отличает архивную запись от обычной", () => {
  assert.equal(canRestoreOrder({ archivedAt: new Date() }), true)
  assert.equal(canRestoreOrder({ archivedAt: null }), false)
  assert.equal(canRestoreOrder({}), false)
})
