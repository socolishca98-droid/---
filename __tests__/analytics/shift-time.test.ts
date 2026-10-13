// __tests__/analytics/shift-time.test.ts
//
// Аналитика времени водителей: из журнала переключений — цифры, по которым
// видно, во что уходит смена. Чистые функции, без базы.

import { describe, expect, it } from "vitest"

import { bucketShare, buildShiftTimeReport, type ShiftTimeInput } from "@/lib/analytics/shift-time"

const at = (iso: string) => new Date(iso)

function shift(events: [string, string][], endedAt: string | null = null): ShiftTimeInput {
  return {
    id: "shift-1",
    driverId: "driver-1",
    driverName: "Иванов",
    startedAt: at("2026-10-13T08:00:00Z"),
    endedAt: endedAt ? at(endedAt) : null,
    events: events.map(([time, status]) => ({ at: at(time), status, orderId: null })),
  }
}

describe("аналитика времени смены", () => {
  it("считает группы и остановки по отрезкам", () => {
    const report = buildShiftTimeReport([
      shift([
        ["2026-10-13T08:00:00Z", "driving"],
        ["2026-10-13T09:00:00Z", "loading"],
        ["2026-10-13T10:00:00Z", "driving"],
        ["2026-10-13T11:00:00Z", "unloading"],
        ["2026-10-13T12:00:00Z", "resting"],
      ], "2026-10-13T13:00:00Z"),
    ])

    const row = report.drivers[0]
    expect(row.buckets.driving.seconds).toBe(7200) // 2 часа пути
    expect(row.buckets.loading.seconds).toBe(3600) // час погрузки
    expect(row.buckets.unloading.seconds).toBe(3600)
    expect(row.buckets.resting.seconds).toBe(3600)
    expect(row.buckets.loading.stops).toBe(1)
    expect(row.buckets.driving.stops).toBe(2)
    expect(row.avgLoadingSeconds).toBe(3600)
    expect(row.maxLoadingSeconds).toBe(3600)
    expect(row.totalSeconds).toBe(18000)
    expect(report.shiftsWithoutEvents).toBe(0)
  })

  it("незакрытый статус идёт до текущего момента", () => {
    const now = new Date()
    const report = buildShiftTimeReport([
      {
        id: "shift-2",
        driverId: "driver-2",
        driverName: "Петров",
        startedAt: new Date(now.getTime() - 60 * 60 * 1000),
        endedAt: null,
        // Журнал как в жизни: старт смены и переключение на погрузку
        events: [
          { at: new Date(now.getTime() - 60 * 60 * 1000), status: "driving" },
          { at: new Date(now.getTime() - 30 * 60 * 1000), status: "loading" },
        ],
      },
    ])

    // Смена открыта час, из них последние 30 минут — погрузка
    expect(report.drivers[0].buckets.loading.seconds).toBeGreaterThanOrEqual(1790)
    expect(report.drivers[0].buckets.loading.seconds).toBeLessThanOrEqual(1810)
  })

  it("смена без отметок отдельно помечается, а не подделывает время", () => {
    const report = buildShiftTimeReport([
      {
        id: "shift-3",
        driverId: "driver-3",
        driverName: "Сидоров",
        startedAt: at("2026-10-13T08:00:00Z"),
        endedAt: at("2026-10-13T20:00:00Z"),
        events: [],
      },
    ])

    expect(report.shiftsWithoutEvents).toBe(1)
    expect(report.drivers[0].totalSeconds).toBe(0)
    expect(report.drivers[0].buckets.driving.seconds).toBe(0)
  })

  it("водители сортируются по убыванию учтённого времени", () => {
    const report = buildShiftTimeReport([
      shift([
        ["2026-10-13T08:00:00Z", "driving"],
        ["2026-10-13T09:00:00Z", "loading"],
      ], "2026-10-13T10:00:00Z"),
      {
        ...shift([
          ["2026-10-13T08:00:00Z", "driving"],
          ["2026-10-13T09:00:00Z", "loading"],
        ], "2026-10-13T10:00:00Z"),
        driverId: "driver-2",
        driverName: "Петров",
      },
      {
        ...shift([
          ["2026-10-13T08:00:00Z", "loading"],
          ["2026-10-13T12:00:00Z", "unloading"],
        ], "2026-10-13T14:00:00Z"),
        id: "shift-long",
        driverId: "driver-9",
        driverName: "Долгий",
      },
    ])

    expect(report.drivers.map((row) => row.driverId)).toEqual(["driver-9", "driver-1", "driver-2"])
    // Две погрузки по часу и одна на четыре часа
    expect(report.totals.loading.seconds).toBe(3600 + 3600 + 14400)
  })

  it("доля группы в процентах", () => {
    expect(bucketShare(25, 100)).toBe(25)
    expect(bucketShare(1, 0)).toBe(0)
    expect(bucketShare(0, 100)).toBe(0)
  })
})
