// tests/pricing-estimate.test.mjs
//
// Этап 8: цена 0 / «не указана» и оценка стоимости перевозки.
//
// Проверяется не «функция что-то вернула», а обещания, данные логисту:
//   · 0 ₽ никогда не становится подтверждённым доходом и не делает рейс
//     убыточным или ложно прибыльным;
//   · расчётная цена всегда подписана как расчётная, а при нехватке данных
//     суммы не показывается вовсе;
//   · несовместимые перевозки не сравниваются;
//   · история цен одной организации не влияет на расчёт другой;
//   · экономика показывает подтверждённый и расчётный доход РАЗДЕЛЬНО.

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const S = require("../.test-build/lib/pricing/status.js")
const E = require("../.test-build/lib/pricing/estimate.js")
const F = require("../.test-build/lib/pricing/format.js")
const SAMPLES = require("../.test-build/lib/pricing/samples.js")
const A = require("../.test-build/lib/routing/adapter.js")
const R = require("../.test-build/lib/routing/index.js")

const NOW = new Date("2026-11-03T09:00:00.000Z")

// ── Сценарий 1. Цена 0 и пустая цена ────────────────────────────────────────

test("S1: ноль в ставке — «не указана», а не «бесплатно»", () => {
  for (const raw of [0, "0", "0 ₽", null, undefined, "", "договорная", "по договорённости"]) {
    const parsed = S.parseRawPrice(raw)
    assert.notEqual(parsed.status, "CONFIRMED", `значение ${JSON.stringify(raw)} не должно быть ценой`)
    assert.equal(parsed.amountRub, 0, "суммы нет — и не придумано")
    assert.equal(parsed.raw, raw, "исходное значение сохранено как пришло")
    assert.ok(parsed.note.length > 0, "причина названа словами")
  }
})

test("S1: «договорная» и мусор различаются — это разные поводы для действий", () => {
  assert.equal(S.parseRawPrice("договорная").status, "NEGOTIATION_REQUIRED", "договорная — звонить и договариваться")
  assert.equal(S.parseRawPrice("abc").status, "UNKNOWN", "мусор — не «договорная»")
  assert.equal(S.parseRawPrice(-100).status, "UNKNOWN", "отрицательная цена — ошибка выгрузки")
  assert.equal(S.parseRawPrice("45 000").amountRub, 45000, "разделители тысяч разбираются")
  assert.equal(S.parseRawPrice("45 000").status, "CONFIRMED")
})

test("S1: три поля ATI — порядок «с НДС → без НДС → общее»", () => {
  assert.equal(S.parseAtiRate({ priceNds: 50000, priceNoNds: 42000 }).amountRub, 50000)
  assert.equal(S.parseAtiRate({ priceNds: 0, priceNoNds: 42000 }).amountRub, 42000)
  assert.equal(S.parseAtiRate({ priceNds: 0, priceNoNds: 0, price: 30000 }).amountRub, 30000)
  assert.equal(S.parseAtiRate({ priceNds: 0, priceNoNds: 0, price: 0 }).status, "NEGOTIATION_REQUIRED")
  assert.equal(S.parseAtiRate(null).status, "NEGOTIATION_REQUIRED")
})

test("S1: в интерфейсе ноль рублей не показывается как стоимость", () => {
  const view = F.describePrice({ status: "NEGOTIATION_REQUIRED", amountRub: 0 })
  assert.ok(!view.headline.includes("0 ₽"), `в заголовке не должно быть нуля: ${view.headline}`)
  assert.equal(view.confirmed, false)
  assert.equal(view.hasAmount, false)
  assert.match(view.statusLabel, /Недостаточно данных/i)
})

// ── Сценарий 2. Ставка не указана, но аналоги есть ──────────────────────────

const place = (city, region, lat, lng) => ({
  id: city.toLowerCase(),
  city,
  region,
  point: { lat, lng },
  timeZone: "Europe/Moscow",
})

