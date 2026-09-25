// tests/payments-summary.test.mjs
//
// Оплаты по заказам (задача 6): сумма, срок, просрочка, сводка, должники,
// напоминания и выгрузка для бухгалтерии. Чистые функции — база не нужна.

import assert from "node:assert/strict"
import test from "node:test"

import {
  buildAccountingCsv,
  buildDebtors,
  buildPaymentRow,
  buildPaymentsSummary,
  daysBetween,
  isDeferredOrder,
  normalizePaymentType,
  orderAmount,
  overdueDaysFor,
  overdueReminderText,
  paymentDueDate,
  paymentStateLabel,
  paymentTypeLabel,
  vatLabel,
} from "../.test-build/lib/payments/summary.js"

const NOW = new Date("2026-09-24T12:00:00")

function order(overrides = {}) {
  return {
    id: "o1",
    clientName: "ООО Ромашка",
    routeFrom: "Москва",
    routeTo: "Казань",
    distance: 800,
    cargoType: "Груз",
    createdAt: new Date("2026-09-01T10:00:00"),
    deadline: new Date("2026-09-05T10:00:00"),
    status: "delivered",
    ...overrides,
  }
}

test("сумма заказа: согласованная цена важнее первоначальной", () => {
  assert.equal(orderAmount(order({ price: 50000, agreedPrice: 62000 })), 62000)
  assert.equal(orderAmount(order({ price: 50000, agreedPrice: null })), 50000)
  assert.equal(orderAmount(order({ price: null, agreedPrice: null })), 0)
})

test("форма оплаты приводится к канону, старое значение не теряется", () => {
  assert.equal(normalizePaymentType("bank_transfer"), "bank")
  assert.equal(normalizePaymentType("Наличные"), "cash")
  assert.equal(normalizePaymentType("deferred"), "bank")
  assert.equal(normalizePaymentType("карта"), "card")
  assert.equal(normalizePaymentType("крипта"), null)
  assert.equal(paymentTypeLabel("крипта"), "крипта")
  assert.equal(paymentTypeLabel(null), "Не указана")
  assert.equal(paymentTypeLabel("bank_transfer"), "Безнал")
})

test("НДС: и канонические значения, и старые, и свободный текст", () => {
  assert.equal(vatLabel("vat20"), "НДС 20%")
  assert.equal(vatLabel("without_vat"), "Без НДС")
  assert.equal(vatLabel("20"), "НДС 20%")
  assert.equal(vatLabel("НДС 5%"), "НДС 5%")
  assert.equal(vatLabel(null), null)
})

test("срок оплаты: явная дата важнее расчёта от отсрочки", () => {
  const explicit = new Date("2026-10-01T00:00:00")
  assert.deepEqual(
    paymentDueDate(order({ dueDate: explicit, deferredDays: 5 })),
    explicit,
  )
})

test("срок оплаты считается от даты доставки, иначе от срока по заказу, иначе от создания", () => {
  const completed = paymentDueDate(
    order({ deferredDays: 10, deliveredAt: new Date("2026-09-10T00:00:00") }),
  )
  assert.equal(completed.toISOString().slice(0, 10), "2026-09-20")

  const byDeadline = paymentDueDate(order({ deferredDays: 3 }))
  assert.equal(byDeadline.toISOString().slice(0, 10), "2026-09-08")

  const byCreated = paymentDueDate(
    order({ deferredDays: 7, deadline: null, createdAt: new Date("2026-09-02T00:00:00") }),
  )
  assert.equal(byCreated.toISOString().slice(0, 10), "2026-09-09")

  assert.equal(paymentDueDate(order({ deferredDays: 0 })), null)
})

test("отсрочка определяется и по дням, и по заданному сроку", () => {
  assert.equal(isDeferredOrder(order({ deferredDays: 14 })), true)
  assert.equal(isDeferredOrder(order({ dueDate: new Date("2026-10-01") })), true)
  assert.equal(isDeferredOrder(order({ deferredDays: 0, dueDate: null })), false)
})

