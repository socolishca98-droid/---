// __tests__/fleet/fuel-maintenance-lib.test.ts
//
// Расчёты новых страниц: топливная ведомость (lib/fuel/ledger.ts) и сроки
// обслуживания (lib/maintenance/schedule.ts). Проверяем главные ловушки:
// null не превращается в ноль, флаг перерасхода совпадает со сверкой рейса,
// границы «скоро/просрочено» считаются по календарным дням.

import { describe, expect, it } from "vitest"

import {
  entryPricePerL,
  ledgerTotals,
  vehicleRollup,
} from "@/lib/fuel/ledger"
import {
  deadlineStatus,
  maintenanceTotals,
  vehicleDeadlines,
} from "@/lib/maintenance/schedule"

describe("топливная ведомость: цена литра и итоги", () => {
  it("считает цену литра по чеку", () => {
    expect(entryPricePerL({ amount: 5600, liters: 100 })).toBe(56)
  })

  it("не превращает null и ноль в «цену ноль»", () => {
    expect(entryPricePerL({ amount: 5600, liters: null })).toBeNull()
    expect(entryPricePerL({ amount: 5600, liters: 0 })).toBeNull()
    expect(entryPricePerL({ amount: null, liters: 100 })).toBeNull()
  })

  it("итоги периода: литры только где они есть, сумма по всем чекам", () => {
    const totals = ledgerTotals([
      { amount: 5600, liters: 100 },
      { amount: 2800, liters: null },
      { amount: null, liters: 50 },
    ])
    expect(totals.count).toBe(3)
    expect(totals.liters).toBe(150)
    expect(totals.amountRub).toBe(8400)
    expect(totals.pricePerL).toBe(56)
  })

  it("без литров цена литра — null, а не ноль", () => {
    const totals = ledgerTotals([{ amount: 1000, liters: null }])
    expect(totals.liters).toBeNull()
    expect(totals.pricePerL).toBeNull()
  })
})

describe("топливная ведомость: сводка по машинам", () => {
  it("складывает факт и оценку по рейсам машины и ставит флаг перерасхода", () => {
    const rows = vehicleRollup([
      { vehicleId: "v1", factL: 100, estimatedL: 80, amountRub: 5600 },
      { vehicleId: "v1", factL: 50, estimatedL: 40, amountRub: 2800 },
      { vehicleId: "v2", factL: 40, estimatedL: 50, amountRub: 2000 },
      { vehicleId: null, factL: 999, estimatedL: 1, amountRub: 999 },
    ])

    expect(rows).toHaveLength(2)
    const v1 = rows.find((row) => row.vehicleId === "v1")!
    expect(v1.routes).toBe(2)
    expect(v1.liters).toBe(150)
    expect(v1.estimatedL).toBe(120)
    expect(v1.diffPct).toBe(25)
    expect(v1.amountRub).toBe(8400)
    expect(v1.pricePerL).toBe(56)
    expect(v1.flag).toBe(true)

    // −20 % — ровно на границе допуска, флаг не ставится
    const v2 = rows.find((row) => row.vehicleId === "v2")!
    expect(v2.diffPct).toBe(-20)
    expect(v2.flag).toBe(false)
  })

  it("машины с флагом идут первыми — ведомость начинает с проблем", () => {
    const rows = vehicleRollup([
      { vehicleId: "ok", factL: 50, estimatedL: 50, amountRub: 2500 },
      { vehicleId: "bad", factL: 100, estimatedL: 50, amountRub: 5000 },
    ])
    expect(rows[0].vehicleId).toBe("bad")
  })

  it("без оценки (нет расхода или расстояния) отклонение — null", () => {
    const rows = vehicleRollup([{ vehicleId: "v1", factL: 100, estimatedL: null, amountRub: 5600 }])
    expect(rows[0].diffPct).toBeNull()
    expect(rows[0].flag).toBe(false)
    expect(rows[0].liters).toBe(100)
    expect(rows[0].estimatedL).toBeNull()
  })
})

describe("обслуживание: сроки и итоги", () => {
  const now = new Date("2026-09-29T12:00:00Z")

  it("просрочено / скоро / в порядке — по календарным дням", () => {
    const expired = deadlineStatus(new Date("2026-09-28T09:00:00Z"), now)!
    expect(expired.status).toBe("expired")
    expect(expired.daysLeft).toBe(-1)

    const soon = deadlineStatus(new Date("2026-10-14T09:00:00Z"), now)!
    expect(soon.status).toBe("soon")
    expect(soon.daysLeft).toBe(15)

    const ok = deadlineStatus(new Date("2026-11-28T09:00:00Z"), now)!
    expect(ok.status).toBe("ok")
    expect(ok.daysLeft).toBe(60)
  })

  it("границы: 30 дней — ещё «скоро», 31 — уже «в порядке»", () => {
    expect(deadlineStatus(new Date("2026-10-29T09:00:00Z"), now)!.status).toBe("soon")
    expect(deadlineStatus(new Date("2026-10-30T09:00:00Z"), now)!.status).toBe("ok")
  })

  it("нет даты или мусор — null, а не «просрочено»", () => {
    expect(deadlineStatus(null, now)).toBeNull()
    expect(deadlineStatus("не дата", now)).toBeNull()
  })

  it("худший срок машины: просрочка перевешивает", () => {
    const deadlines = vehicleDeadlines(
      {
        nextMaintenanceDate: new Date("2026-12-28T09:00:00Z"), // ok
        insuranceExpiry: new Date("2026-09-20T09:00:00Z"), // expired
        inspectionExpiry: new Date("2026-10-10T09:00:00Z"), // soon
      },
      now,
    )
    expect(deadlines.worst).toBe("expired")
    expect(deadlines.insurance!.status).toBe("expired")
    expect(deadlines.inspection!.status).toBe("soon")
    expect(deadlines.maintenance!.status).toBe("ok")
  })

  it("без единой даты worst — null (карточка без проблем)", () => {
    const deadlines = vehicleDeadlines({}, now)
    expect(deadlines.worst).toBeNull()
  })

  it("итоги журнала: стоимость с null-_guard и счётчик работ в процессе", () => {
    const totals = maintenanceTotals([
      { cost: 1500, status: "in_progress" },
      { cost: null, status: "completed" },
      { cost: 500.4, status: "completed" },
    ])
    expect(totals.count).toBe(3)
    expect(totals.inProgress).toBe(1)
    expect(totals.costRub).toBe(2000)
  })
})
