// __tests__/fleet/rest-norms.test.ts
//
// Нормы отдыха: непрерывное время в пути, пары событий отдыха, вердикт.

import { describe, expect, it } from "vitest"
import {
  REST_END,
  REST_START,
  currentBreak,
  drivingMinutes,
  restVerdict,
  sumRestMinutes,
} from "@/lib/rest/norms"

const at = (iso: string) => new Date(iso)

describe("события отдыха", () => {
  const shiftStart = at("2026-09-28T06:00:00Z")
  const now = at("2026-09-28T14:00:00Z")

  it("считает пары начал и окончаний", () => {
    const events = [
      { status: REST_START, createdAt: at("2026-09-28T09:00:00Z") },
      { status: REST_END, createdAt: at("2026-09-28T09:45:00Z") },
      { status: REST_START, createdAt: at("2026-09-28T12:00:00Z") },
      { status: REST_END, createdAt: at("2026-09-28T12:30:00Z") },
    ]
    expect(sumRestMinutes(events, shiftStart, now)).toBe(75)
  })

  it("незакрытый отдых идёт до текущего момента", () => {
    const events = [{ status: REST_START, createdAt: at("2026-09-28T13:00:00Z") }]
    expect(sumRestMinutes(events, shiftStart, now)).toBe(60)
    expect(currentBreak(events, now)).toEqual({ resting: true, currentBreakMin: 60 })
  })

  it("без событий отдыха перерыва нет", () => {
    expect(currentBreak([], now)).toEqual({ resting: false, currentBreakMin: 0 })
    expect(sumRestMinutes([], shiftStart, now)).toBe(0)
  })
})

describe("вердикт по норме", () => {
  const shiftStart = at("2026-09-28T06:00:00Z")

  it("пора отдыхать после лимита непрерывного движения", () => {
    const now = at("2026-09-28T10:31:00Z")
    const verdict = restVerdict({
      shiftStart,
      now,
      restMinutes: 0,
      resting: false,
      currentBreakMin: 0,
      limitMin: 270,
      minBreakMin: 45,
    })
    expect(verdict.restDue).toBe(true)
    expect(verdict.minutesToRest).toBe(0)
  })

  it("до напоминания показывает остаток минут", () => {
    const now = at("2026-09-28T09:00:00Z")
    const verdict = restVerdict({
      shiftStart,
      now,
      restMinutes: 0,
      resting: false,
      currentBreakMin: 0,
      limitMin: 270,
      minBreakMin: 45,
    })
    expect(verdict.restDue).toBe(false)
    expect(verdict.minutesToRest).toBe(90)
  })

  it("отдых вычитается из времени в пути", () => {
    const now = at("2026-09-28T11:00:00Z")
    expect(drivingMinutes(shiftStart, now, 45)).toBe(255)
  })

  it("перерыв засчитан, когда дотянул до нормы", () => {
    const verdict = restVerdict({
      shiftStart,
      now: at("2026-09-28T11:00:00Z"),
      restMinutes: 45,
      resting: true,
      currentBreakMin: 50,
      limitMin: 270,
      minBreakMin: 45,
    })
    expect(verdict.resting).toBe(true)
    expect(verdict.restDue).toBe(false)
    expect(verdict.breakCounts).toBe(true)
  })
})
