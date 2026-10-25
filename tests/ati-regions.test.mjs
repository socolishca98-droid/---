// tests/ati-regions.test.mjs
//
// Город → регион ATI. Это ядро живого поиска по общей бирже.
//
// Выяснено проверками на бою: в фильтре биржи loads.ati.su id «откуда» — это
// id РЕГИОНА, а не города. from:{id:88} даёт 2 899 грузов со всей Ярославской
// области (поэтому радиус в фильтре и не влиял на объём), from:{id:86} —
// 4 094 груза Челябинской области. Идентификатор совпадает с RegionId
// официального словаря ATI (/v1.0/dictionaries/regions).
//
// Прежний список городов был выписан руками (28 городов), и его id — тоже
// id регионов. Из-за этого живой поиск не работал ни у одной организации,
// чья база вне списка: Вологда, Кострома и любой другой город simply не
// резолвились.

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { findRegionByName } = require("../.test-build/lib/ati/regions.js")

/** Кусок настоящего ответа /v1.0/dictionaries/regions (РФ). */
const REGIONS = [
  { id: 88, name: "Ярославская область", clearName: "Ярославская" },
  { id: 86, name: "Челябинская область", clearName: "Челябинская" },
  { id: 33, name: "Вологодская область", clearName: "Вологодская" },
  { id: 44, name: "Костромская область", clearName: "Костромская" },
  { id: 50, name: "Московская область", clearName: "Московская" },
  { id: 77, name: "Москва", clearName: "Москва" },
]

test("город базы → его регион", () => {
  assert.equal(findRegionByName("Ярославль", REGIONS)?.id, 88)
  assert.equal(findRegionByName("Челябинск", REGIONS)?.id, 86)
  assert.equal(findRegionByName("Вологда", REGIONS)?.id, 33)
  assert.equal(findRegionByName("Кострома", REGIONS)?.id, 44)
})

test("название региона тоже находится", () => {
  assert.equal(findRegionByName("Ярославская область", REGIONS)?.id, 88)
  assert.equal(findRegionByName("Вологодская область", REGIONS)?.id, 33)
})

test("город с приписками и в другом регистре", () => {
  assert.equal(findRegionByName("ярославль", REGIONS)?.id, 88)
  assert.equal(findRegionByName("ЯРОСЛАВЛЬ, Ярославская область", REGIONS)?.id, 88)
  assert.equal(findRegionByName("Кострома, Костромская область", REGIONS)?.id, 44)
})

test("ё и лишние символы не мешают", () => {
  assert.equal(findRegionByName("Челябинск г.", REGIONS)?.id, 86)
})

test("неизвестный город — null, а не чужой регион", () => {
  assert.equal(findRegionByName("Париж", REGIONS), null)
  assert.equal(findRegionByName("", REGIONS), null)
  assert.equal(findRegionByName("   ", REGIONS), null)
})

test("Москва находится и как город, и как регион", () => {
  // В словаре есть и «Москва» (id 77), и «Московская область» (id 50).
  // Точное совпадение должно выигрывать у поиска по основе.
  const found = findRegionByName("Москва", REGIONS)
  assert.ok(found, "Москва должна находиться")
  assert.equal(found.id, 77)
})
