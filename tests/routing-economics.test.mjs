// tests/routing-economics.test.mjs
//
// Этап 4: экономика и время. Проверяются ТОЖДЕСТВА модели:
//   · выручка − известные статьи = netRub;
//   · netRub − обязательство вернуться = netCommittedRub;
//   · неизвестная статья попадает в gaps, а не превращается в ноль;
//   · статус расчёта следует из пробелов по одному правилу;
//   · правило оплаты организации работает, «водитель 0 ₽» назван пробелом.

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { computeEconomics, driverPay, workingHours, costStatus } = require("../.test-build/lib/routing/economics.js")
const { costFromSettings, payRuleFromKind } = require("../.test-build/lib/routing/adapter.js")

const HOUR = 3600000
const start = new Date("2026-11-03T06:00:00Z")

function schedule({ driving = 8, handling = 2, waiting = 0, shifts = 1, hours = 12 }) {
  return {
    drivingHours: driving,
    handlingHours: handling,
    waitingHours: waiting,
    shifts,
    startAt: start,
    endAt: new Date(start.getTime() + hours * HOUR),
  }
}

const baseCost = {
  fuelPricePerL: 87,
  driverPay: { kind: "includedInPerKm" },
  maintenancePerKm: 20,
  tiresPerKm: 2,
  tollsPerKm: 0,
  otherPerKm: 1,
  fixedPerDay: 5000,
}

function economicsOf(overrides = {}) {
  return computeEconomics({
    revenue: 200000,
    totalKm: 1000,
    loadedKm: 700,
    fuelLiters: 300,
    tollsRub: null,
    schedule: schedule({}),
    cost: baseCost,
    ...overrides,
  })
}

test("этап 4: тождество «выручка − известные расходы = netRub»", () => {
  const scenarios = [
    {},
    { revenue: 0 },
    { totalKm: 0, loadedKm: 0, fuelLiters: 0 },
    { revenue: 150000, totalKm: 2400, loadedKm: 2400, fuelLiters: 720, tollsRub: 3400 },
    {
      cost: { ...baseCost, driverPay: { kind: "perShift", perShift: 6000 } },
      schedule: schedule({ shifts: 3, hours: 40 }),
    },
  ]
  for (const overrides of scenarios) {
    const e = economicsOf(overrides)
    const known =
      e.fuelRub + e.driverRub + e.maintenanceRub + e.tiresRub + (e.tollsRub ?? 0) + e.otherRub
    assert.equal(e.knownCostRub, known, "knownCostRub = сумма статей")
    assert.equal(e.netRub, e.revenue - known, "netRub = выручка − известные")
  }
})

test("этап 4: netCommittedRub = netRub − цена обязательства вернуться", () => {
  for (const commitment of [0, 1, 4200, 18500, 99999]) {
    const e = economicsOf({ returnCommitmentRub: commitment })
    assert.equal(e.netCommittedRub, e.netRub - commitment)
  }
  assert.equal(economicsOf({ returnCommitmentRub: -5000 }).netCommittedRub, economicsOf().netRub)
})

test("этап 4: ₽/км и ₽/час считаются по числу, по которому выбирают вариант", () => {
  const e = economicsOf({ returnCommitmentRub: 3000 })
  assert.equal(e.netPerKm, Math.round(e.netCommittedRub / 1000))
  assert.equal(e.netPerHour, Math.round(e.netCommittedRub / 12))
})

test("этап 4: неизвестные платные дороги — пробел, а не ноль", () => {
  const cost = { ...baseCost, tollsPerKm: 1.5 }
  const e = economicsOf({ cost })
  const gap = e.gaps.find((item) => item.article === "платные дороги")
  assert.ok(gap, "пробел по платным дорогам назван")
  assert.equal(gap.inNet, false, "в остаток не подставлено")
  assert.equal(gap.estimateRub, 1500, "оценка сверху 1,5 ₽/км × 1000 км")
  assert.equal(e.status, "insufficient", "полным такой расчёт назвать нельзя")
  assert.equal(e.tollsRub, null, "ноль вместо «неизвестно» не подставляется")

  const known = economicsOf({ cost, tollsRub: 1200 })
  assert.equal(known.gaps.length, 0)
  assert.equal(known.status, "complete")
})

test("этап 4: отсутствие правила оплаты водителя — пробел, а не 0 ₽", () => {
  const e = economicsOf({ cost: { ...baseCost, driverPay: { kind: "unknown" } } })
  const gap = e.gaps.find((item) => item.article === "водитель")
  assert.ok(gap)
  assert.equal(gap.inNet, false)
  assert.match(gap.reason, /не задано/)
  assert.equal(e.driverRub, 0, "статья нулевая, но она НАЗВАНА пробелом")
  assert.equal(e.status, "insufficient")
  assert.ok(e.unknown.some((line) => line.includes("не вычтено")))
})

test("этап 4: пробелы из настроек организации доходят до результата", () => {
  const e = economicsOf({
    cost: {
      ...baseCost,
      gaps: [{ article: "ставка ₽/км", reason: "не задана", estimateRub: null, inNet: false }],
    },
  })
  assert.equal(e.gaps.length, 1)
  assert.equal(e.status, "insufficient")
})

test("этап 4: статус следует из пробелов по одному правилу", () => {
  assert.equal(costStatus([]), "complete")
  assert.equal(costStatus([{ article: "a", reason: "r", estimateRub: 10, inNet: true }]), "preliminary")
  assert.equal(
    costStatus([
      { article: "a", reason: "r", estimateRub: 10, inNet: true },
      { article: "b", reason: "r", estimateRub: null, inNet: false },
    ]),
    "insufficient",
  )
})

