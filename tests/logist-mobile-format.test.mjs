/**
 * Тесты форматтеров мобильной панели логиста (lib/logist-mobile/format.ts).
 *
 * Здесь закреплён разобранный баг: «Домодедово» отбраковывалось проверкой
 * улицы (подстрока «дом»), и городом оставался номер дома «12».
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { shortCity, shortRef, formatMoney, formatWeightKg, formatKm, plural, formatCount, paymentState } =
  require("../.test-build/lib/logist-mobile/format.js")

test("город выбирается из адреса, а не номер дома", () => {
  assert.equal(shortCity("Московская область, Домодедово, улица Логистическая, 12"), "Домодедово")
  assert.equal(shortCity("Тула, улица Рязанская, 38"), "Тула")
  assert.equal(shortCity("Москва, улица Складочная, 8"), "Москва")
  assert.equal(shortCity("г. Калуга, улица Московская, 289"), "Калуга")
  assert.equal(shortCity("Санкт-Петербург, Шушары, Московское шоссе, 5"), "Санкт-Петербург")
  assert.equal(shortCity("Казань"), "Казань")
  assert.equal(shortCity(null), "—")
  assert.equal(shortCity("  "), "—")
})

test("короткая ссылка на запись без служебного префикса", () => {
  assert.equal(shortRef("demo-order-7"), "order-7")
  assert.equal(shortRef("demo-route-4"), "route-4")
  assert.equal(shortRef("cmuy9rcnw0001jz1nm4z9hhpw"), "jz1nm4z9hhpw".slice(-8))
  assert.equal(shortRef(null), "—")
})

test("деньги, вес и расстояние читаются человеком", () => {
  // ru-RU разделяет разряды неразрывным пробелом — это и есть ожидаемое поведение
  assert.equal(formatMoney(46000), "46\u00A0000 ₽")
  assert.equal(formatMoney(0), "0 ₽")
  assert.equal(formatMoney(null), "—")
  assert.equal(formatWeightKg(13800), "13,8 т")
  assert.equal(formatWeightKg(500), "500 кг")
  assert.equal(formatKm(210.4), "210 км")
})

test("склонение слов не ломается на исключениях", () => {
  assert.equal(formatCount(1, ["рейс", "рейса", "рейсов"]), "1 рейс")
  assert.equal(formatCount(2, ["рейс", "рейса", "рейсов"]), "2 рейса")
  assert.equal(formatCount(5, ["рейс", "рейса", "рейсов"]), "5 рейсов")
  assert.equal(formatCount(11, ["рейс", "рейса", "рейсов"]), "11 рейсов")
  assert.equal(formatCount(21, ["рейс", "рейса", "рейсов"]), "21 рейс")
  assert.equal(plural(112, ["рейс", "рейса", "рейсов"]), "рейсов")
})

test("состояние оплаты: просрочка важнее отсрочки, оплата важнее всего", () => {
  assert.equal(paymentState({ isPaid: true }).tone, "ok")
  assert.equal(paymentState({ isPaid: false, isOverdue: true, overdueDays: 3 }).label, "Просрочен на 3 дня")
  assert.equal(paymentState({ isPaid: false, isOverdue: false, dueDate: "2026-10-17T00:00:00.000Z" }).tone, "wait")
  assert.equal(paymentState({}).tone, "wait")
})
