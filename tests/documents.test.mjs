/**
 * Тесты документов по рейсу (задача 3, пункт 3).
 *
 * Проверяется текст документов: набор документов по выбранным галочкам,
 * реквизиты перевозчика, подстановка груза и цен, и главное — поведение при
 * незаполненных данных: пустое поле остаётся пустым (строка для заполнения от
 * руки), а не превращается в выдуманное значение.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  DOCUMENT_KINDS,
  parseDocumentKinds,
} = require("../.test-build/lib/documents/types.js")
const {
  buildContract,
  buildRouteDocuments,
  buildTtn,
  buildWaybill,
  formatDateLong,
  formatMoney,
  formatWeight,
  orderPrice,
  paymentTerms,
  routeDocumentNumber,
} = require("../.test-build/lib/documents/build.js")

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
  status: "active",
  startedAt: new Date("2026-09-24T06:30:00"),
  completedAt: null,
  createdAt: new Date("2026-09-24T05:00:00"),
  totalDistanceKm: 270,
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

test("виды документов: параметр печати понимает галочки и не молчит на опечатке", () => {
  assert.deepEqual(DOCUMENT_KINDS, ["ttn", "waybill", "contract"])

  assert.deepEqual(parseDocumentKinds("ttn"), ["ttn"])
  assert.deepEqual(parseDocumentKinds("waybill,ttn"), ["ttn", "waybill"])
  assert.deepEqual(parseDocumentKinds(["contract", "ttn", "ttn"]), ["ttn", "contract"])
  // ничего не выбрано — печатаем полный комплект, а не пустой лист
  assert.deepEqual(parseDocumentKinds(""), [...DOCUMENT_KINDS])
  assert.deepEqual(parseDocumentKinds(null), [...DOCUMENT_KINDS])
})

test("деньги, вес и даты печатаются так, как принято в документах", () => {
  assert.equal(formatMoney(45000), "45 000 ₽")
  assert.equal(formatMoney(null), null)
  assert.equal(formatWeight(12000), "12 000 кг (12,0 т)")
  assert.equal(formatWeight(0), null)
  assert.equal(formatDateLong(new Date("2026-09-24T00:00:00")), "24 сентября 2026 г.")
})

test("цена берётся из согласованной, если она есть", () => {
  assert.equal(orderPrice(order()), 45000)
  assert.equal(orderPrice(order({ agreedPriceRub: 40000 })), 40000)
  assert.equal(orderPrice(order({ priceRub: null })), null)
})

test("порядок оплаты собирается из формы оплаты, НДС и отсрочки", () => {
  assert.equal(paymentTerms(order()), "безналичный расчёт, НДС 20%, отсрочка 5 дн.")
  assert.equal(paymentTerms(order({ paymentType: null, vatType: null, deferredDays: null })), null)
})

test("комплект: накладные и заявки — по заказу, путевой лист — один на рейс", () => {
  const documents = buildRouteDocuments({
    route: route({ orders: [order(), order({ id: "order-2", routeFrom: "Москва", routeTo: "Тверь" })] }),
    carrier: CARRIER,
    kinds: ["ttn", "waybill", "contract"],
  })

  assert.equal(documents.length, 5)
  assert.deepEqual(
    documents.map((doc) => doc.kind),
    ["ttn", "ttn", "waybill", "contract", "contract"],
  )

  // номера внутри рейса различаются по порядку точки
  const numbers = documents.filter((doc) => doc.kind === "ttn").map((doc) => doc.number)
  assert.equal(numbers[0].endsWith("/1"), true)
  assert.equal(numbers[1].endsWith("/2"), true)
})

test("в рейсе без заказов печатается только путевой лист", () => {
  const documents = buildRouteDocuments({
    route: route({ orders: [] }),
    carrier: CARRIER,
    kinds: ["ttn", "waybill", "contract"],
  })

  assert.deepEqual(
    documents.map((doc) => doc.kind),
    ["waybill"],
  )
})

test("транспортная накладная: реквизиты перевозчика, груз и подписи", () => {
  const ttn = buildTtn(route(), order(), CARRIER, 0)

  const carrier = ttn.blocks.find((block) => block.title === "Перевозчик")
  const carrierFields = Object.fromEntries(carrier.fields.map((f) => [f.label, f.value]))
  assert.equal(carrierFields["Наименование"], "ИП Фролов Иван Александрович")
  assert.equal(carrierFields["ИНН"], "760100000000")
  assert.equal(carrierFields["КПП"], null)
  assert.equal(carrierFields["Адрес"], "150000, г. Ярославль, ул. Промышленная, д. 5")

  const consignor = ttn.blocks.find((block) => block.title === "Грузоотправитель")
  assert.equal(consignor.fields[0].value, "ООО Ромашка")

  // данных грузополучателя в заказе нет — поле остаётся пустым, а не выдумывается
  const consignee = ttn.blocks.find((block) => block.title === "Грузополучатель")
  assert.equal(consignee.fields[0].value, null)
  assert.equal(consignee.fields[1].value, "Москва")

  const cargo = ttn.tables[0]
  assert.equal(cargo.rows.length, 1)
  assert.equal(cargo.rows[0][2], "Бытовая техника")
  assert.equal(cargo.rows[0][3], "12 000 кг (12,0 т)")
  assert.equal(cargo.rows[0][5], "45 000 ₽")

  assert.equal(ttn.signatures.length, 4)
  assert.match(ttn.signatures[2], /водитель/i)
})

test("путевой лист: один на рейс, задание по точкам и время работы", () => {
  const waybill = buildWaybill(
    route({ orders: [order(), order({ id: "order-2", routeFrom: "Москва", routeTo: "Тверь", weightKg: 5000 })] }),
    CARRIER,
  )

  assert.equal(waybill.kind, "waybill")
  assert.equal(waybill.tables[0].rows.length, 2)
  assert.equal(waybill.tables[0].rows[1][1], "Москва")

  const crew = waybill.blocks.find((block) => block.title === "Транспорт и водитель")
  const crewFields = Object.fromEntries(crew.fields.map((f) => [f.label, f.value]))
  assert.equal(crewFields["Госномер"], "А001АА76")
  assert.equal(crewFields["Марка, модель"], "Volvo FH")
  assert.equal(crewFields["Водитель"], "Сидоров Пётр")

  const time = waybill.blocks.find((block) => block.title === "Время работы")
  assert.equal(time.fields[0].value, "24.09.2026 06:30")
  assert.equal(time.fields[1].value, null)

  const totals = waybill.blocks.find((block) => block.title.startsWith("Итоги рейса"))
  const totalsFields = Object.fromEntries(totals.fields.map((f) => [f.label, f.value]))
  assert.equal(totalsFields["Пробег, км"], "270")
  assert.equal(totalsFields["Груз, всего"], "17 000 кг (17,0 т)")
  assert.equal(totalsFields["Расход топлива"], "7 000 ₽")
})

test("договор-заявка: маршрут, стоимость и порядок оплаты", () => {
  const contract = buildContract(route(), order(), CARRIER, 0)

  const subject = contract.blocks.find((block) => block.title === "Предмет заявки")
  const fields = Object.fromEntries(subject.fields.map((f) => [f.label, f.value]))
  assert.equal(fields["Маршрут"], "Ярославль — Москва")
  assert.equal(fields["Дата погрузки"], "30 сентября 2026 г.")
  assert.equal(fields["Стоимость перевозки"], "45 000 ₽")
  assert.equal(fields["Порядок оплаты"], "безналичный расчёт, НДС 20%, отсрочка 5 дн.")

  assert.equal(contract.signatures[0].startsWith("Заказчик"), true)
  assert.equal(contract.signatures[1].includes("Фролов И. А."), true)
})

test("без цены заявка говорит «по договорённости», а не ноль", () => {
  const contract = buildContract(route(), order({ priceRub: null, agreedPriceRub: null }), CARRIER, 0)
  const subject = contract.blocks.find((block) => block.title === "Предмет заявки")
  const price = subject.fields.find((field) => field.label === "Стоимость перевозки")
  assert.equal(price.value, "по договорённости")
})

test("номер документа привязан к дате создания рейса", () => {
  const document = route()
  assert.equal(routeDocumentNumber(document, 0), "Р-2026-09-24-1")
  assert.equal(routeDocumentNumber(document, 0, 1), "Р-2026-09-24-1/2")
})

test("незаполненные реквизиты не превращаются в чужие данные", () => {
  const empty = {
    ...CARRIER,
    legalName: null,
    inn: null,
    legalAddress: null,
    signerName: null,
  }
  const ttn = buildTtn(route(), order(), empty, 0)
  const carrier = ttn.blocks.find((block) => block.title === "Перевозчик")
  const fields = Object.fromEntries(carrier.fields.map((f) => [f.label, f.value]))

  // наименование падает на название организации, остальное — пусто
  assert.equal(fields["Наименование"], "ИП Фролов Иван Александрович")
  assert.equal(fields["ИНН"], null)
  assert.equal(fields["Адрес"], null)
  assert.equal(ttn.signatures[3].includes("Фролов"), false)
})