test("этап 4: оплата водителя по каждому правилу организации", () => {
  const sched = schedule({ driving: 8, handling: 2, waiting: 2, shifts: 2 })
  const input = {
    revenue: 0,
    totalKm: 500,
    loadedKm: 400,
    fuelLiters: 0,
    tollsRub: 0,
    schedule: sched,
    cost: baseCost,
  }
  assert.equal(workingHours(sched), 12, "движение + погрузка + ожидание")
  assert.equal(driverPay({ kind: "perShift", perShift: 5000 }, input), 10000)
  assert.equal(driverPay({ kind: "perKm", perKm: 4 }, input), 2000)
  assert.equal(driverPay({ kind: "perHour", perHour: 700 }, input), 8400, "12 ч × 700")
  assert.equal(driverPay({ kind: "perTrip", perTrip: 12000 }, input), 12000)
  assert.equal(driverPay({ kind: "mixed", basePerShift: 3000, perKm: 2 }, input), 7000)
  assert.equal(driverPay({ kind: "includedInPerKm" }, input), 0, "водитель внутри ставки ₽/км")
  assert.equal(driverPay({ kind: "unknown" }, input), 0)
})

test("этап 4: простой под окно оплачивается по часам — это не бесплатно", () => {
  const without = economicsOf({
    cost: { ...baseCost, driverPay: { kind: "perHour", perHour: 800 } },
    schedule: schedule({ waiting: 0 }),
  })
  const withWaiting = economicsOf({
    cost: { ...baseCost, driverPay: { kind: "perHour", perHour: 800 } },
    schedule: schedule({ waiting: 5 }),
  })
  assert.equal(without.driverRub, 800 * 10)
  assert.equal(withWaiting.driverRub, 800 * 15)
  assert.equal(without.netRub - withWaiting.netRub, 4000)
})

test("этап 4: правило из настроек собирается полностью или никак", () => {
  const empty = { perShift: null, ratePerKm: null, perHour: null, perTrip: null, basePerShift: null }
  assert.equal(payRuleFromKind("perKm", empty), null, "нет ставки — правило не собрано")
  assert.deepEqual(payRuleFromKind("perKm", { ...empty, ratePerKm: 5 }), { kind: "perKm", perKm: 5 })
  assert.equal(payRuleFromKind("mixed", { ...empty, ratePerKm: 5 }), null, "нет оклада")
  assert.deepEqual(payRuleFromKind("includedInPerKm", empty), { kind: "includedInPerKm" })
  assert.equal(payRuleFromKind("что-то", empty), null)
})

test("этап 4: настройки дают своё правило, ставка ₽/км — без водителя", () => {
  const settings = {
    operatingCostPerKm: 20,
    operatingCostIncludesDriver: false,
    driverPayKind: "perShift",
    driverPayPerShift: 7000,
  }
  const { cost } = costFromSettings(settings, null, "Ярославская область")
  assert.deepEqual(cost.driverPay, { kind: "perShift", perShift: 7000 })
  assert.equal(cost.gaps.length, 0, "двойного учёта нет — флаг снят")
  assert.equal(cost.maintenancePerKm, 20)

  const e = economicsOf({ cost })
  assert.equal(e.driverRub, 7000)
  assert.equal(e.status, "complete")
})

test("этап 4: ставка ₽/км включает водителя, а правило задано — двойной учёт назван", () => {
  const { cost } = costFromSettings(
    { operatingCostPerKm: 24, driverPayKind: "perKm", driverPayPerKm: 3 },
    null,
    "Ярославская область",
  )
  const gap = cost.gaps.find((item) => item.article === "водитель")
  assert.ok(gap, "двойной учёт не скрыт")
  assert.match(gap.reason, /двойной учёт/)
  assert.equal(costStatus(cost.gaps), "insufficient")
})

test("этап 4: правило задано наполовину — водитель не начислен молча", () => {
  const { cost } = costFromSettings(
    { operatingCostPerKm: 24, driverPayKind: "perKm", driverPayPerKm: null },
    null,
    "Ярославская область",
  )
  assert.equal(cost.driverPay.kind, "unknown")
  assert.ok(cost.gaps.some((item) => item.article === "водитель"))
})

test("этап 4: ставка ₽/км не задана — пробел, а не нулевые расходы", () => {
  const { cost } = costFromSettings(
    {
      operatingCostPerKm: null,
      operatingCostIncludesDriver: false,
      driverPayKind: "perTrip",
      driverPayPerTrip: 5000,
    },
    null,
    "Ярославская область",
  )
  assert.ok(cost.gaps.some((item) => item.article === "ставка ₽/км"))
  assert.equal(cost.maintenancePerKm, 0)
})

test("этап 4: постоянные расходы показываются, но не вычитаются", () => {
  const e = economicsOf({ schedule: schedule({ hours: 50 }), cost: { ...baseCost, fixedPerDay: 7000 } })
  assert.equal(e.fixedContributionRub, 21000, "3 суток × 7000")
  const none = economicsOf({ schedule: schedule({ hours: 50 }), cost: { ...baseCost } })
  assert.equal(e.netRub, none.netRub, "на остаток постоянные не влияют")
})

test("этап 4: пробег складывается ровно и не теряет километр", () => {
  const e = economicsOf({ totalKm: 1000.4, loadedKm: 700.6 })
  assert.equal(e.totalKm, e.loadedKm + e.emptyKm)
  assert.equal(e.totalKm, 1000)
  assert.equal(e.loadedKm, 701)
})
