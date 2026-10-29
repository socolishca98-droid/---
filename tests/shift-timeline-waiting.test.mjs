import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { needsReturnToWaiting, TRIP_ONLY_STATUSES } = require("../.test-build/lib/shift/timeline.js")

test("после закрытия рейса смена «в пути» возвращается в ожидание", () => {
  // На приёмке водитель стоял на базе, а отчёт писал «в пути» 17 минут
  for (const status of TRIP_ONLY_STATUSES) {
    assert.equal(needsReturnToWaiting(status), true, status)
  }
  assert.equal(needsReturnToWaiting("waiting"), false)
  assert.equal(needsReturnToWaiting("resting"), false)
  assert.equal(needsReturnToWaiting("fueling"), false)
  assert.equal(needsReturnToWaiting(null), false)
})
