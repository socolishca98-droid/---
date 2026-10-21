/**
 * Тесты денежных документов (задача 3, пункт B1): счёт на оплату, акт
 * выполненных работ, сумма прописью и НДС.
 *
 * Проверяется то, что бухгалтерия читает первой строкой: сумма цифрами
 * совпадает с суммой прописью, НДС считается по условию заказа, а номер
 * документа — через общий нумератор рейса (routeDocumentNumber).
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { amountInWords, numberInWords } = require("../.test-build/lib/documents/money-words.js")
const { vatBreakdown } = require("../.test-build/lib/documents/vat.js")
const {
  buildAct,
  buildInvoice,
  buildRouteDocuments,
  orderPrice,
  routeDocumentNumber,
} = require("../.test-build/lib/documents/build.js")

const order = (extra = {}) => ({
  id: "order-1",
  routeFrom: "Ярославль",
  routeTo: "Москва",
  cargoType: "Бытовая техника",
  weightKg: 12000,
  volumeM3: 40,
  priceRub: 45000,
  agreedPriceRub: null,
  clientName: "ООО Ромашка",
  clientContact: "+7 495 000-00-00",
  paymentType: "bank",
  vatType: "vat20",
  deferredDays: 5,
  deadline: new Date("2026-09-30T00:00:00"),
  notes: null,
  ...extra,
})

const route = (extra = {}) => ({
  id: "route-1",
  name: "Рейс: Ярославль — Москва",
  status: "completed",
  startedAt: new Date("2026-09-24T06:30:00"),
  completedAt: new Date("2026-09-25T18:00:00"),
  createdAt: new Date("2026-09-24T05:00:00"),
  totalDistanceKm: 270,
  tripDistanceKm: 280,
  totalCostRub: 18000,
  fuelExpenseRub: 7000,
  cargoWeightKg: 12000,
  notes: null,
  baseAddress: "г. Ярославль, ул. Промышленная, д. 5",
  orders: [order()],
  crew: {
    vehiclePlate: "А001АА76",
    vehicleType: "truck",
    vehicleBrand: "Volvo",
    vehicleModel: "FH",
    vehicleCapacityKg: 20000,
    driverName: "Сидоров Пётр",
    driverPhone: "+7 900 000-00-01",
  },
  ...extra,
})

const CARRIER = {
  name: "ИП Фролов Иван Александрович",
  legalName: "ИП Фролов Иван Александрович",
  inn: "760100000000",
  kpp: null,
  ogrn: "320000000000000",
  legalAddress: "150000, г. Ярославль, ул. Промышленная, д. 5",
  phone: "+7 900 000-00-00",
  email: "mail@example.ru",
  bankName: "Отделение банка",
  bankBic: "047888777",
  bankAccount: "40802810000000000001",
  signerName: "Фролов И. А.",
  signerPosition: "Индивидуальный предприниматель",
}

// ---------------------------------------------------------------------------
// Сумма прописью
// ---------------------------------------------------------------------------

test("сумма прописью: числа, формы слова «рубль» и границы разрядов", () => {
  assert.equal(numberInWords(0), "ноль")
  assert.equal(numberInWords(1), "один")
  assert.equal(numberInWords(2), "два")
  assert.equal(numberInWords(5), "пять")
  assert.equal(numberInWords(11), "одиннадцать")
  assert.equal(numberInWords(21), "двадцать один")
  assert.equal(numberInWords(100), "сто")
  assert.equal(numberInWords(1000), "одна тысяча")
  assert.equal(numberInWords(1001), "одна тысяча один")
  assert.equal(numberInWords(2000000), "два миллиона")
})

test("сумма прописью: рубли с правильной формой слова", () => {
  assert.equal(amountInWords(1), "один рубль 00 копеек")
  assert.equal(amountInWords(2), "два рубля 00 копеек")
  assert.equal(amountInWords(5), "пять рублей 00 копеек")
  assert.equal(amountInWords(11), "одиннадцать рублей 00 копеек")
  assert.equal(amountInWords(21), "двадцать один рубль 00 копеек")
  assert.equal(amountInWords(0), "ноль рублей 00 копеек")
  assert.equal(amountInWords(2000000), "два миллиона рублей 00 копеек")
})

test("сумма прописью: копейки печатаются двумя цифрами и своей формой", () => {
  assert.equal(amountInWords(0.01), "ноль рублей 01 копейка")
  assert.equal(amountInWords(0.02), "ноль рублей 02 копейки")
  assert.equal(amountInWords(0.05), "ноль рублей 05 копеек")
  assert.equal(amountInWords(1.01), "один рубль 01 копейка")
  assert.equal(amountInWords(2.05), "два рубля 05 копеек")
  assert.equal(amountInWords(1234.56), "одна тысяча двести тридцать четыре рубля 56 копеек")
  assert.equal(amountInWords(45000), "сорок пять тысяч рублей 00 копеек")
})

test("сумма прописью: округление копеек арифметическое, перенос в рубли", () => {
  assert.equal(amountInWords(1.999), "два рубля 00 копеек")
  assert.equal(amountInWords(1.995), "два рубля 00 копеек")
  assert.equal(amountInWords(10.004), "десять рублей 00 копеек")
})

// ---------------------------------------------------------------------------
// НДС
// ---------------------------------------------------------------------------

test("НДС: ставки считаются из vatType, неизвестное — «без НДС»", () => {
  const none = vatBreakdown("none", 1000)
  assert.equal(none.vatAmount, 0)
  assert.equal(none.grossAmount, 1000)
  assert.equal(none.label, "Без НДС")

  const v20 = vatBreakdown("vat20", 1000)
  assert.equal(v20.vatAmount, 200)
  assert.equal(v20.grossAmount, 1200)
  assert.equal(v20.label, "НДС 20% — 200 ₽")

  const v10 = vatBreakdown("vat10", 1000)
  assert.equal(v10.vatAmount, 100)
  assert.equal(v10.grossAmount, 1100)

  // неизвестное условие — не придумываем ставку
  const unknown = vatBreakdown("какой-то текст", 1000)
  assert.equal(unknown.vatAmount, 0)
  assert.equal(unknown.label, "Без НДС")
})

test("НДС включён в стоимость: налог выделяется из суммы", () => {
  const inc = vatBreakdown("included", 1200)
  assert.equal(inc.rate, 0.2)
  assert.equal(inc.netAmount, 1000)
  assert.equal(inc.vatAmount, 200)
  assert.equal(inc.grossAmount, 1200)
  assert.equal(inc.included, true)
})

// ---------------------------------------------------------------------------
// Счёт и акт
// ---------------------------------------------------------------------------

test("счёт на оплату: сумма цифрами совпадает с суммой прописью, НДС по условию", () => {
  const doc = buildInvoice(route(), order(), CARRIER, 0)

  assert.equal(doc.kind, "invoice")
  assert.equal(doc.title, "Счёт на оплату")
  assert.equal(doc.number, routeDocumentNumber(route(), 3, 0))

  const total = doc.blocks.find((block) => block.title === "Итого")
  assert.ok(total)
  // 45000 + НДС 20% = 54000
  assert.equal(total.fields.find((f) => f.label === "Сумма к оплате").value, "54 000 ₽")
  assert.equal(total.fields.find((f) => f.label === "В том числе НДС").value, "НДС 20% — 9 000 ₽")
  assert.equal(
    total.fields.find((f) => f.label === "Сумма прописью").value,
    "пятьдесят четыре тысячи рублей 00 копеек",
  )

  // плательщик — клиент заказа
  const payer = doc.blocks.find((block) => block.title === "Плательщик (клиент)")
  assert.equal(payer.fields.find((f) => f.label === "Наименование").value, "ООО Ромашка")
})

test("счёт: цена из переговоров важнее прайса; без цены — предупреждение, а не выдумка", () => {
  const agreed = buildInvoice(route(), order({ agreedPriceRub: 50000 }), CARRIER, 0)
  const totalAgreed = agreed.blocks.find((block) => block.title === "Итого")
  assert.equal(totalAgreed.fields.find((f) => f.label === "Сумма к оплате").value, "60 000 ₽")

  const noPrice = buildInvoice(route(), order({ priceRub: null, agreedPriceRub: null }), CARRIER, 0)
  assert.equal(noPrice.tables.length, 0)
  assert.ok(noPrice.notes.some((note) => note.includes("не задана")))
})

test("акт выполненных работ: подписи обеих сторон, сумма и НДС на месте", () => {
  const doc = buildAct(route(), order(), CARRIER, 0)

  assert.equal(doc.kind, "act")
  assert.equal(doc.number, routeDocumentNumber(route(), 4, 0))
  assert.ok(doc.signatures.some((line) => line.startsWith("Исполнитель")))
  assert.ok(doc.signatures.some((line) => line.startsWith("Заказчик")))

  const total = doc.blocks.find((block) => block.title === "Итого")
  assert.equal(total.fields.find((f) => f.label === "Всего стоимость работ").value, "54 000 ₽")
  assert.ok(doc.tables[0].columns.includes("Наименование"))
})

test("сборка комплекта: счёт и акт печатаются по заказу, только по явному выбору", () => {
  const r = route({ orders: [order({ id: "order-1" }), order({ id: "order-2" })] })
  const docs = buildRouteDocuments({ route: r, carrier: CARRIER, kinds: ["invoice", "act"] })

  assert.equal(docs.length, 4)
  assert.deepEqual(
    docs.map((doc) => doc.kind),
    ["invoice", "invoice", "act", "act"],
  )
  // номера по заказам: /1 и /2
  assert.deepEqual(
    docs.filter((doc) => doc.kind === "invoice").map((doc) => doc.number.endsWith("/1") || doc.number.endsWith("/2")),
    [true, true],
  )

  // рейс без заказов: счёт и акт не печатаются (пустой бланк бессмыслен)
  const empty = buildRouteDocuments({
    route: route({ orders: [] }),
    carrier: CARRIER,
    kinds: ["invoice", "act", "waybill"],
  })
  assert.equal(empty.length, 1)
  assert.equal(empty[0].kind, "waybill")
})

test("цена заказа: согласованная цена важнее прайса", () => {
  assert.equal(orderPrice(order()), 45000)
  assert.equal(orderPrice(order({ agreedPriceRub: 50000 })), 50000)
  assert.equal(orderPrice(order({ priceRub: null, agreedPriceRub: null })), null)
})
