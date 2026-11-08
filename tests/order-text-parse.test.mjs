// tests/order-text-parse.test.mjs
//
// Разбор текста заявки («Заказ из текста»): вес и дедлайн.
//
// Два дефекта, из-за которых этот тест появился:
//   Д1 — «18 т» и «18т» не разбирались: JS \b после кириллической «т» не
//        работает (граница слов опирается на [A-Za-z0-9_]), а «18 тонн» и
//        «18 т.» работали. Логист получал «Вес и объём не найдены» на самом
//        обычном написании.
//   Д2 — телефон «555-34-12» превращался в дедлайн «2012-34-55»: шаблон даты
//        не проверял диапазоны, и мусорная дата уходила в расписание рейса.

import assert from "node:assert/strict"
import test from "node:test"

import { parseOrderText } from "../.test-build/lib/orders/parse-request-text.js"

test("вес: «18 т» разбирается (Д1)", () => {
  const { fields } = parseOrderText("перевезти 18 т металлопроката из Ярославля в Москву")
  assert.equal(fields.weight, "18000")
})

test("вес: «18т» слитно разбирается (Д1)", () => {
  const { fields } = parseOrderText("нужно 18т песка")
  assert.equal(fields.weight, "18000")
})

test("вес: прежние написания не сломались", () => {
  assert.equal(parseOrderText("перевезти 18 тонн металлопроката").fields.weight, "18000")
  assert.equal(parseOrderText("масса 18 т. нетто").fields.weight, "18000")
  assert.equal(parseOrderText("везём 1,5 тонны труб").fields.weight, "1500")
  assert.equal(parseOrderText("груз 25 000 кг").fields.weight, "25000")
})

test("вес: тонна не выхватывается из середины слова", () => {
  // «транспорта» не должно разобраться как тонны
  const { fields } = parseOrderText("нужно 5 транспорта")
  assert.equal(fields.weight, "")
})

test("дедлайн: телефон «555-34-12» не становится датой (Д2)", () => {
  const { fields } = parseOrderText("перевезти 18 т груза, телефон 555-34-12")
  assert.equal(fields.deadline, "")
})

test("дедлайн: дата вне диапазонов отбрасывается (Д2)", () => {
  assert.equal(parseOrderText("срок 34.56.2026").fields.deadline, "")
  assert.equal(parseOrderText("срок 00.13.2026").fields.deadline, "")
})

test("дедлайн: валидные даты разбираются как раньше", () => {
  const year = String(new Date().getFullYear())
  assert.equal(parseOrderText("нужно до 07.11.2026").fields.deadline, "2026-11-07")
  assert.equal(parseOrderText("срок 12/09/26").fields.deadline, "2026-09-12")
  assert.equal(parseOrderText("до 5 числа, телефон 555-34-12, встреча 03.12.2026").fields.deadline, "2026-12-03")
  assert.equal(parseOrderText("срочно до 07.11.2026 18:00").fields.deadline, "2026-11-07T18:00")
  assert.equal(parseOrderText("срок 07.11").fields.deadline, `${year}-11-07`)
})

test("разбор полного примера: поля на месте", () => {
  const text = `Звонили из «Север-Строй», срочно нужно перевезти
12 тонн пиломатериалов из Ярославля в Москву до пятницы.
Машина нужна тент. Обещают 60 тысяч, контакт Сергей +7 910 123-45-67`
  const { fields, warnings } = parseOrderText(text)
  assert.equal(fields.routeFrom, "Ярославля")
  assert.equal(fields.routeTo, "Москву")
  assert.equal(fields.weight, "12000")
  assert.equal(fields.price, "60000")
  assert.equal(fields.clientContact, "+79101234567")
  assert.ok(fields.deadline.length > 0, "«до пятницы» даёт дату")
  assert.ok(!warnings.some((w) => w.includes("Вес")), "вес найден — предупреждения о весе нет")
})