const sample = (over = {}) => ({
  id: over.id ?? `s-${Math.random().toString(36).slice(2, 8)}`,
  origin: "board",
  amountRub: 45000,
  fromCity: "Ярославль",
  toCity: "Тула",
  km: 380,
  weightKg: 12000,
  volumeM3: 40,
  body: ["Тент"],
  temperature: false,
  at: NOW,
  organizationId: null,
  ...over,
})

const request = (over = {}) => ({
  fromCity: "Ярославль",
  toCity: "Тула",
  km: 380,
  weightKg: 12000,
  volumeM3: 40,
  body: ["Тент"],
  temperature: false,
  at: NOW,
  now: NOW,
  ...over,
})

test("S2: оценка по аналогам того же направления — с диапазоном и числом аналогов", () => {
  const outcome = E.buildEstimate(
    request(),
    [
      sample({ amountRub: 42000 }),
      sample({ amountRub: 45000 }),
      sample({ amountRub: 48000 }),
      sample({ amountRub: 44000 }),
    ],
  )
  assert.equal(outcome.ok, true)
  const est = outcome.estimate
  assert.ok(est.amountRub >= 42000 && est.amountRub <= 48000, `медиана внутри диапазона: ${est.amountRub}`)
  assert.equal(est.samples, 4)
  assert.ok(est.lowRub !== null && est.highRub !== null, "при 4 наблюдениях диапазон показывается")
  assert.ok(est.lowRub <= est.amountRub && est.amountRub <= est.highRub)
  assert.equal(est.perKmRub, Math.round(est.amountRub / 380))
  assert.equal(est.sources[0], "ati-same-direction")
  assert.match(est.basis, /сопоставимых/)
})

test("S2: один аналог — диапазона нет, уверенность низкая", () => {
  const outcome = E.buildEstimate(request(), [sample({ amountRub: 47000 })])
  assert.equal(outcome.ok, true)
  assert.equal(outcome.estimate.lowRub, null, "диапазон из одной точки — ложная точность")
  assert.equal(outcome.estimate.highRub, null)
  assert.equal(outcome.estimate.confidence, "low")
  assert.equal(outcome.estimate.samples, 1)
})

test("S2: близкое направление приводится по ₽/км, а не по сумме", () => {
  // Москва → Тула (180 км) за 30 000 → 166 ₽/км. Для 380 км это ≈ 63 333.
  const near = sample({ fromCity: "Москва", toCity: "Тула", amountRub: 30000, km: 180 })
  const outcome = E.buildEstimate(request(), [near])
  assert.equal(outcome.ok, true)
  assert.equal(outcome.used[0].relation, "same-destination", "общий пункт выгрузки — близкое направление")
  assert.ok(
    Math.abs(outcome.used[0].adjustedRub - 63333) <= 100,
    `приведение по километрам: ${outcome.used[0].adjustedRub}`,
  )
  assert.notEqual(outcome.used[0].adjustedRub, 30000, "сумма не переносится на другое плечо как есть")
  assert.ok(outcome.estimate.sources.includes("ati-nearby"))
})

test("S2: без километров близкое направление не сравнивается", () => {
  const near = sample({ fromCity: "Москва", toCity: "Тула", km: null })
  const outcome = E.buildEstimate(request(), [near])
  assert.equal(outcome.ok, false)
  assert.match(outcome.reason, /километр/i)
})

// ── Сценарий 3. Несовместимое не сравнивается ───────────────────────────────

