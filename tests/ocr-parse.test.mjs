// tests/ocr-parse.test.mjs
//
// Разбор распознанного текста (задача 7): чек АЗС → сумма, литры, цена литра,
// одометр; накладная → номер, дата, груз, вес, пункты, машина, водитель.
//
// Тексты в тестах — то, что реально отдаёт OCR: строки рвутся, числа идут
// с пробелами и запятыми, подписи «ИТОГО» и «Масса брутто» стоят как попало.

import assert from "node:assert/strict"
import test from "node:test"

import {
  detectDocumentKind,
  parseAmount,
  parseDate,
  parseDocument,
  parseLiters,
  parseOdometer,
  parseReceipt,
  parseTime,
  parseWaybill,
  parseWeightKg,
} from "../.test-build/lib/ocr/parse.js"

const RECEIPT = `ООО "ЛУКОЙЛ-ЦЕНТРНЕФТЕПРОДУКТ"
АЗС № 214
Кассовый чек
Смена 42
07.09.2026 14:32
АИ-95
Цена 62,50
25,60 л
Одометр 123 456
ИТОГО 1600,00
К оплате 1 600,00
ИНН 7708004767`

const WAYBILL = `ТРАНСПОРТНАЯ НАКЛАДНАЯ № 4512 от 12.09.2026
Грузоотправитель: ООО Ромашка, г. Москва
Грузополучатель: ООО Тюльпан, г. Казань
Пункт погрузки: Москва
Пункт разгрузки: Казань
Наименование груза: Бытовая техника
Масса брутто 18 500 кг
Автомобиль: А123ВС 77
Водитель: Петров Иван Сергеевич`

test("суммы: «1 234,56», «1234.56», «1,234.56» и мусор", () => {
  assert.equal(parseAmount("1 234,56"), 1234.56)
  assert.equal(parseAmount("1234.56"), 1234.56)
  assert.equal(parseAmount("1,234.56"), 1234.56)
  assert.equal(parseAmount("1 600"), 1600)
  assert.equal(parseAmount("25,6"), 25.6)
  assert.equal(parseAmount("нет цифр"), null)
  assert.equal(parseAmount(null), null)
})

test("даты и время: точки, слэши, ISO и словами", () => {
  assert.equal(parseDate("07.09.2026"), "2026-09-07")
  assert.equal(parseDate("07/09/26"), "2026-09-07")
  assert.equal(parseDate("2026-09-07"), "2026-09-07")
  assert.equal(parseDate("7 сентября 2026"), "2026-09-07")
  assert.equal(parseDate("просто текст"), null)
  // невалидные числа не превращаются в дату
  assert.equal(parseDate("99.99.2026"), null)

  assert.equal(parseTime("14:32"), "14:32")
  assert.equal(parseTime("7.05"), "07:05")
  assert.equal(parseTime("99:99"), null)
})

test("вид документа определяется по подписям", () => {
  assert.equal(detectDocumentKind(RECEIPT), "receipt")
  assert.equal(detectDocumentKind(WAYBILL), "waybill")
  assert.equal(detectDocumentKind("просто фото кузова"), "unknown")
  assert.equal(detectDocumentKind(""), "unknown")
})

test("литры и одометр из чека АЗС", () => {
  assert.equal(parseLiters("25,60 л"), 25.6)
  assert.equal(parseLiters("ДТ 40.5 ЛИТР"), 40.5)
  // расход «20 л/100 км» — это не количество топлива в чеке
  assert.equal(parseLiters("расход 20 л/100 км"), null)
  assert.equal(parseLiters("бак 600 литров"), 600)

  assert.equal(parseOdometer("Одометр 123 456"), 123456)
  assert.equal(parseOdometer("пробег: 98 765 км"), 98765)
  assert.equal(parseOdometer("без показаний"), null)
})

test("вес груза: килограммы и тонны", () => {
  assert.equal(parseWeightKg("Масса брутто 18 500 кг"), 18500)
  assert.equal(parseWeightKg("вес 25 т"), 25000)
  assert.equal(parseWeightKg("нет веса"), null)
})

