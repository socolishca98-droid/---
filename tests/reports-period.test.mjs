// Тесты границ периода отчёта (этап 3, A3).
import test from "node:test"
import assert from "node:assert"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { presetBounds, presetLabel } = require("../.test-build/lib/reports/period.js")

const NOW = new Date("2026-10-20T12:00:00")

test("7 дней — интервал из 7 календарных дней, включая сегодня", () => {
  const b = presetBounds("7d", NOW)
  assert.equal(b.from, "2026-10-14")
  assert.equal(b.to, "2026-10-20")
  assert.equal(b.label, "7 дней")
})

test("30 дней — из 30 дней, включая сегодня", () => {
  const b = presetBounds("30d", NOW)
  assert.equal(b.from, "2026-09-21")
  assert.equal(b.to, "2026-10-20")
})

test("90 дней — из 90 дней", () => {
  const b = presetBounds("90d", NOW)
  assert.equal(b.from, "2026-07-23")
  assert.equal(b.to, "2026-10-20")
})

test("месяц — с первого числа", () => {
  const b = presetBounds("month", NOW)
  assert.equal(b.from, "2026-10-01")
  assert.equal(b.to, "2026-10-20")
})

test("год — с 1 января", () => {
  const b = presetBounds("year", NOW)
  assert.equal(b.from, "2026-01-01")
  assert.equal(b.to, "2026-10-20")
})

test("граница через границу месяца/года не ломается", () => {
  const b = presetBounds("7d", new Date("2026-01-03T00:00:00"))
  assert.equal(b.from, "2025-12-28")
  assert.equal(b.to, "2026-01-03")
})

test("подписи периодов", () => {
  assert.equal(presetLabel("7d"), "7 дней")
  assert.equal(presetLabel("month"), "Месяц")
  assert.equal(presetLabel("year"), "Год")
})