test("S3: рефрижератор и тент не сравниваются, причина названа", () => {
  const cold = sample({ body: ["Рефрижератор"], temperature: true })
  const outcome = E.buildEstimate(request({ temperature: true, body: ["Рефрижератор"] }), [sample({ body: ["Тент"], temperature: false })])
  assert.equal(outcome.ok, false, "тент не заменяет реф")
  assert.ok(outcome.rejected.some((item) => /температур|кузов/i.test(item.reason)))
  // обратный случай: реф как аналог для тента допустим, но с пониженным весом
  const warm = E.buildEstimate(request(), [cold, sample({ amountRub: 46000 })])
  assert.equal(warm.ok, true)
  assert.ok(warm.used.some((item) => item.id === cold.id) || warm.rejected.some((item) => item.id === cold.id))
})

test("S3: другая грузоподъёмность не сравнивается (1,5 т ≠ 18 т)", () => {
  const small = sample({ weightKg: 1500 })
  const outcome = E.buildEstimate(request({ weightKg: 20000 }), [small])
  assert.equal(outcome.ok, false)
  assert.ok(outcome.rejected.some((item) => /грузоподъёмность/.test(item.reason)))
})

// ── Сценарий 4. Данных нет — честный отказ, а не выдуманная цена ─────────────

test("S4: сопоставимых нет — отказ с причиной и без суммы", () => {
  const outcome = E.buildEstimate(request(), [])
  assert.equal(outcome.ok, false)
  assert.match(outcome.reason, /сопоставимых/)
  assert.equal(outcome.estimate, undefined, "цены в отказе нет")
  const view = F.describePrice({ status: "NEGOTIATION_REQUIRED", amountRub: 0 }, null)
  assert.equal(view.hasAmount, false)
  assert.match(view.statusLabel, /Недостаточно данных/)
})

test("S4: чужие направления не подставляются вместо аналогов", () => {
  const outcome = E.buildEstimate(request(), [sample({ fromCity: "Казань", toCity: "Воронеж" })])
  assert.equal(outcome.ok, false)
  assert.ok(outcome.rejected.some((item) => /направление/.test(item.reason)))
})

// ── Сценарий 5. Своя история цен ────────────────────────────────────────────

test("S5: своя история весит больше чужих объявлений", () => {
  const history = [1, 2, 3].map((index) =>
    sample({ id: `order:${index}`, origin: "history", amountRub: 60000, organizationId: "org-1" }),
  )
  const board = [1, 2, 3].map((index) => sample({ id: `ati:${index}`, amountRub: 40000 }))
  const outcome = E.buildEstimate(request(), [...history, ...board])
  assert.equal(outcome.ok, true)
  assert.ok(outcome.estimate.amountRub > 45000, `медиана тянется к своей истории: ${outcome.estimate.amountRub}`)
  assert.ok(outcome.estimate.sources.includes("history"))
})

test("S5: данные другой организации в расчёт не попадают", () => {
  const foreign = [sample({ id: "order:1", origin: "history", amountRub: 90000, organizationId: "org-2" })]
  const own = [sample({ id: "order:2", origin: "history", amountRub: 50000, organizationId: "org-1" })]
  const kept = SAMPLES.filterByOrganisation([...foreign, ...own], "org-1")
  assert.deepEqual(kept.map((item) => item.id), ["order:2"], "чужая история отфильтрована")
  const outcome = SAMPLES.estimateFromCandidates({
    organizationId: "org-1",
    candidates: [...foreign, ...own],
    request: request(),
  })
  assert.equal(outcome.ok, true)
  assert.ok(outcome.estimate.amountRub <= 50000, `чужая цена 90 000 не повлияла: ${outcome.estimate.amountRub}`)
})

// ── Сценарий 6. Расчётная цена ниже себестоимости ───────────────────────────

test("S6: расчёт ниже себестоимости помечается, а не выдаётся за рынок", () => {
  const outcome = E.buildEstimate(request({ costFloorRub: 50000 }), [
    sample({ amountRub: 30000 }),
    sample({ amountRub: 31000 }),
  ])
  assert.equal(outcome.ok, true)
  assert.equal(outcome.belowCost, true)
  const view = F.describePrice(
    { status: "NEGOTIATION_REQUIRED", amountRub: 0 },
    outcome.estimate,
  )
  assert.ok(view.details.some((line) => /себестоимост/i.test(line)))
  assert.equal(view.confirmed, false)
})

