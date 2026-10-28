/**
 * Тесты справочника цен дизеля по регионам (lib/fleet/fuel-price.ts).
 *
 * Зачем: в расчёте маршрута цена литра была зашита числом 62 ₽, хотя розница
 * на конец 2026 года — 81–97 ₽ по округам. При 62 ₽ прибыль плеча 373 км на
 * пятитонке выходила +14 854 ₽, при реальном ЦФО (81 ₽) — примерно на 3 900 ₽
 * меньше. Логист видел завышенную прибыль и брал рейс, который окупается хуже.
 *
 * Проверяем: регион правильно относится к округу, цена не выдумана (совпадает
 * с таблицей), неизвестный регион не даёт ноль, подпись называет источник.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  districtForRegion,
  fuelPriceForRegion,
  fuelPriceNote,
  FUEL_PRICE_BY_DISTRICT,
  FUEL_PRICE_RUSSIA,
  FUEL_PRICE_DATE,
} = require("../.test-build/lib/fleet/fuel-price.js")

test("регион относится к своему федеральному округу", () => {
  assert.equal(districtForRegion("Ярославская область"), "ЦФО")
  assert.equal(districtForRegion("Москва"), "ЦФО")
  assert.equal(districtForRegion("Московская область"), "ЦФО")
  assert.equal(districtForRegion("Нижегородская область"), "ПФО")
  assert.equal(districtForRegion("Республика Татарстан"), "ПФО")
  assert.equal(districtForRegion("Краснодарский край"), "ЮФО")
  assert.equal(districtForRegion("Свердловская область"), "УФО")
  assert.equal(districtForRegion("Новосибирская область"), "СФО")
  assert.equal(districtForRegion("Приморский край"), "ДФО")
  assert.equal(districtForRegion("Санкт-Петербург"), "СЗФО")
})

test("похожие названия не путаются: Нижний Новгород — не Новгород", () => {
  // «нижегородская» не должна попасть в СЗФО из-за «новгородск»
  assert.equal(districtForRegion("Нижегородская область"), "ПФО")
  assert.equal(districtForRegion("Новгородская область"), "СЗФО")
  // «Курская» и «Курганская» — разные округа
  assert.equal(districtForRegion("Курская область"), "ЦФО")
  assert.equal(districtForRegion("Курганская область"), "УФО")
  // «Алтай» — и республика, и край, оба в Сибири
  assert.equal(districtForRegion("Республика Алтай"), "СФО")
  assert.equal(districtForRegion("Алтайский край"), "СФО")
})

test("неизвестный регион не даёт ноль и не выдумывает округ", () => {
  for (const name of [null, undefined, "", "   ", "Несуществующая губерния"]) {
    assert.equal(districtForRegion(name), null)
    assert.equal(fuelPriceForRegion(name), FUEL_PRICE_RUSSIA, "берём среднюю по России")
  }
  assert.ok(fuelPriceForRegion("Атлантида") > 50, "цена остаётся осмысленной")
})

test("цена берётся из таблицы Росстата, а не «примерно»", () => {
  const yaroslavl = fuelPriceForRegion("Ярославская область")
  assert.equal(yaroslavl, FUEL_PRICE_BY_DISTRICT["ЦФО"])
  // Дальний Восток дороже Центра — это и есть смысл региональных цен
  assert.ok(fuelPriceForRegion("Приморский край") > yaroslavl + 10)
  // Старая константа 62 ₽ была ниже любой реальной цены — так и завышалась прибыль
  for (const price of Object.values(FUEL_PRICE_BY_DISTRICT)) {
    assert.ok(price > 70, `цена ${price} ₽ должна быть выше зашитых ранее 62 ₽`)
  }
})

test("подпись называет цену, округ и дату среза", () => {
  const note = fuelPriceNote("Ярославская область")
  assert.match(note, /81 ₽\/л/, "цена округа")
  assert.match(note, /ЦФО/, "округ")
  assert.match(note, new RegExp(FUEL_PRICE_DATE), "дата среза Росстата")
  const unknown = fuelPriceNote(null)
  assert.match(unknown, /средняя по России/)
  assert.match(unknown, /Росстат/)
})
