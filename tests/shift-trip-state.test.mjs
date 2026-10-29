import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { tripState, isTripStarted } = require("../.test-build/lib/shift/trip-state.js")

test("открытая точка — это и есть текущий рейс", () => {
  const state = tripState([
    { status: "delivered" },
    { status: "control" },
    { status: "new" },
  ])
  assert.equal(state.hasActiveTrip, true)
  assert.equal(state.finished, false)
  assert.equal(state.active.status, "control")
  assert.equal(state.open.length, 2)
  assert.equal(state.closed.length, 1)
  assert.equal(state.progress, 33)
})

test("все точки закрыты — рейс выполнен, а не «назначен»", () => {
  // Именно эта ошибка давала на /m карточку «Вам назначен рейс · Начать рейс»
  // на выполненном рейсе и мёртвую кнопку
  const state = tripState([{ status: "delivered" }])
  assert.equal(state.hasActiveTrip, false)
  assert.equal(state.finished, true)
  assert.equal(state.active, null)
  assert.equal(state.progress, 100)
})

test("пустой рейс — ни рейса, ни «выполнено», прогресс не делится на ноль", () => {
  for (const input of [[], null, undefined]) {
    const state = tripState(input)
    assert.equal(state.hasActiveTrip, false)
    assert.equal(state.finished, false)
    assert.equal(state.progress, 0)
    assert.deepEqual(state.open, [])
  }
})

test("точки с разными закрывающими статусами считаются закрытыми", () => {
  const state = tripState([
    { status: "delivered" },
    { status: "cancelled" },
    { status: "driving" },
  ])
  assert.equal(state.closed.length, 2)
  assert.equal(state.open.length, 1)
  assert.equal(state.active.status, "driving")
})

test("после «Начать рейс» карточка «Начать рейс» больше не показывается", () => {
  // Раньше условие смотрело только на наличие открытых точек, и кнопка
  // оставалась на экране уже во время рейса
  assert.equal(isTripStarted({ status: "control" }), true)
  assert.equal(isTripStarted({ status: "assigned" }), false)
  assert.equal(isTripStarted({ status: "documents" }), false)
  assert.equal(isTripStarted(null), false)
})
