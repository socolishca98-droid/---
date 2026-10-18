// __tests__/polling.test.ts
//
// Адаптивный опрос: когда молчим, когда замедляемся, когда возвращаемся
// к обычному темпу. Чистая математика — без таймеров и браузера.

import { describe, expect, it } from "vitest"

import { nextPollDelay, pollingStatusLabel } from "@/lib/polling"

const visible = { visible: true, online: true, failures: 0 }
const hidden = { visible: false, online: true, failures: 0 }
const offline = { visible: true, online: false, failures: 0 }

describe("nextPollDelay", () => {
  it("обычный режим — базовый интервал", () => {
    expect(nextPollDelay(visible)).toBe(5000)
  })

  it("скрытая вкладка — опрос выключен", () => {
    expect(nextPollDelay(hidden)).toBeNull()
  })

  it("нет сети — опрос выключен", () => {
    expect(nextPollDelay(offline)).toBeNull()
  })

  it("после ошибок интервал растёт вдвое и упирается в потолок", () => {
    expect(nextPollDelay({ ...visible, failures: 1 })).toBe(10_000)
    expect(nextPollDelay({ ...visible, failures: 2 })).toBe(20_000)
    expect(nextPollDelay({ ...visible, failures: 3 })).toBe(40_000)
    expect(nextPollDelay({ ...visible, failures: 4 })).toBe(60_000)
    expect(nextPollDelay({ ...visible, failures: 10 })).toBe(60_000)
  })

  it("свой базовый интервал и потолок", () => {
    expect(nextPollDelay({ ...visible, failures: 2 }, { baseMs: 1000, maxMs: 3000 })).toBe(3000)
    expect(nextPollDelay(visible, { baseMs: 30_000 })).toBe(30_000)
  })

  it("отрицательное число ошибок не ломает рост", () => {
    expect(nextPollDelay({ ...visible, failures: -5 })).toBe(5000)
  })
})

describe("pollingStatusLabel", () => {
  it("обычный режим — подписи нет", () => {
    expect(pollingStatusLabel(visible)).toBeNull()
  })

  it("объясняет причину паузы или замедления", () => {
    expect(pollingStatusLabel(hidden)).toMatch(/вкладка скрыта/)
    expect(pollingStatusLabel(offline)).toMatch(/Нет сети/)
    expect(pollingStatusLabel({ ...visible, failures: 2 })).toMatch(/реже/)
  })
})