test("просрочка считается целыми днями и не считается по оплаченным", () => {
  assert.equal(
    overdueDaysFor(order({ dueDate: new Date("2026-09-14T00:00:00") }), NOW),
    10,
  )
  assert.equal(
    overdueDaysFor(
      order({ dueDate: new Date("2026-09-14T00:00:00"), isPaid: true, paidAt: NOW }),
      NOW,
    ),
    0,
  )
  // срок ещё не наступил
  assert.equal(overdueDaysFor(order({ dueDate: new Date("2026-09-30T00:00:00") }), NOW), 0)
  // срок сегодня — просрочка ещё не началась
  assert.equal(overdueDaysFor(order({ dueDate: new Date("2026-09-24T00:00:00") }), NOW), 0)
})

test("строка оплаты собирает клиента, маршрут, срок и напоминания", () => {
  const row = buildPaymentRow(
    order({
      price: 40000,
      agreedPrice: 45000,
      clientId: "c1",
      clientName: "ООО Ромашка",
      clientContact: "+79000000001",
      paymentType: "bank_transfer",
      vatType: "vat20",
      deferredDays: 10,
      dueDate: new Date("2026-09-14T00:00:00"),
      client: { id: "c1", name: "Ромашка", inn: "760100000000" },
    }),
    NOW,
    { lastAt: new Date("2026-09-23T09:00:00"), count: 2 },
  )

  assert.equal(row.amount, 45000)
  assert.equal(row.paymentType, "bank")
  assert.equal(row.clientName, "Ромашка")
  assert.equal(row.inn, "760100000000")
  assert.equal(row.isOverdue, true)
  assert.equal(row.overdueDays, 10)
  assert.equal(row.reminderCount, 2)
  assert.equal(paymentStateLabel(row), "Просрочен на 10 дн.")
})

test("сводка: суммы по состояниям, отменённые не оплачиваются дважды", () => {
  const rows = [
    buildPaymentRow(
      order({ id: "paid", price: 50000, isPaid: true, paidAt: new Date("2026-09-20T00:00:00"), dueDate: new Date("2026-09-18T00:00:00") }),
      NOW,
    ),
    buildPaymentRow(
      order({ id: "pending", price: 30000, deferredDays: 7, dueDate: new Date("2026-10-01T00:00:00") }),
      NOW,
    ),
    buildPaymentRow(
      order({ id: "overdue", price: 20000, deferredDays: 7, dueDate: new Date("2026-09-20T00:00:00") }),
      NOW,
    ),
    buildPaymentRow(order({ id: "cash", price: 10000, paymentType: "cash" }), NOW),
  ]

  const summary = buildPaymentsSummary(rows)

  assert.equal(summary.totalOrders, 4)
  assert.equal(summary.totalRevenue, 110000)
  assert.equal(summary.totalPaid, 50000)
  assert.equal(summary.paidCount, 1)
  assert.equal(summary.totalPending, 60000)
  assert.equal(summary.pendingCount, 3)
  assert.equal(summary.totalDeferred, 50000)
  assert.equal(summary.deferredCount, 2)
  assert.equal(summary.totalOverdue, 20000)
  assert.equal(summary.overdueCount, 1)
  // оплачено с опозданием на 2 дня от срока
  assert.equal(summary.avgPaymentDays, 2)
})

test("сводка без оплат: средний срок оплаты — нет данных, а не ноль", () => {
  const summary = buildPaymentsSummary([buildPaymentRow(order({ price: 1000 }), NOW)])
  assert.equal(summary.avgPaymentDays, null)
  assert.equal(summary.paidCount, 0)
})

test("должники группируются по клиенту, а без карточки — по нормализованному имени", () => {
  const rows = [
    buildPaymentRow(order({ id: "a", clientId: "c1", client: { id: "c1", name: "ООО Ромашка" }, price: 30000, dueDate: new Date("2026-09-10") }), NOW),
    buildPaymentRow(order({ id: "b", clientId: "c1", client: { id: "c1", name: "ООО Ромашка" }, price: 20000, dueDate: new Date("2026-09-20"), deliveredAt: NOW }), NOW),
    buildPaymentRow(order({ id: "c", clientName: 'ООО "Тюльпан"', price: 10000 }), NOW),
    buildPaymentRow(order({ id: "d", clientName: "Тюльпан", price: 5000, dueDate: new Date("2026-09-01") }), NOW),
    buildPaymentRow(order({ id: "e", clientName: "Тюльпан", price: 7000, isPaid: true }), NOW),
  ]

  const debtors = buildDebtors(rows)

  assert.equal(debtors.length, 2)

  const romashka = debtors.find((d) => d.clientId === "c1")
  assert.equal(romashka.debt, 50000)
  assert.equal(romashka.ordersCount, 2)
  assert.equal(romashka.overdueCount, 2)
  assert.equal(romashka.maxOverdueDays, 14)

  const tulpan = debtors.find((d) => d.clientId === null)
  assert.equal(tulpan.debt, 15000)
  assert.equal(tulpan.ordersCount, 2)
  assert.equal(tulpan.overdue, 5000)
  assert.equal(tulpan.maxOverdueDays, 23)

  // оплаченный заказ в долги не попал
  assert.equal(debtors.reduce((sum, d) => sum + d.ordersCount, 0), 4)
})