// ── Сценарий 7. Экономика: подтверждённый и расчётный доход раздельно ───────

const cost = {
  fuelPricePerL: 87,
  driverPay: { kind: "perShift", perShift: 3000 },
  maintenancePerKm: 5,
  tiresPerKm: 2,
  tollsPerKm: 0,
  otherPerKm: 1,
  fixedPerDay: 0,
  gaps: [],
}

const schedule = {
  drivingHours: 8,
  handlingHours: 2,
  waitingHours: 0,
  shifts: 1,
  startAt: new Date("2026-11-03T06:00:00.000Z"),
  endAt: new Date("2026-11-03T18:00:00.000Z"),
}

test("S7: расчётный доход не смешивается с подтверждённым", () => {
  const economics = R.computeEconomics({
    revenue: 60000,
    revenueConfirmed: 0,
    totalKm: 400,
    loadedKm: 380,
    fuelLiters: 120,
    tollsRub: 0,
    schedule,
    cost,
  })
  assert.equal(economics.revenueConfirmed, 0, "подтверждённого дохода нет")
  assert.equal(economics.revenueEstimated, 60000, "вся выручка — расчёт")
  assert.equal(economics.revenueStatus, "unconfirmed")
  assert.ok(
    economics.gaps.some((gap) => gap.article === "доход"),
    "расчётный доход попадает в пробелы расчёта, а не в прибыль",
  )
  assert.notEqual(economics.status, "complete", "расчёт не может считаться полным, пока цена не подтверждена")
  assert.equal(economics.profitDependsOnEstimate, economics.netCommittedRub > 0)
})

test("S7: подтверждённая часть отделяется от расчётной", () => {
  const economics = R.computeEconomics({
    revenue: 60000,
    revenueConfirmed: 25000,
    totalKm: 400,
    loadedKm: 380,
    fuelLiters: 120,
    tollsRub: 0,
    schedule,
    cost,
  })
  assert.equal(economics.revenueConfirmed, 25000)
  assert.equal(economics.revenueEstimated, 35000)
  assert.equal(economics.revenueStatus, "partly-estimated")
})

test("S7: полностью подтверждённый доход — расчёт полный", () => {
  const economics = R.computeEconomics({
    revenue: 60000,
    revenueConfirmed: 60000,
    totalKm: 400,
    loadedKm: 380,
    fuelLiters: 120,
    tollsRub: 0,
    schedule,
    cost,
  })
  assert.equal(economics.revenueStatus, "confirmed")
  assert.equal(economics.profitDependsOnEstimate, false)
  assert.equal(economics.status, "complete")
  assert.ok(!economics.gaps.some((gap) => gap.article === "доход"))
})

test("S7: ноль в ставке не делает рейс ни убыточным, ни ложно прибыльным", () => {
  // Ноль в ставке не попадает в экономику вовсе: он не вычитается из дохода и
  // не превращается в «бесплатную перевозку». Рейс с таким грузом просто не
  // собирается, а груз возвращается списком «нужен звонок».
  const zeroRate = { amount: 0, status: "NEGOTIATION_REQUIRED", raw: 0 }
  assert.equal(S.rateStatus(zeroRate), "NEGOTIATION_REQUIRED")
  assert.equal(S.isConfirmed(0, "NEGOTIATION_REQUIRED"), false)

  // Если бы ноль попал в экономику как доход, рейс стал бы убыточным на всю
  // сумму расходов. Проверяем, что этого не происходит: сумма дохода
  // складывается только из подтверждённых и расчётных заказов.
  const economics = R.computeEconomics({
    revenue: 0,
    revenueConfirmed: 0,
    totalKm: 400,
    loadedKm: 380,
    fuelLiters: 120,
    tollsRub: 0,
    schedule,
    cost,
  })
  assert.equal(economics.revenueStatus, "unconfirmed")
  assert.equal(economics.profitDependsOnEstimate, false, "убыток не «зависит» от расчётной цены — он просто не посчитан")
})

