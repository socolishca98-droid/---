/**
 * Тесты нормализации городов (lib/logist-mobile/city-norm.ts).
 *
 * Биржа пишет один город по-разному; помощник должен узнавать его.
 * Проверяем:
 *  1) тип населённого пункта снимается: «с.», «д.», «г.», «ст-ца»;
 *  2) уточнения в скобках убираются;
 *  3) «Кировская ст-ца» не превращается в «киров» — это разные города;
 *  4) регистр и ё не мешают;
 *  5) пустые значения не равны ничему.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  normalizeCityKey,
  sameCity,
  cityDistrictKey,
  samePlace,
  canonicalCityName,
} = require("../.test-build/lib/logist-mobile/city-norm.js")

test("тип населённого пункта снимается", () => {
  assert.equal(normalizeCityKey("Ворсино с. (Боровский р-н), Калужская область, Калужская область"), "ворсино")
  assert.equal(normalizeCityKey("Денисово д. (Боровский р-н), Калужская область"), "денисово")
  assert.equal(normalizeCityKey("Ступино г. (г.о. Ступино), Московская область"), "ступино")
  assert.equal(normalizeCityKey("Вязники г."), "язники".replace("я", "вя", 1)) // «Вязники» — тип не в начале
  assert.equal(normalizeCityKey("Меленки г."), "меленки")
})

test("одно пишется по-разному — ключ одинаковый", () => {
  assert.equal(
    normalizeCityKey("Ступино г. (г.о. Ступино), Московская область"),
    normalizeCityKey("Ступино, Московская область"),
  )
  assert.equal(
    normalizeCityKey("Домодедово, Московская область, Московская область"),
    normalizeCityKey("Домодедово г., Московская область"),
  )
  assert.equal(sameCity("Ворсино с. (Боровский р-н)", "Ворсино"), true)
})

test("Кировская ст-ца не превращается в Киров", () => {
  assert.equal(normalizeCityKey("Кировская ст-ца, Ростовская область"), "кировская")
  assert.equal(sameCity("Кировская ст-ца", "Киров, Кировская область"), false)
})

test("регистр, ё и мусор не мешают", () => {
  assert.equal(normalizeCityKey("Екатеринбург"), "екатеринбург")
  assert.equal(normalizeCityKey("Чебоксары г., Чувашская Республика"), "чебоксары")
  assert.equal(sameCity("Москва", "москва"), true)
})

test("пустые значения", () => {
  assert.equal(normalizeCityKey(""), "")
  assert.equal(normalizeCityKey(null), "")
  assert.equal(sameCity("", "Москва"), false)
  assert.equal(sameCity(null, null), false)
})

// ── Городской округ: сёло округа — тот же город для машины ───────────────
// Живая биржа: база «Домодедово», а груз везёт в «Константиново с.
// (г.о. Домодедово)». По строке это разные города — помощник считал
// порожний возврат 36 км и приезд домой на сутки позже, чем на самом деле.
test("городской округ выделяется из скобок", () => {
  assert.equal(cityDistrictKey("Константиново с. (г.о. Домодедово), Московская область"), "домодедово")
  assert.equal(cityDistrictKey("Ступино г. (г.о. Ступино)"), "ступино")
  // Район — не округ: Ворсино и Денисово в одном районе, но ехать надо
  assert.equal(cityDistrictKey("Ворсино с. (Боровский р-н)"), "")
  // «(регион)» — не округ, иначе склеятся все города
  assert.equal(cityDistrictKey("Москва, Москва (регион)"), "")
  assert.equal(cityDistrictKey("Москва"), "")
})

test("село своего округа — это дом", () => {
  assert.equal(samePlace("Константиново с. (г.о. Домодедово)", "Домодедово"), true)
  assert.equal(samePlace("Домодедово", "Константиново с. (г.о. Домодедово)"), true)
  assert.equal(samePlace("Ступино г. (г.о. Ступино)", "Ступино"), true)
  assert.equal(samePlace("Москва", "Москва (регион)"), true)
})

test("разные города одного района — не дом", () => {
  assert.equal(samePlace("Ворсино с. (Боровский р-н)", "Денисово д. (Боровский р-н)"), false)
  assert.equal(samePlace("Ворсино с. (Боровский р-н)", "Боровск"), false)
  assert.equal(samePlace("Домодедово", "Москва"), false)
  assert.equal(samePlace("Домодедово", "Химки"), false)
})

test("пустые значения не становятся одним местом", () => {
  assert.equal(samePlace("", "Москва"), false)
  assert.equal(samePlace(null, null), false)
  assert.equal(samePlace("", ""), false)
})

// ── Переименованные города ────────────────────────────────────────────────
test("старое название города узнаётся как нынешнее", () => {
  // Живой замер: ATI отдаёт «Свердловск г., Свердловская область». Справочник
  // и геокодер такого города не знают — маршрут оставался одним плечом с
  // 1062 км порожнего возврата, карта не рисовалась, обратка не находилась.
  assert.equal(normalizeCityKey("Свердловск г., Свердловская область"), "екатеринбург")
  assert.equal(normalizeCityKey("Екатеринбург"), "екатеринбург")
  assert.equal(normalizeCityKey("Горький г."), "нижний новгород")
  assert.equal(normalizeCityKey("Куйбышев"), "самара")
  assert.equal(normalizeCityKey("Ленинград"), "санкт-петербург")
  assert.equal(canonicalCityName("Свердловск г."), "Екатеринбург")
  assert.equal(canonicalCityName("Ярославль"), "", "нынешнее название не переписываем")
})

test("переименованный город и его нынешнее имя — одно место", () => {
  const { samePlace, sameCity } = require("../.test-build/lib/logist-mobile/city-norm.js")
  assert.ok(sameCity("Свердловск г.", "Екатеринбург"), "это один город")
  assert.ok(samePlace("Свердловск г., Свердловская область", "Екатеринбург"))
  assert.ok(!sameCity("Свердловск г.", "Ярославль"))
})
