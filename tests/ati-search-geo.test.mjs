// tests/ati-search-geo.test.mjs
// Гео-фильтр живого поиска: «в радиусе N км от города», как на сайте ATI.
//
// Контекст: логист из Ярославля искал «Ярославль» и получал ноль грузов,
// хотя на доступных площадках есть три груза, выгружающиеся в Корюково —
// в 8 км от Ярославля. Точное совпадение названий такой груз не находило.

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  haversineKm,
  isUsablePoint,
  loadMatchesGeo,
  matchesGeoQuery,
  emptyGeoQuery,
  sideCityKey,
  normalizeCityKey,
} = require("../.test-build/lib/ati/search-geo.js")

const YAROSLAVL = { lat: 57.6261, lng: 39.8845 }

test("haversineKm: Ярославль — Корюково около 8 км", () => {
  const koryukovo = { lat: 57.7, lng: 39.9 }
  const km = haversineKm(YAROSLAVL, koryukovo)
  assert.ok(km > 5 && km < 12, `ожидали ~8 км, получили ${km}`)
})

test("haversineKm: Москва — Ярославль около 250 км", () => {
  const moscow = { lat: 55.7558, lng: 37.6173 }
  const km = haversineKm(moscow, YAROSLAVL)
  assert.ok(km > 240 && km < 270, `ожидали ~255 км, получили ${km}`)
})

test("isUsablePoint: 0/0 в грузах ATI значит «неизвестно»", () => {
  assert.equal(isUsablePoint({ lat: 0, lng: 0 }), false)
  assert.equal(isUsablePoint(null), false)
  assert.equal(isUsablePoint({ lat: 57, lng: 39 }), true)
})

test("matchesGeoQuery: точное совпадение города проходит всегда", () => {
  const query = { cityKey: "ярославль", center: null, radiusKm: 0 }
  assert.equal(matchesGeoQuery(query, "ярославль", null), "city")
})

test("matchesGeoQuery: радиус находит груз без совпадения названий", () => {
  const query = { cityKey: "ярославль", center: YAROSLAVL, radiusKm: 300 }
  const koryukovo = { lat: 57.7, lng: 39.9 }
  assert.equal(matchesGeoQuery(query, "корюково", koryukovo), "radius")
})

test("matchesGeoQuery: за пределами радиуса груз не проходит", () => {
  const query = { cityKey: "ярославль", center: YAROSLAVL, radiusKm: 100 }
  const moscow = { lat: 55.7558, lng: 37.6173 }
  assert.equal(matchesGeoQuery(query, "москва", moscow), null)
})

test("matchesGeoQuery: без центра радиус не работает, груз отбрасывается", () => {
  const query = { cityKey: "ярославль", center: null, radiusKm: 300 }
  const koryukovo = { lat: 57.7, lng: 39.9 }
  assert.equal(matchesGeoQuery(query, "корюково", koryukovo), null)
})

test("matchesGeoQuery: выключенный фильтр пропускает всё", () => {
  assert.equal(matchesGeoQuery(emptyGeoQuery(), "москва", null), null)
})

test("loadMatchesGeo: обратка домой находится по «Куда»", () => {
  const load = {
    loading: {
      location: { city: "Вязники г.", region: "Владимирская область" },
      point: { lat: 56.2117, lng: 42.0708 },
    },
    unloading: {
      location: { city: "Корюково д.", region: "Ярославская область" },
      point: { lat: 57.7, lng: 39.9 },
    },
  }
  const to = { cityKey: "ярославль", center: YAROSLAVL, radiusKm: 300 }
  const result = loadMatchesGeo(load, emptyGeoQuery(), to)
  assert.equal(result.ok, true)
  assert.equal(result.toReason, "radius")
})

test("loadMatchesGeo: поиск только «Откуда» не трогает «Куда»", () => {
  const load = {
    loading: {
      location: { city: "Вязники г.", region: "Владимирская область" },
      point: { lat: 56.2117, lng: 42.0708 },
    },
    unloading: {
      location: { city: "Пермь", region: "Пермский край" },
      point: { lat: 58.0105, lng: 56.2502 },
    },
  }
  const from = { cityKey: "вязники", center: null, radiusKm: 0 }
  const result = loadMatchesGeo(load, from, emptyGeoQuery())
  assert.equal(result.ok, true)
  assert.equal(result.fromReason, "city")
})

test("loadMatchesGeo: не подходит ни одна сторона — груз выброшен", () => {
  const load = {
    loading: {
      location: { city: "Ступино г.", region: "Московская область" },
      point: { lat: 54.9, lng: 38.0 },
    },
    unloading: {
      location: { city: "Казань", region: "Республика Татарстан" },
      point: { lat: 55.7963, lng: 49.1064 },
    },
  }
  const from = { cityKey: "ярославль", center: YAROSLAVL, radiusKm: 300 }
  const to = { cityKey: "сочи", center: { lat: 43.5855, lng: 39.7231 }, radiusKm: 300 }
  assert.equal(loadMatchesGeo(load, from, to).ok, false)
})

test("loadMatchesGeo: город совпал, а радиус не задан — груз берём", () => {
  const load = {
    loading: { location: { city: "Ярославль", region: "Ярославская область" }, point: null },
    unloading: { location: { city: "Москва", region: "Москва" }, point: null },
  }
  const from = { cityKey: "ярославль", center: YAROSLAVL, radiusKm: 0 }
  const result = loadMatchesGeo(load, from, emptyGeoQuery())
  assert.equal(result.ok, true)
  assert.equal(result.fromReason, "city")
})

test("sideCityKey: нормализованный ключ без региона и сокращений", () => {
  assert.equal(
    sideCityKey({ location: { city: "Вязники г.", region: "Владимирская область" } }),
    "вязники",
  )
  assert.equal(
    sideCityKey({ location: { city: "Корюково д.", region: "Ярославская область" } }),
    "корюково",
  )
  assert.equal(sideCityKey({ location: { city: "Пермь" } }), "пермь")
  assert.equal(sideCityKey(undefined), null)
})

test("normalizeCityKey: «Вязники г., Владимирская область» и «Вязники» — один ключ", () => {
  assert.equal(
    normalizeCityKey("Вязники г., Владимирская область"),
    normalizeCityKey("Вязники"),
  )
  assert.equal(normalizeCityKey("  Москва  "), "москва")
  assert.equal(normalizeCityKey(""), null)
  assert.equal(normalizeCityKey(null), null)
})

test("matchesGeoQuery: сравнение идёт по нормализованному ключу", () => {
  const query = { cityKey: "Вязники", center: null, radiusKm: 0 }
  assert.equal(matchesGeoQuery(query, "Вязники г., Владимирская область", null), "city")
})
