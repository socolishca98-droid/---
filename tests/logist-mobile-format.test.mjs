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
const {
  shortCity,
  cityOfAddress,
  shortRef,
  formatMoney,
  formatWeightKg,
  formatKm,
  plural,
  formatCount,
  paymentState,
  mapsHref,
  routeMapsHref,
  orderHeaderSubtitle,
  clientContactLine,
} = require("../.test-build/lib/logist-mobile/format.js")

test("город выбирается из адреса, а не номер дома", () => {
  assert.equal(shortCity("Московская область, Домодедово, улица Логистическая, 12"), "Домодедово")
  assert.equal(shortCity("Тула, улица Рязанская, 38"), "Тула")
  assert.equal(shortCity("Москва, улица Складочная, 8"), "Москва")
  assert.equal(shortCity("г. Калуга, улица Московская, 289"), "Калуга")
  assert.equal(shortCity("г.Гомель"), "Гомель", "«г.» с точкой — сокращение, а не первая буква")
  assert.equal(shortCity("Грушевская ст-ца, Краснодарский край"), "Грушевская ст-ца")
  assert.equal(shortCity("город Тула"), "Тула")
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

test("адрес превращается в ссылку на навигатор, а не в поиск по пустой строке", () => {
  assert.equal(
    mapsHref("Москва, улица Складочная, 8"),
    "https://yandex.ru/maps/?text=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0%2C%20%D1%83%D0%BB%D0%B8%D1%86%D0%B0%20%D0%A1%D0%BA%D0%BB%D0%B0%D0%B4%D0%BE%D1%87%D0%BD%D0%B0%D1%8F%2C%208",
  )
  assert.equal(mapsHref("  "), null)
  assert.equal(mapsHref(null), null)
  assert.equal(mapsHref(undefined), null)

  // Маршрут из двух адресов — одна ссылка; без одной из точек её просто нет
  const route = routeMapsHref("Москва", "Калуга")
  assert.ok(route && route.startsWith("https://yandex.ru/maps/?rtext="))
  assert.ok(route.includes("~"))
  assert.ok(route.includes("rtt=auto"))
  assert.equal(routeMapsHref("Москва", null), null)
  assert.equal(routeMapsHref(null, "Калуга"), null)
})

// ── Город из адреса базы ─────────────────────────────────────────────────
//
// Настройки автопарка хранят адрес стоянки так, как его ввёл человек:
// «Ярославль. Ул. Докучалова 12». Запятых в такой строке нет, shortCity
// возвращает её целиком — и ключ города «ярославль ул докучалова 12» не
// совпадает ни с одним грузом «Ярославль, Ярославская область». Живой
// прогон на превью: помощник с такой базой показывал 92 груза из Ярославля,
// а кнопка «Построить маршрут» отвечала «грузов на бирже сейчас нет».
test("cityOfAddress выделяет город из адреса, записанного через точки", () => {
  assert.equal(cityOfAddress("Ярославль. Ул. Докучалова 12"), "Ярославль")
  assert.equal(cityOfAddress("Дзержинск. Пр-т Чкалова 1"), "Дзержинск")
  assert.equal(cityOfAddress("г. Тулун, ул. Ленина 5"), "Тулун")
  assert.equal(cityOfAddress("Нижний Новгород, ул. Большая Покровская 1"), "Нижний Новгород")
  assert.equal(cityOfAddress("Москва"), "Москва")
  assert.equal(cityOfAddress(""), "")
  assert.equal(cityOfAddress(null), "")
})

// ── Шапка и карточка заказа: без двойного «не указан» ──────────────────────
test("в шапке заказа имя клиента не повторяет «клиент не указан»", () => {
  assert.equal(orderHeaderSubtitle("ООО «Ромашка»", "4f2a"), "ООО «Ромашка» · № 4f2a")
  // Пустое имя в шапку не выносим — ниже есть карточка клиента о том же
  assert.equal(orderHeaderSubtitle(null, "4f2a"), "№ 4f2a")
  assert.equal(orderHeaderSubtitle("   ", "4f2a"), "№ 4f2a")
  assert.equal(orderHeaderSubtitle(undefined, "4f2a"), "№ 4f2a")
})

test("вторая строка карточки клиента говорит разное в трёх состояниях", () => {
  assert.equal(clientContactLine("ООО «Ромашка»", "+7 999 123-45-67"), "+7 999 123-45-67")
  assert.equal(clientContactLine("ООО «Ромашка»", "  "), "Контакт не указан")
  // Нет ни клиента, ни контакта — подсказка, что делать, а не второе «не указан»
  assert.equal(clientContactLine(null, null), "Добавьте имя и телефон — иначе звонить некому")
  assert.equal(clientContactLine("", ""), "Добавьте имя и телефон — иначе звонить некому")
})