test("чек АЗС разбирается целиком: итог, литры, цена литра, топливо, одометр, поставщик", () => {
  const parsed = parseReceipt(RECEIPT)

  assert.equal(parsed.kind, "receipt")
  assert.equal(parsed.total, 1600)
  assert.equal(parsed.liters, 25.6)
  assert.equal(parsed.pricePerLiter, 62.5)
  assert.equal(parsed.fuelType, "АИ-95")
  assert.equal(parsed.odometer, 123456)
  assert.equal(parsed.date, "2026-09-07")
  assert.equal(parsed.time, "14:32")
  assert.match(parsed.vendor, /ЛУКОЙЛ/)
  assert.deepEqual(parsed.warnings, [])
})

test("цена литра считается из суммы и литров, если её нет в чеке", () => {
  const parsed = parseReceipt(`АЗС
ДТ 40 л
ИТОГО 2 800,00`)

  assert.equal(parsed.total, 2800)
  assert.equal(parsed.liters, 40)
  assert.equal(parsed.pricePerLiter, 70)
})

test("чек без итога: сумма не выдумывается, а честно помечается предупреждением", () => {
  const parsed = parseReceipt(`АЗС №5
АИ-92
Цена 55,00
20 л`)

  assert.equal(parsed.total, null)
  assert.ok(parsed.warnings.some((warning) => warning.includes("итоговую сумму")))
  assert.equal(parsed.liters, 20)
})

test("номера телефонов и ИНН не принимаются за сумму чека", () => {
  const parsed = parseReceipt(`ООО Ромашка
Телефон 8 900 000-00-01
ИНН 760100000000
К оплате 980,40`)

  assert.equal(parsed.total, 980)
})

test("накладная разбирается целиком: номер, дата, груз, вес, пункты, машина, водитель", () => {
  const parsed = parseWaybill(WAYBILL)

  assert.equal(parsed.kind, "waybill")
  assert.equal(parsed.number, "4512")
  assert.equal(parsed.date, "2026-09-12")
  assert.equal(parsed.cargo, "Бытовая техника")
  assert.equal(parsed.weightKg, 18500)
  assert.equal(parsed.from, "Москва")
  assert.equal(parsed.to, "Казань")
  assert.equal(parsed.vehiclePlate, "А123ВС 77")
  assert.equal(parsed.driverName, "Петров Иван Сергеевич")
  assert.deepEqual(parsed.warnings, [])
})

test("«Грузоотправитель» не превращается в груз «оотправитель»", () => {
  const parsed = parseWaybill(`ТОВАРНАЯ НАКЛАДНАЯ № 77
Грузоотправитель: ООО Ромашка
Грузополучатель: ООО Тюльпан`)

  assert.equal(parsed.cargo, null)
  assert.ok(parsed.warnings.some((warning) => warning.includes("Наименование") || warning.includes("вес")))
})

test("накладная без пунктов и веса: поля пустые, но честно с предупреждениями", () => {
  const parsed = parseWaybill("НАКЛАДНАЯ № 12 от 01.09.2026")

  assert.equal(parsed.number, "12")
  assert.equal(parsed.weightKg, null)
  assert.equal(parsed.from, null)
  assert.ok(parsed.warnings.some((warning) => warning.includes("вес")))
  assert.ok(parsed.warnings.some((warning) => warning.includes("погрузки")))
})

test("подсказка типа документа важнее автоопределения", () => {
  // в чеке встретилось слово «накладная» — разбираем как чек, раз так сказал водитель
  const text = "Кассовый чек\nТоварная накладная № 3\nИТОГО 500,00"
  const asWaybill = parseDocument(text)
  const asReceipt = parseDocument(text, "receipt")

  assert.equal(asWaybill.kind, "waybill")
  assert.equal(asReceipt.kind, "receipt")
  assert.equal(asReceipt.total, 500)
})

test("пустой текст распознавания не ломает разбор", () => {
  const parsed = parseReceipt("")

  assert.equal(parsed.total, null)
  assert.equal(parsed.liters, null)
  assert.ok(parsed.warnings.length > 0)
})