// ── Сценарий 8. Расчётная цена подменяется подтверждённой ───────────────────

test("S8: подтверждённая цена становится деньгами, а расчёт остаётся в истории", async () => {
  const calls = []
  const updates = []
  const prismaStub = {
    priceCall: {
      create: async ({ data }) => {
        calls.push(data)
        return { id: "call-1", ...data, createdAt: NOW }
      },
    },
    order: {
      updateMany: async (args) => {
        updates.push(args)
        return { count: 1 }
      },
    },
  }
  const PRISMA = require("../.test-build/lib/prisma.js")
  const original = PRISMA.prisma
  const SERVICE_PATH = require.resolve("../.test-build/lib/pricing/service.js")
  delete require.cache[SERVICE_PATH]
  const serviceModule = require(SERVICE_PATH)
  // Подмена клиента — только внутри теста: боевой код не меняется.
  Object.defineProperty(PRISMA, "prisma", { value: prismaStub, configurable: true, writable: true })
  delete require.cache[SERVICE_PATH]
  const service = require(SERVICE_PATH)
  try {
    const result = await service.recordPriceCall({
      organizationId: "org-1",
      refKind: "order",
      refId: "order-7",
      outcome: "confirmed",
      amountRub: 52000,
    })
    assert.equal(calls.length, 1, "разговор записан")
    assert.equal(calls[0].organizationId, "org-1", "запись привязана к своей организации")
    assert.equal(calls[0].amountRub, 52000)
    assert.equal(updates.length, 1, "согласованная цена записана в заказ")
    assert.equal(updates[0].data.agreedPrice, 52000)
    assert.equal(updates[0].where.organizationId, "org-1", "чужой заказ не тронут")
    assert.equal(result.confirmedOrder, true)
  } finally {
    Object.defineProperty(PRISMA, "prisma", { value: original, configurable: true, writable: true })
    delete require.cache[SERVICE_PATH]
    void serviceModule
  }
})

test("S8: «не дозвонились» не подменяет цену и не меняет заказ", async () => {
  const calls = []
  const updates = []
  const PRISMA = require("../.test-build/lib/prisma.js")
  const original = PRISMA.prisma
  Object.defineProperty(PRISMA, "prisma", {
    value: {
      priceCall: { create: async ({ data }) => (calls.push(data), { id: "c", ...data, createdAt: NOW }) },
      order: { updateMany: async (args) => (updates.push(args), { count: 1 }) },
    },
    configurable: true,
    writable: true,
  })
  const SERVICE_PATH = require.resolve("../.test-build/lib/pricing/service.js")
  delete require.cache[SERVICE_PATH]
  const service = require(SERVICE_PATH)
  try {
    const result = await service.recordPriceCall({
      organizationId: "org-1",
      refKind: "order",
      refId: "order-7",
      outcome: "no_answer",
      amountRub: 90000,
    })
    assert.equal(calls[0].amountRub, null, "сумма от несостоявшегося разговора не пишется")
    assert.equal(updates.length, 0, "заказ не тронут")
    assert.equal(result.confirmedOrder, false)
  } finally {
    Object.defineProperty(PRISMA, "prisma", { value: original, configurable: true, writable: true })
    delete require.cache[SERVICE_PATH]
  }
})

// ── Сценарий 9. Заказ с расчётной ценой в сборщике ──────────────────────────