test("должники без долга не показываются, порядок — по просрочке", () => {
  const rows = [
    buildPaymentRow(order({ id: "small", clientName: "Тюльпан", price: 1000, dueDate: new Date("2026-09-22") }), NOW),
    buildPaymentRow(order({ id: "big", clientName: "Ромашка", price: 99999, dueDate: new Date("2026-08-01") }), NOW),
    buildPaymentRow(order({ id: "none", clientName: "Без долга", price: 0 }), NOW),
  ]

  const debtors = buildDebtors(rows)
  assert.deepEqual(
    debtors.map((d) => d.clientName),
    ["Ромашка", "Тюльпан"],
  )
})

test("текст напоминания содержит клиента, сумму, маршрут, срок и просрочку", () => {
  const row = buildPaymentRow(
    order({
      id: "ord-1",
      clientName: "ООО Ромашка",
      clientContact: "+79000000001",
      price: 45000,
      dueDate: new Date("2026-09-14T00:00:00"),
    }),
    NOW,
  )

  const reminder = overdueReminderText(row)

  assert.equal(reminder.title, "Просрочена оплата")
  assert.match(reminder.message, /ООО Ромашка/)
  assert.match(reminder.message, /45\s000\s₽/)
  assert.match(reminder.message, /ord-1/)
  assert.match(reminder.message, /Москва → Казань/)
  assert.match(reminder.message, /14\.09\.2026/)
  assert.match(reminder.message, /10 дн\./)
  assert.match(reminder.message, /\+79000000001/)
})

test("выгрузка для бухгалтерии: заголовки, суммы и даты понятны Excel", () => {
  const rows = [
    buildPaymentRow(
      order({
        id: "ord-1",
        clientName: "ООО Ромашка; дочка",
        price: 44000,
        agreedPrice: 45000,
        vatType: "vat20",
        paymentType: "bank_transfer",
        dueDate: new Date("2026-09-14T00:00:00"),
        client: { id: "c1", name: "ООО Ромашка; дочка", inn: "760100000000" },
      }),
      NOW,
    ),
    buildPaymentRow(
      order({ id: "ord-2", clientName: "ИП Петров", price: 12000, paymentType: "cash", isPaid: true, paidAt: new Date("2026-09-19T00:00:00") }),
      NOW,
    ),
  ]

  const csv = buildAccountingCsv(rows)
  const lines = csv.split("\r\n").filter(Boolean)

  assert.equal(csv.startsWith("\uFEFF"), true, "BOM нужен для Excel")
  assert.equal(lines.length, 3)
  assert.match(lines[0].replace(/^\uFEFF/, ""), /^Заказ;Дата заказа;Клиент;ИНН;/)
  // точка с запятой внутри названия не должна разорвать колонки
  assert.match(lines[1], /"ООО Ромашка; дочка"/)
  assert.match(lines[1], /760100000000/)
  assert.match(lines[1], /45000/)
  assert.match(lines[1], /НДС 20%/)
  assert.match(lines[1], /Безнал/)
  assert.match(lines[1], /14\.09\.2026/)
  assert.match(lines[1], /Просрочен на 10 дн\./)
  assert.match(lines[2], /Оплачен/)
  assert.match(lines[2], /19\.09\.2026/)
})

test("дни между датами считаются по календарю, а не часами", () => {
  assert.equal(
    daysBetween(new Date("2026-09-14T23:00:00"), new Date("2026-09-15T01:00:00")),
    1,
  )
  assert.equal(
    daysBetween(new Date("2026-09-14T01:00:00"), new Date("2026-09-14T23:00:00")),
    0,
  )
})
