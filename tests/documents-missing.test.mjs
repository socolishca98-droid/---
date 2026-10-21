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
