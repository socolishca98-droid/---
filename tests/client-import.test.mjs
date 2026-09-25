/**
 * Тесты импорта клиентской базы и статистики клиента (задача 5).
 *
 * Главное, что проверяется: импорт не требует одного «правильного» формата.
 * Разделитель, строка заголовков, порядок и названия колонок определяются по
 * самому файлу, значения приводятся к одному виду, дубли показываются человеку,
 * а не удаляются молча.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  IMPORT_FIELDS,
  buildImportPreview,
  detectDelimiter,
  detectHeaderRow,
  fieldForHeader,
  matchOrdersToClients,
  parseDelimited,
  planImport,
} = require("../.test-build/lib/clients/import.js")
const {
  clientNameKey,
  cleanClientName,
  normalizeDeferredDays,
  normalizeInn,
  normalizeKpp,
  normalizePaymentType,
  normalizePhone,
  normalizeVatType,
} = require("../.test-build/lib/clients/normalize.js")
const {
  buildClientStats,
  clientReliabilityLabel,
  orderAmount,
} = require("../.test-build/lib/clients/stats.js")

// ---------------------------------------------------------------------------
// Нормализация
// ---------------------------------------------------------------------------

test("названия сравниваются без правовой формы, кавычек и регистра", () => {
  const key = clientNameKey('ООО «Ромашка»')
  assert.equal(key, "ромашка")
  assert.equal(clientNameKey("ромашка"), key)
  assert.equal(clientNameKey("ООО  РОМАШКА "), key)
  assert.equal(clientNameKey("Ромашка ООО"), key)
  assert.equal(clientNameKey("ИП Иванов И.И."), "иванов и и")
  // разные клиенты не должны склеиваться
  assert.notEqual(clientNameKey("ООО Ромашка"), clientNameKey("ООО Ромашка-Москва"))
  // от одного «ООО» ничего не остаётся — строку импорт пропустит
  assert.equal(clientNameKey("ООО"), "")
})

test("телефон, ИНН, КПП и отсрочка приводятся к одному виду", () => {
  assert.equal(normalizePhone("8 (900) 000-00-01"), "+79000000001")
  assert.equal(normalizePhone("+7 900 000 00 01"), "+79000000001")
  assert.equal(normalizePhone("9000000001"), "+79000000001")
  assert.equal(normalizePhone("нет"), null)

  assert.equal(normalizeInn("760100000000"), "760100000000")
  assert.equal(normalizeInn("760 100 000 000"), "760100000000")
  assert.equal(normalizeInn("б/н"), null)
  assert.equal(normalizeInn("12345"), null)

  assert.equal(normalizeKpp("760101001"), "760101001")
  assert.equal(normalizeKpp("7601010"), null)

  assert.equal(normalizeDeferredDays("отсрочка 14 дней"), 14)
  assert.equal(normalizeDeferredDays(14), 14)
  assert.equal(normalizeDeferredDays("нет"), null)
  assert.equal(normalizeDeferredDays("500"), null)

  assert.equal(normalizePaymentType("безнал"), "bank")
  assert.equal(normalizePaymentType("Наличными"), "cash")
  assert.equal(normalizePaymentType("по счёту с НДС"), "bank")
  assert.equal(normalizeVatType("без НДС"), "none")
  assert.equal(normalizeVatType("НДС 20%"), "vat20")
  assert.equal(normalizeVatType("НДС"), "included")

  assert.equal(cleanClientName("  ООО   Ромашка  "), "ООО Ромашка")
})

// ---------------------------------------------------------------------------
// Разбор файла
// ---------------------------------------------------------------------------

test("разбор CSV: кавычки, разделитель внутри кавычек, перевод строки в значении", () => {
  const rows = parseDelimited('a;"b;c";"d""e"\n"многострочный\nтекст";x;y', ";")
  assert.deepEqual(rows[0], ["a", "b;c", 'd"e'])
  assert.deepEqual(rows[1], ["многострочный\nтекст", "x", "y"])
})

test("разделитель определяется по файлу: Excel, табуляция, запятая", () => {
  assert.equal(detectDelimiter("Наименование;ИНН;Телефон\nООО Ромашка;760100000000;+79000000001"), ";")
  assert.equal(detectDelimiter("Наименование\tИНН\tТелефон\nООО Ромашка\t760100000000\t+79000000001"), "\t")
  assert.equal(
    detectDelimiter('name,inn,phone\n"ООО Ромашка, Москва",760100000000,+79000000001'),
    ",",
  )
  // BOM из Excel не мешает
  assert.equal(detectDelimiter("\uFEFFНаименование;ИНН\nООО Ромашка;760100000000"), ";")
})

test("заголовки распознаются по смыслу, а не по точному тексту", () => {
  assert.equal(fieldForHeader("Наименование").field, "name")
  assert.equal(fieldForHeader("Контрагент").field, "name")
  assert.equal(fieldForHeader("НАЗВАНИЕ КОМПАНИИ").field, "name")
  assert.equal(fieldForHeader("Контактное лицо").field, "contactName")
  assert.equal(fieldForHeader("Тел.").field, "phone")
  assert.equal(fieldForHeader("E-mail").field, "email")
  assert.equal(fieldForHeader("КПП").field, "kpp")
  assert.equal(fieldForHeader("Юр. адрес").field, "address")
  assert.equal(fieldForHeader("Отсрочка, дней").field, "deferredDays")
  assert.equal(fieldForHeader("Что-то своё").field, null)

  const combined = fieldForHeader("ИНН/КПП")
  assert.equal(combined.field, "inn")
  assert.equal(combined.combinedInnKpp, true)
})

test("строка заголовков находится, даже если над таблицей есть шапка файла", () => {
  const rows = parseDelimited(
    [
      "Клиентская база ООО Логистика",
      "выгружено 24.09.2026",
      "Наименование;ИНН;Телефон",
      "ООО Ромашка;760100000000;+79000000001",
    ].join("\n"),
    ";",
  )

  assert.equal(detectHeaderRow(rows), 2)
})

test("импорт раскладывает колонки в любом порядке и приводит значения", () => {
  const text = [
    "Что-то;Телефон;Наименование;ИНН/КПП;Отсрочка;Примечание",
    "x;8 900 000 00 01;ООО Ромашка;760100000000/760101001;14 дней;постоянный клиент",
    "y;+7 900 000 00 02;ИП Иванов;760100000012;без отсрочки;",
  ].join("\n")

  const preview = buildImportPreview({ text, existing: [] })

  assert.equal(preview.delimiter, ";")
  assert.equal(preview.rows.length, 2)

  const [first, second] = preview.rows
  assert.equal(first.fields.name, "ООО Ромашка")
  assert.equal(first.fields.phone, "+79000000001")
  assert.equal(first.fields.inn, "760100000000")
  assert.equal(first.fields.kpp, "760101001")
  assert.equal(first.fields.deferredDays, 14)
  assert.equal(first.fields.notes, "постоянный клиент")
  assert.equal(first.issues.length, 0)

  assert.equal(second.fields.inn, "760100000012")
  assert.equal(second.fields.kpp, undefined)

  // колонку «Что-то» показали человеку, но не выдумали для неё поле
  assert.deepEqual(preview.summary.unmappedHeaders, ["Что-то"])
  assert.equal(preview.summary.missingFields.includes("email"), true)
  assert.equal(preview.summary.create, 2)
})

test("дубли с существующими клиентами помечаются, а не теряются", () => {
  const text = ["Наименование;Телефон", 'ООО "Ромашка";+79000000001', "ООО Тюльпан;+79000000002"].join("\n")

  const preview = buildImportPreview({
    text,
    existing: [{ id: "client-1", name: "ООО Ромашка" }],
  })

  assert.equal(preview.summary.total, 2)
  assert.equal(preview.summary.create, 1)
  assert.equal(preview.summary.update, 1)
  assert.equal(preview.rows[0].existingClientId, "client-1")
  assert.equal(preview.rows[0].issues.includes("duplicate_existing"), true)
  assert.equal(preview.rows[1].existingClientId, null)
})

test("строка без названия и повтор внутри файла пропускаются с пометкой", () => {
  const text = [
    "Наименование;Телефон",
    ";+79000000001",
    "ООО Ромашка;+79000000002",
    "ромашка;+79000000003",
  ].join("\n")

  const preview = buildImportPreview({ text, existing: [] })

  assert.equal(preview.summary.noName, 1)
  assert.equal(preview.summary.duplicateInFile, 1)
  assert.equal(preview.summary.create, 1)
  assert.equal(preview.rows[0].issues.includes("no_name"), true)
  assert.equal(preview.rows[2].issues.includes("duplicate_in_file"), true)
})

test("мусорный ИНН не попадает в карточку, но строка не теряется", () => {
  const text = ["Наименование;ИНН", "ООО Ромашка;б/н"].join("\n")
  const preview = buildImportPreview({ text, existing: [] })

  assert.equal(preview.rows[0].fields.inn, undefined)
  assert.equal(preview.rows[0].issues.includes("invalid_inn"), true)
  assert.equal(preview.summary.invalidInn, 1)
  // название на месте — карточку создать всё равно можно
  assert.equal(preview.summary.create, 1)
})

test("человек может поправить сопоставление колонок вручную", () => {
  const text = ["Столбец 1;Столбец 2", "ООО Ромашка;+79000000001"].join("\n")

  const auto = buildImportPreview({ text, existing: [] })
  assert.equal(auto.rows[0].fields.name, undefined)
  assert.equal(auto.summary.noName, 1)

  const manual = buildImportPreview({
    text,
    existing: [],
    mapping: { name: 0, phone: 1 },
  })
  assert.equal(manual.rows[0].fields.name, "ООО Ромашка")
  assert.equal(manual.rows[0].fields.phone, "+79000000001")
  assert.equal(manual.summary.create, 1)
})

// ---------------------------------------------------------------------------
// План импорта
// ---------------------------------------------------------------------------

test("в режиме «только новые» существующие клиенты пропускаются", () => {
  const text = ["Наименование;Телефон", "ООО Ромашка;+79000000001", "ООО Тюльпан;+79000000002"].join("\n")
  const preview = buildImportPreview({ text, existing: [{ id: "client-1", name: "ООО Ромашка" }] })

  const plan = planImport(preview, "add")
  assert.deepEqual(plan.summary, { create: 1, update: 0, skip: 1 })
  assert.equal(plan.rows[0].action, "skip")
})

test("в режиме «обновлять» заполняются только пустые поля существующего клиента", () => {
  const text = [
    "Наименование;Телефон;Контактное лицо",
    "ООО Ромашка;+79000000001;Пётр",
  ].join("\n")
  const preview = buildImportPreview({ text, existing: [{ id: "client-1", name: "ООО Ромашка" }] })

  // у клиента уже есть телефон — его не перетираем, добавим только контакт
  const plan = planImport(preview, "merge", {
    "client-1": { phone: "+79000009999", contactName: null },
  })

  assert.equal(plan.rows[0].action, "update")
  assert.deepEqual(plan.rows[0].changedFields, ["contactName"])
  assert.equal(plan.summary.update, 1)
})

test("если заполнять нечего — строка не считается обновлением", () => {
  const text = ["Наименование;Телефон", "ООО Ромашка;+79000000001"].join("\n")
  const preview = buildImportPreview({ text, existing: [{ id: "client-1", name: "ООО Ромашка" }] })

  const plan = planImport(preview, "merge", { "client-1": { phone: "+79000000001" } })
  assert.equal(plan.rows[0].action, "skip")
  assert.equal(plan.summary.skip, 1)
})

test("после импорта заказы привязываются к клиентам по имени", () => {
  const links = matchOrdersToClients(
    [
      { id: "order-1", clientName: "ООО Ромашка" },
      { id: "order-2", clientName: 'ООО "Ромашка"' },
      { id: "order-3", clientName: "Неизвестный клиент" },
      { id: "order-4", clientName: null },
    ],
    [{ id: "client-1", name: "Ромашка" }],
  )

  assert.deepEqual(links, [
    { orderId: "order-1", clientId: "client-1" },
    { orderId: "order-2", clientId: "client-1" },
  ])
})

// ---------------------------------------------------------------------------
// Статистика клиента
// ---------------------------------------------------------------------------

const order = (status, extra = {}) => ({
  id: `order-${Math.random()}`,
  status,
  price: 10000,
  agreedPrice: null,
  isPaid: false,
  paidAt: null,
  dueDate: null,
  createdAt: new Date("2026-09-01T00:00:00"),
  ...extra,
})

test("сумма заказа: согласованная цена важнее прайса", () => {
  assert.equal(orderAmount(order("agreed", { agreedPrice: 12000 })), 12000)
  assert.equal(orderAmount(order("agreed")), 10000)
  assert.equal(orderAmount(order("agreed", { price: null })), 0)
})

test("статистика: заказы, деньги, просрочка, надёжность", () => {
  const now = new Date("2026-09-24T00:00:00")
  const stats = buildClientStats(
    [
      order("delivered", { isPaid: true, paidAt: new Date("2026-09-10T00:00:00") }),
      order("delivered", { isPaid: false, dueDate: new Date("2026-09-20T00:00:00") }),
      order("cancelled"),
      order("control"),
    ],
    now,
  )

  assert.equal(stats.total, 4)
  assert.equal(stats.delivered, 2)
  assert.equal(stats.cancelled, 1)
  assert.equal(stats.active, 1)
  // отменённый заказ в выручку не идёт
  assert.equal(stats.revenueRub, 30000)
  assert.equal(stats.paidRub, 10000)
  assert.equal(stats.unpaidRub, 20000)
  assert.equal(stats.overdueRub, 10000)
  assert.equal(stats.overdueCount, 1)
  assert.equal(stats.avgPaymentDays, 9)
  assert.equal(stats.reliabilityPercent, 67)
  assert.equal(clientReliabilityLabel(stats), "часто отказывается")
})

test("без закрытых заказов надёжность не выдумывается", () => {
  const stats = buildClientStats([order("search"), order("negotiation")])
  assert.equal(stats.reliabilityPercent, null)
  assert.equal(clientReliabilityLabel(stats), "нет закрытых заказов")
})

test("оплата в срок без просрочки не даёт долга", () => {
  const now = new Date("2026-09-24T00:00:00")
  const stats = buildClientStats(
    [order("delivered", { isPaid: false, dueDate: new Date("2026-10-01T00:00:00") })],
    now,
  )

  assert.equal(stats.unpaidRub, 10000)
  assert.equal(stats.overdueRub, 0)
  assert.equal(stats.overdueCount, 0)
})