test("S9: заказ с расчётной ценой помечен как расчётный, а доход рейса делится", () => {
  const estimatedRate = {
    amount: 40000,
    basis: "perTrip",
    status: "ESTIMATED",
    estimate: {
      amountRub: 40000,
      lowRub: 38000,
      highRub: 42000,
      perKmRub: 105,
      confidence: "medium",
      samples: 4,
      sources: ["ati-same-direction"],
      basis: "4 сопоставимых",
      measuredAt: new Date("2026-11-03T09:00:00.000Z").toISOString(),
      currency: "RUB",
      costFloorRub: null,
    },
    raw: 0,
  }
  assert.equal(S.rateStatus(estimatedRate), "ESTIMATED")
  assert.equal(S.isConfirmed(estimatedRate.amount, "ESTIMATED"), false)
  assert.equal(S.isEstimated(estimatedRate.amount, "ESTIMATED"), true)
  const view = F.describePrice({ status: "ESTIMATED", amountRub: 0 }, estimatedRate.estimate)
  assert.equal(view.confirmed, false)
  assert.match(view.headline, /^≈/)
  assert.ok(view.details.some((line) => /ориентировочная рыночная стоимость/.test(line)))
  assert.ok(view.details.some((line) => /аналог/.test(line)))
  assert.ok(view.details.some((line) => /уверенность/.test(line)))
})

// ── Сценарий 10. Показ цены: все обязательные элементы ─────────────────────

test("S10: в показе есть диапазон, ₽/км, число аналогов, дата, источник, уверенность", () => {
  const outcome = E.buildEstimate(request(), [
    sample({ amountRub: 42000 }),
    sample({ amountRub: 45000 }),
    sample({ amountRub: 47000 }),
    sample({ amountRub: 49000 }),
  ])
  assert.equal(outcome.ok, true)
  const view = F.describePrice({ status: "NEGOTIATION_REQUIRED", amountRub: 0 }, outcome.estimate)
  const text = view.details.join(" | ")
  assert.match(text, /Стоимость ATI\.SU: не указана/, "прямо сказано, что было в источнике")
  assert.match(text, /ориентировочная рыночная стоимость/, "диапазон назван словами")
  assert.match(text, /₽\/км/)
  assert.match(text, /основание: \d+ аналогичных/, "на чём основано")
  assert.match(text, /аналог/)
  assert.match(text, /данные от/)
  assert.match(text, /источник:/)
  assert.match(text, /уверенность:/)
  assert.match(text, /статус: требуется подтверждение по телефону/, "что делать дальше")
  assert.equal(view.confirmed, false)
})

test("S10: показ расчётной цены следует структуре из ТЗ", () => {
  // Требование §5 ТЗ: сначала что было в источнике, потом рынок, потом
  // расчёт, уверенность, основание и статус. Порядок строк проверяется, чтобы
  // «0 ₽» не оказалось на экране выше объяснения, что это «не указана».
  const outcome = E.buildEstimate(request(), [
    sample({ amountRub: 42000 }),
    sample({ amountRub: 45000 }),
    sample({ amountRub: 47000 }),
    sample({ amountRub: 49000 }),
  ])
  const view = F.describePrice({ status: "NEGOTIATION_REQUIRED", amountRub: 0 }, outcome.estimate)
  const lines = view.details.join("\n")
  const order = ["Стоимость ATI.SU", "ориентировочная рыночная стоимость", "уверенность:", "статус:"]
  let cursor = -1
  for (const marker of order) {
    const at = lines.indexOf(marker)
    assert.ok(at > cursor, `строка «${marker}» должна идти после предыдущих`)
    cursor = at
  }
  assert.match(view.headline, /^≈ \d/, "в заголовке — расчётная сумма, а не ноль")
  assert.equal(view.confirmed, false)
})

test("S10: без предложений на направлении звонить некуда — и это сказано словами", () => {
  const note = F.contactlessNote("no-offers")
  assert.match(note, /Контактов нет/)
  assert.match(note, /не вернула ни одного предложения/)
  assert.match(note, /Позвоните заказчику/)
  const phone = F.contactlessNote("no-phone")
  assert.match(phone, /Контактов в предложении нет/)
  assert.notEqual(note, phone, "два разных случая — два разных текста")
})


