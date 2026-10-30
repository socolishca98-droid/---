/**
 * Тесты «чего не хватает для документов» (задача 3, пункт B2).
 *
 * Проверяется, что список выдаётся именно по незаполненным полям: пустой
 * рейс, заказы без цены/клиента/веса/срока, отсутствие экипажа и реквизитов,
 * а полностью заполненный рейс не даёт ни одного пункта.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { missingForDocuments } = require("../.test-build/lib/documents/missing.js")

const fullOrder = (extra = {}) => ({
  clientName: "ООО Ромашка",
  weightKg: 12000,
  priceRub: 45000,
  agreedPriceRub: null,
  deadline: new Date("2026-09-30"),
  paymentType: "bank",
  vatType: "vat20",
  ...extra,
})

const fullRoute = (extra = {}) => ({
  driverName: "Сидоров Пётр",
  vehiclePlate: "А001АА76",
  orders: [fullOrder()],
  ...extra,
})

const keys = (items) => items.map((item) => item.key)

test("полностью заполненный рейс: не хватает ничего", () => {
  const items = missingForDocuments({ route: fullRoute() })
  assert.deepEqual(items, [])
})

test("пустой рейс: единственный пункт — нет заказов, и он предупреждение", () => {
  const items = missingForDocuments({ route: { driverName: "Иванов", vehiclePlate: null, orders: [] } })
  assert.deepEqual(keys(items), ["no-orders"])
  assert.equal(items[0].severity, "warning")
})

test("цена — блокер: счёт и акт без суммы недействительны", () => {
  const items = missingForDocuments({
    route: fullRoute({ orders: [fullOrder({ priceRub: null }), fullOrder()] }),
  })
  const price = items.find((item) => item.key === "price")
  assert.ok(price)
  assert.equal(price.severity, "blocker")
  assert.equal(price.label, "Не задана цена перевозки (1 из 2)")
  assert.ok(price.kinds.includes("invoice"))
  assert.ok(price.kinds.includes("act"))
})

test("согласованная цена тоже считается ценой", () => {
  const items = missingForDocuments({
    route: fullRoute({ orders: [fullOrder({ priceRub: null, agreedPriceRub: 50000 })] }),
  })
  assert.deepEqual(keys(items), [])
})

test("реквизиты организации: пустые поля — блокер", () => {
  const items = missingForDocuments({
    route: fullRoute(),
    requisites: { legalName: "ИП Фролов", inn: null, legalAddress: "Ярославль" },
  })
  const req = items.find((item) => item.key === "requisites")
  assert.ok(req)
  assert.equal(req.severity, "blocker")

  // null целиком — тоже не хватает
  const noSettings = missingForDocuments({ route: fullRoute(), requisites: null })
  assert.ok(noSettings.find((item) => item.key === "requisites"))
})

test("реквизиты не переданы (карточка рейса): пункт не выдаётся", () => {
  const items = missingForDocuments({ route: fullRoute() })
  assert.deepEqual(items, [])
})

test("экипаж и детали заказа: отдельные пункты-предупреждения", () => {
  const items = missingForDocuments({
    route: {
      driverName: null,
      vehiclePlate: null,
      orders: [fullOrder({ clientName: null, weightKg: null, deadline: null, paymentType: null })],
    },
  })
  assert.deepEqual(
    keys(items).sort(),
    ["client", "deadline", "driver", "payment-terms", "vehicle", "weight"],
  )
  assert.ok(items.every((item) => item.severity === "warning"))
})

test("блокеры идут первыми", () => {
  const items = missingForDocuments({
    route: {
      driverName: null,
      vehiclePlate: null,
      orders: [fullOrder({ priceRub: null })],
    },
    requisites: { legalName: null, inn: null, legalAddress: null },
  })
  const firstBlocker = items.findIndex((item) => item.severity === "blocker")
  const firstWarning = items.findIndex((item) => item.severity === "warning")
  assert.ok(firstBlocker >= 0 && firstWarning >= 0 && firstBlocker < firstWarning)
  assert.deepEqual(
    items.slice(0, firstWarning).map((item) => item.key).sort(),
    ["price", "requisites"],
  )
})

test("пустая строка — это «не заполнено»", () => {
  const items = missingForDocuments({
    route: fullRoute({ driverName: "  ", orders: [fullOrder({ clientName: "  " })] }),
  })
  assert.deepEqual(keys(items).sort(), ["client", "driver"])
})

test("заказ в форме API рейса (price/weight) не даёт ложных «нет цены» и «нет веса»", () => {
  // В /api/routes заказ приходит как запись Prisma: weight, price, agreedPrice.
  // Раньше проверка смотрела только weightKg/priceRub/agreedPriceRub и на
  // заполненном рейсе показывала два блокера подряд.
  const apiOrder = {
    clientName: "ООО Ромашка",
    weight: 15000,
    price: 270000,
    agreedPrice: null,
    deadline: "2026-10-29T00:00:00.000Z",
    paymentType: "cash",
    vatType: "no_vat",
  }
  const items = missingForDocuments({
    route: { driverName: "Кузнецов", vehiclePlate: "В108МК799", orders: [apiOrder] },
  })
  assert.deepEqual(keys(items), [])
})

test("нулевая цена и нулевой вес — всё равно «не заполнено»", () => {
  const items = missingForDocuments({
    route: fullRoute({ orders: [fullOrder({ weightKg: 0, priceRub: 0 })] }),
  })
  assert.deepEqual(keys(items).sort(), ["price", "weight"])
})

test("условия оплаты в базе читаются в любом виде (no_vat, prepay)", () => {
  // Диалог «Условия оплаты» раньше показывал «Не указан» на значениях
  // no_vat/with_vat и стирал их при сохранении — проверяем нормализаторы.
  const { normalizePaymentType, normalizeVatType } = require("../.test-build/lib/payments/summary.js")
  assert.equal(normalizeVatType("no_vat"), "none")
  assert.equal(normalizeVatType("without_vat"), "none")
  assert.equal(normalizeVatType("with_vat"), "included")
  assert.equal(normalizeVatType("20"), "vat20")
  assert.equal(normalizeVatType("vat10"), "vat10")
  assert.equal(normalizePaymentType("bank_transfer"), "bank")
  assert.equal(normalizePaymentType("нал"), "cash")
  // Незнакомое значение не выдумываем: null — форма покажет его как есть
  assert.equal(normalizePaymentType("prepay"), null)
  assert.equal(normalizeVatType("неведомо"), null)
})
