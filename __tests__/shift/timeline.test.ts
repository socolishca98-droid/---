// __tests__/shift/timeline.test.ts
//
// Чистая математика времени смены: итоги по группам, таймлайн, подсказки
// следующего шага. Ни Prisma, ни Next.js — только функции, поэтому тесты
// быстрые и понятные: видно, что кнопка «Погрузка» действительно добавляет
// секунды в группу «погрузка».

import { describe, expect, it } from "vitest"

import {
  SHIFT_STATUSES,
  applyStatusChange,
  bucketOf,
  buildTimeline,
  emptyTotals,
  formatClock,
  formatDuration,
  secondsBetween,
  shiftStatusLabel,
  suggestedNext,
  summarizeTimeline,
  totalSeconds,
  totalsFromTimeline,
  tripStep,
  type ShiftStatusEvent,
} from "@/lib/shift/timeline"

const at = (iso: string) => new Date(iso)

describe("статусы смены", () => {
  it("у каждого статуса есть подпись, группа и цвет", () => {
    for (const status of SHIFT_STATUSES) {
      expect(status.label.length).toBeGreaterThan(0)
      expect(status.short.length).toBeGreaterThan(0)
      expect(status.color).toMatch(/^bg-/)
      expect(status.hint.length).toBeGreaterThan(0)
    }
  })

  it("группы: путь, погрузка, выгрузка, ожидание, отдых, заправка", () => {
    expect(bucketOf("driving")).toBe("driving")
    expect(bucketOf("loading")).toBe("loading")
    expect(bucketOf("unloading")).toBe("unloading")
    expect(bucketOf("waiting_point")).toBe("waiting")
    expect(bucketOf("waiting")).toBe("waiting")
    expect(bucketOf("resting")).toBe("resting")
    expect(bucketOf("sleeping")).toBe("resting")
    expect(bucketOf("fueling")).toBe("fueling")
    // Неизвестный статус не теряется, а уходит в «прочее»
    expect(bucketOf("что-то новое")).toBe("other")
  })

  it("неизвестный статус не роняет подпись", () => {
    expect(shiftStatusLabel("loading")).toBe("Погрузка")
    expect(shiftStatusLabel("unknown")).toBe("unknown")
    expect(shiftStatusLabel(null)).toBe("—")
  })
})

describe("переключение статуса", () => {
  it("время предыдущего статуса попадает в его группу", () => {
    const result = applyStatusChange({
      previous: "loading",
      next: "driving",
      since: at("2026-10-13T08:00:00Z"),
      now: at("2026-10-13T08:20:00Z"),
      totals: emptyTotals(),
    })

    expect(result.seconds).toBe(1200)
    expect(result.totals.loading).toBe(1200)
    expect(result.totals.driving).toBe(0)
  })

  it("повторное включение того же статуса не удваивает время", () => {
    const result = applyStatusChange({
      previous: "loading",
      next: "loading",
      since: at("2026-10-13T08:00:00Z"),
      now: at("2026-10-13T08:20:00Z"),
      totals: emptyTotals(),
    })

    expect(result.seconds).toBe(1200)
    // Время всё равно учтено: это защита от расхождения журнала и итогов,
    // но нового сегмента в таймлайне не появится.
    expect(result.totals.loading).toBe(1200)
  })

  it("непрерывное вождение растёт на пути и обнуляется на отдыхе", () => {
    const first = applyStatusChange({
      previous: "waiting",
      next: "driving",
      since: at("2026-10-13T08:00:00Z"),
      now: at("2026-10-13T08:30:00Z"),
      totals: emptyTotals(),
      drivingSinceRestSeconds: 0,
    })
    expect(first.drivingSinceRestSeconds).toBe(1800)

    const loading = applyStatusChange({
      previous: "driving",
      next: "loading",
      since: at("2026-10-13T08:30:00Z"),
      now: at("2026-10-13T09:30:00Z"),
      totals: first.totals,
      drivingSinceRestSeconds: first.drivingSinceRestSeconds,
    })
    expect(loading.drivingSinceRestSeconds).toBe(1800)

    const rest = applyStatusChange({
      previous: "loading",
      next: "resting",
      since: at("2026-10-13T09:30:00Z"),
      now: at("2026-10-13T10:30:00Z"),
      totals: loading.totals,
      drivingSinceRestSeconds: loading.drivingSinceRestSeconds,
    })
    expect(rest.drivingSinceRestSeconds).toBe(0)
    expect(rest.totals.loading).toBe(3600)
  })

  it("отрицательный интервал даёт ноль, а не минус", () => {
    expect(secondsBetween(at("2026-10-13T10:00:00Z"), at("2026-10-13T09:00:00Z"))).toBe(0)
  })
})