test("S10: приоритет источников — как в ТЗ: сначала предложения ATI, история после", () => {
  // Порядок поиска в ТЗ: аналоги ATI на этом направлении → близкие
  // направления → собственная история. Вес у истории при этом больше (своя
  // сделка надёжнее объявления), но первым в списке источников идёт тот, что
  // сработал раньше по приоритету.
  const board = [sample({ id: "ati:1", amountRub: 45000 })]
  const history = [sample({ id: "order:1", origin: "history", amountRub: 45000, organizationId: "org-1" })]
  const outcome = E.buildEstimate(request(), [...history, ...board])
  assert.equal(outcome.ok, true)
  assert.equal(outcome.estimate.sources[0], "ati-same-direction", "первый источник — предложения ATI")
  assert.ok(outcome.estimate.sources.includes("history"), "история не потеряна, но идёт после")
  assert.equal(outcome.estimate.source, outcome.estimate.sources[0])
})

test("S4: без аналогов показывается себестоимость — как нижняя граница, а не как цена", () => {
  const outcome = E.buildEstimate(request({ costFloorRub: 31000 }), [])
  assert.equal(outcome.ok, false, "оценки рынка нет")
  const view = F.describePrice({ status: "NEGOTIATION_REQUIRED", amountRub: null, costFloorRub: outcome.costFloorRub })
  assert.equal(view.hasAmount, false, "суммы в заголовке нет")
  const text = view.details.join(" | ")
  assert.match(text, /не меньше 31\s*000\s*₽/, "нижняя граница названа")
  assert.match(text, /это себестоимость, а не рыночная цена/, "и честно подписана")
  const withoutFloor = F.describePrice({ status: "NEGOTIATION_REQUIRED", amountRub: null })
  assert.ok(!withoutFloor.details.join(" ").includes("себестоимость"), "нет данных о расходах — нет и строки")
})

// ── Сценарий 11. Предложений нет: оценка по близким направлениям ────────────

test("S11: направление пустое — оценка берётся с близких направлений и так подписана", () => {
  const outcome = E.buildEstimate(request(), [
    sample({ fromCity: "Ярославль", toCity: "Орёл", amountRub: 40000, km: 500 }),
    sample({ fromCity: "Ярославль", toCity: "Курск", amountRub: 44000, km: 620 }),
    sample({ fromCity: "Ярославль", toCity: "Липецк", amountRub: 42000, km: 560 }),
  ])
  assert.equal(outcome.ok, true)
  assert.equal(outcome.used.filter((item) => item.relation === "same-direction").length, 0)
  assert.ok(outcome.estimate.sources.includes("ati-nearby"))
  assert.match(outcome.estimate.basis, /близких направлениях/)
  // С близких направлений высокая уверенность невозможна: сравнение идёт
  // через приведение по километрам, а это допущение. Средняя — потолок.
  assert.notEqual(outcome.estimate.confidence, "high")
})

// ── Сценарий 12. Адаптер и ставка: статус не теряется ───────────────────────

const PLACES = new Map(
  [
    { city: "Ярославль", region: "Ярославская область", lat: 57.6261, lng: 39.8845 },
    { city: "Тула", region: "Тульская область", lat: 54.1961, lng: 37.6182 },
  ].map((row) => [A.cityKey(row.city), A.placeFromCity(row)]),
)

