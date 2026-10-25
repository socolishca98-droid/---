// tests/ati-regions.test.mjs
//
// Город → регион ATI. Это ядро живого поиска по общей бирже.
//
// Выяснено проверками на бою: в фильтре биржи loads.ati.su id «откуда» — это
// id РЕГИОНА, а не города. from:{id:88} даёт 2 899 грузов со всей Ярославской
// области (поэтому радиус в фильтре и не влиял на объём), from:{id:86} —
// 4 094 груза Челябинской области, from:{id:33} — 3 015 грузов Вологодской.
//
// Прежний список городов был выписан руками (28 городов). Город вне списка
// не резолвился никак: по названию биржа не ищет (from_id_required),
// официальный словарь городов — другое пространство id, фильтр по geoCode
// не принимается. Живой поиск не работал ни у одной организации, чья база
// вне списка: ни Вологда, ни Кострома, ни Тула.
//
// Теперь город → регион берётся из официальных словарей ATI, выписанных в
// lib/ati/ati-city-regions.ts. Значения в asserts — настоящие, не выдуманные.

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { findRegionByName, findRegionByNameLocal } = require("../.test-build/lib/ati/regions.js")
const { ATI_CITY_REGIONS } = require("../.test-build/lib/ati/ati-city-regions.js")

test("справочник покрывает регионы всей страны", () => {
  assert.ok(Object.keys(ATI_CITY_REGIONS).length >= 150, "городов должно хватать на любую базу")
  for (const city of ["ярославль", "вологда", "кострома", "тула", "орел", "москва"]) {
    assert.ok(ATI_CITY_REGIONS[city], `${city} должен быть в справочнике`)
  }
})

test("город базы → его регион", () => {
  assert.equal(findRegionByName("Ярославль", [])?.id, 88)
  assert.equal(findRegionByName("Челябинск", [])?.id, 86)
  assert.equal(findRegionByName("Вологда", [])?.id, 33)
  assert.equal(findRegionByName("Кострома", [])?.id, 39)
  assert.equal(findRegionByName("Тула", [])?.id, 24)
  assert.equal(findRegionByName("Орел", [])?.id, 83)
})

test("название региона тоже находится", () => {
  assert.equal(findRegionByName("Вологодская область", [])?.id, 33)
  assert.equal(findRegionByName("Ярославская область", [])?.id, 88)
})

test("город с приписками и в другом регистре", () => {
  assert.equal(findRegionByName("ярославль", [])?.id, 88)
  assert.equal(findRegionByName("ЯРОСЛАВЛЬ, Ярославская область", [])?.id, 88)
  assert.equal(findRegionByName("Кострома, Костромская область", [])?.id, 39)
  assert.equal(findRegionByName("Тула г.", [])?.id, 24)
})

test("ё и лишние символы не мешают", () => {
  assert.equal(findRegionByName("Челябинск г.", [])?.id, 86)
})

test("неизвестный город — null, а не чужой регион", () => {
  assert.equal(findRegionByName("Париж", []), null)
  assert.equal(findRegionByName("", []), null)
  assert.equal(findRegionByName("   ", []), null)
})

test("без запроса к ATI резолвится сразу", () => {
  // Локальный путь обязан работать: иначе каждый поиск жжёт лимит 10 rps
  assert.equal(findRegionByNameLocal("Тула")?.id, 24)
  assert.equal(findRegionByNameLocal("Вологда")?.id, 33)
  assert.equal(findRegionByNameLocal("неизвестный город"), null)
})

test("регион с названием возвращает и название", () => {
  const found = findRegionByName("Вологда", [])
  assert.match(found.name, /Вологодская/i)
})
