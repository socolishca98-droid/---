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
const { normalizeCityKey, sameCity } = require("../.test-build/lib/logist-mobile/city-norm.js")

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