test("S12: цена из ATI переносится в заказ вместе со статусом и исходным значением", () => {
  const withPrice = A.orderFromAtiRow(
    { atiLoadId: "a1", organisationId: "org-1", routeFrom: "Ярославль", routeTo: "Тула", price: 42000 },
    PLACES,
  )
  assert.equal(withPrice.order.rate.status, "CONFIRMED")
  assert.equal(withPrice.order.rate.amount, 42000)
  assert.equal(withPrice.order.rate.raw, 42000)

  const zero = A.orderFromAtiRow(
    { atiLoadId: "a2", organisationId: "org-1", routeFrom: "Ярославль", routeTo: "Тула", price: 0 },
    PLACES,
  )
  assert.equal(zero.order.rate.status, "NEGOTIATION_REQUIRED")
  assert.equal(zero.order.rate.amount, 0)
  assert.equal(zero.order.rate.raw, 0, "исходный ноль сохранён")

  const text = A.orderFromAtiRow(
    { atiLoadId: "a3", organisationId: "org-1", routeFrom: "Ярославль", routeTo: "Тула", priceRaw: "договорная" },
    PLACES,
  )
  assert.equal(text.order.rate.status, "NEGOTIATION_REQUIRED")
  assert.equal(text.order.rate.raw, "договорная", "«договорная» не теряется")
})

test("S12: расчётная цена нигде не сохраняется как подтверждённая", () => {
  // Статус ESTIMATED не проходит проверку на подтверждённость — ни в одном
  // месте: ни в сборщике, ни в экономике.
  assert.equal(S.isConfirmed(45000, "ESTIMATED"), false)
  assert.equal(S.isConfirmed(45000, "NEGOTIATION_REQUIRED"), false)
  assert.equal(S.isConfirmed(45000, "UNKNOWN"), false)
  assert.equal(S.isConfirmed(0, "CONFIRMED"), false, "подтверждённого нуля не бывает")
  assert.equal(S.isConfirmed(45000, "CONFIRMED"), true)
  // и в готовом объекте оценки нет поля «подтверждено»
  const outcome = E.buildEstimate(request(), [sample({ amountRub: 45000 })])
  assert.equal(outcome.ok, true)
  assert.equal(Object.prototype.hasOwnProperty.call(outcome.estimate, "confirmed"), false)
  assert.equal(outcome.estimate.status, undefined, "оценка не притворяется ставкой")
})

// ── Сценарий 13. Миграция не применена: экран не падает ─────────────────────

test("S13: если таблиц истории цен ещё нет, оценка честно отказывает, а не падает", async () => {
  const PRISMA = require("../.test-build/lib/prisma.js")
  const original = PRISMA.prisma
  const boom = async () => {
    throw new Error("The table `main.PriceEstimate` does not exist in the current database.")
  }
  Object.defineProperty(PRISMA, "prisma", {
    value: {
      priceEstimate: { create: boom, createMany: boom, findFirst: boom },
      priceCall: { create: boom, findMany: boom },
      atiCache: { findMany: boom },
      order: { findMany: boom, updateMany: boom },
      fleetSettings: { findFirst: boom },
    },
    configurable: true,
    writable: true,
  })
  const SERVICE_PATH = require.resolve("../.test-build/lib/pricing/service.js")
  delete require.cache[SERVICE_PATH]
  const service = require(SERVICE_PATH)
  try {
    const quotes = await service.quoteMany("org-1", [
      {
        refKind: "ati",
        refId: "ati-1",
        fromCity: "Ярославль",
        toCity: "Тула",
        km: 380,
        weightKg: 10000,
        volumeM3: 40,
        bodyType: "Тент",
        temperature: null,
        date: NOW,
      },
    ])
    const result = quotes.get("ati-1")
    assert.ok(result, "ответ есть даже без таблиц истории")
    assert.equal(result.ok, false, "данных нет — оценки нет")
    assert.match(result.reason, /сопоставимых/)
    // Ни одного выдуманного числа: суммы в отказе нет
    assert.equal(result.estimate, undefined)

    const call = await service.callHistory("org-1", "ati", "ati-1")
    assert.deepEqual(call, [], "история звонков пустая, а не ошибка экрана")
  } finally {
    Object.defineProperty(PRISMA, "prisma", { value: original, configurable: true, writable: true })
    delete require.cache[SERVICE_PATH]
  }
})