describe("таймлайн смены", () => {
  const events: ShiftStatusEvent[] = [
    { at: at("2026-10-13T08:00:00Z"), status: "driving", orderId: "order-1" },
    { at: at("2026-10-13T08:40:00Z"), status: "loading", orderId: "order-1" },
    { at: at("2026-10-13T09:20:00Z"), status: "driving" },
    { at: at("2026-10-13T10:00:00Z"), status: "resting" },
  ]

  const segments = buildTimeline({
    events,
    shiftStart: at("2026-10-13T07:50:00Z"),
    until: at("2026-10-13T10:20:00Z"),
  })

  it("делит смену на отрезки по переключениям", () => {
    expect(segments.map((s) => s.status)).toEqual([
      "driving",
      "loading",
      "driving",
      "resting",
    ])
    // Первый статус действует с начала смены: минуты между «смена начата» и
    // первым нажатием кнопки не выпадают из аналитики
    expect(segments[0].seconds).toBe(3000) // 07:50 → 08:40 (в пути)
    expect(segments[1].seconds).toBe(2400) // 08:40 → 09:20 (погрузка)
    expect(segments[2].seconds).toBe(2400) // 09:20 → 10:00 (в пути)
    expect(segments[3].seconds).toBe(1200) // 10:00 → 10:20 (отдых, открыт)
  })

  it("итоги по группам совпадают с суммой отрезков", () => {
    const totals = totalsFromTimeline(segments)
    expect(totals.driving).toBe(5400)
    expect(totals.loading).toBe(2400)
    expect(totals.resting).toBe(1200)
    expect(totalSeconds(totals)).toBe(segments.reduce((sum, s) => sum + s.seconds, 0))
  })

  it("сводка считает остановки по группам", () => {
    const summary = summarizeTimeline(segments)
    const loading = summary.find((entry) => entry.bucket === "loading")
    expect(loading?.seconds).toBe(2400)
    expect(loading?.stops).toBe(1)
    // Два отрезка пути — две остановки «в пути»
    expect(summary.find((entry) => entry.bucket === "driving")?.stops).toBe(2)
  })

  it("пустой журнал даёт пустой таймлайн", () => {
    expect(
      buildTimeline({ events: [], shiftStart: at("2026-10-13T08:00:00Z"), until: at("2026-10-13T09:00:00Z") }),
    ).toEqual([])
  })

  it("событие ровно на старте смены не теряет время", () => {
    // Первое событие журнала совпадает с началом смены (так и пишет старт):
    // до него времени нет, поэтому отрезок начинается со старта смены.
    const exact = buildTimeline({
      events: [
        { at: at("2026-10-13T08:00:00Z"), status: "driving" },
        { at: at("2026-10-13T08:30:00Z"), status: "loading" },
      ],
      shiftStart: at("2026-10-13T08:00:00Z"),
      until: at("2026-10-13T09:00:00Z"),
    })
    expect(exact.map((segment) => [segment.status, segment.seconds])).toEqual([
      ["driving", 1800],
      ["loading", 1800],
    ])
  })

  it("часы, съехавшие назад, не двигают время вспять", () => {
    const weird = buildTimeline({
      events: [
        { at: at("2026-10-13T08:00:00Z"), status: "driving" },
        { at: at("2026-10-13T07:30:00Z"), status: "loading" },
        { at: at("2026-10-13T09:00:00Z"), status: "unloading" },
      ],
      shiftStart: at("2026-10-13T08:00:00Z"),
      until: at("2026-10-13T09:30:00Z"),
    })
    expect(weird.map((segment) => segment.status)).toEqual(["driving", "unloading"])
    expect(weird[0].seconds).toBe(3600)
  })
})

describe("поток рейса и подсказки", () => {
  it("шаг рейса: путь → погрузка → выгрузка", () => {
    expect(tripStep("driving")).toBe(1)
    expect(tripStep("loading")).toBe(2)
    expect(tripStep("unloading")).toBe(3)
    expect(tripStep("waiting_point")).toBe(1)
    expect(tripStep("waiting")).toBe(0)
    expect(tripStep("resting")).toBe(0)
  })

  it("после погрузки логично ехать или выгружаться", () => {
    expect(suggestedNext("loading")).toContain("driving")
    expect(suggestedNext("loading")).toContain("unloading")
    expect(suggestedNext("driving")).toContain("loading")
    expect(suggestedNext("unloading")).toContain("loading") // догруз
  })

  it("неизвестный статус не ломает подсказки", () => {
    expect(suggestedNext("что-то новое")).toContain("driving")
  })
})

describe("формат времени", () => {
  it("короткие durations", () => {
    expect(formatDuration(45)).toBe("45 с")
    expect(formatDuration(600)).toBe("10 мин")
    expect(formatDuration(3600)).toBe("1 ч")
    expect(formatDuration(3900)).toBe("1 ч 5 мин")
    expect(formatDuration(-5)).toBe("0 с")
  })

  it("точные часы для таймера", () => {
    expect(formatClock(65)).toBe("01:05")
    expect(formatClock(3725)).toBe("1:02:05")
  })
})
