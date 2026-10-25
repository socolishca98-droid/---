// tests/ati-exchange-mapping.test.mjs
// Маппинг грузов ОБЩЕЙ биржи ATI (внутренний поиск loads.ati.su) во
// внутренний формат + сборка фильтра.
//
// Контекст: официальный API отдаёт только грузы площадок организации
// (у перевозчика из Ярославля — 0 грузов). Общая биржа через сайт отдаёт
// 2 963 груза в радиусе 300 км от Ярославля, но с ДРУГОЙ формой ответа:
// location.lat/lon вместо Latitude/Longitude, имя фирмы сразу в firm.name.

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  mapExchangeLoad,
  buildExchangeFilter,
  EXCHANGE_ITEMS_PER_PAGE,
  EXCHANGE_MAX_PAGES,
} = require("../.test-build/lib/ati/exchange-mapping.js")

/** Фрагмент реального груза общей биржи (Ярославль → Красноярск). */
const SAMPLE = {
  id: "15d0c0a5-30a2-4e06-bf8b-16d019a8fb0b",
  loadNumber: "YBQ1492352",
  route: { country: "RUS", distance: 4125 },
  truck: {
    carTypes: ["1", "2", "8", "16", "64"],
    carTypesBitSum: "91",
    loadingTypes: [4],
    unloadingTypes: [4],
  },
  load: { weight: 0, volume: 82, cargoType: "ТНП" },
  loading: {
    location: {
      city: "Ярославль",
      region: "",
      lat: 57.626388,
      lon: 39.89337,
      fullGeoName: "Ярославль, Ярославская область, Россия",
    },
    firstDate: "2026-10-25T00:00:00",
  },
  unloading: {
    location: {
      city: "Красноярск",
      region: "",
      lat: 56.009097,
      lon: 92.872515,
      fullGeoName: "Красноярск, Красноярский край, Россия",
    },
  },
  rate: { price: 0, priceNds: 430000, priceNoNds: 0 },
  firm: { id: "631426", name: "Любимый ДОМ, ООО" },
}

test("mapExchangeLoad: город, координаты и расстояние переносятся", () => {
  const load = mapExchangeLoad(SAMPLE)
  assert.equal(load.loading.location.city, "Ярославль")
  assert.equal(load.unloading.location.city, "Красноярск")
  assert.deepEqual(load.loading.point, { lat: 57.626388, lng: 39.89337 })
  assert.deepEqual(load.unloading.point, { lat: 56.009097, lng: 92.872515 })
  assert.equal(load.route.distance, 4125)
})

test("mapExchangeLoad: регион берётся из полного имени, когда region пустой", () => {
  const load = mapExchangeLoad(SAMPLE)
  assert.equal(load.loading.location.region, "Ярославская область")
  assert.equal(load.unloading.location.region, "Красноярский край")
})

test("mapExchangeLoad: регион из поля region приоритетнее полного имени", () => {
  const load = mapExchangeLoad({
    ...SAMPLE,
    loading: {
      ...SAMPLE.loading,
      location: { ...SAMPLE.loading.location, region: "Ярославская обл." },
    },
  })
  assert.equal(load.loading.location.region, "Ярославская обл.")
})

test("mapExchangeLoad: цена с НДС становится ставкой", () => {
  const load = mapExchangeLoad(SAMPLE)
  assert.equal(load.rate.priceNds, 430000)
  assert.equal(load.rate.price, 430000)
})

test("mapExchangeLoad: ставка без НДС, если НДС не озвучен", () => {
  const load = mapExchangeLoad({
    ...SAMPLE,
    rate: { price: 0, priceNds: 0, priceNoNds: 85000 },
  })
  assert.equal(load.rate.priceNoNds, 85000)
  assert.equal(load.rate.price, 85000)
})

test("mapExchangeLoad: вес в тоннах сохраняется как есть", () => {
  const load = mapExchangeLoad({ ...SAMPLE, load: { ...SAMPLE.load, weight: 20 } })
  assert.equal(load.load.weight, 20)
})

test("mapExchangeLoad: фрахтователь приходит с именем", () => {
  const load = mapExchangeLoad(SAMPLE)
  assert.equal(load.firm.id, "631426")
  assert.equal(load.firm.name, "Любимый ДОМ, ООО")
})

test("mapExchangeLoad: тип кузова — подписью, неизвестный id не теряется", () => {
  const load = mapExchangeLoad(SAMPLE)
  assert.ok(load.truck.carTypes.includes("Тент"))
  assert.ok(load.truck.carTypes.includes("Фургон"))
  assert.ok(load.truck.carTypes.includes("Контейнеровоз"))
  assert.ok(load.truck.carTypes.includes("Кузов #16"))
  assert.equal(load.truck.loadingTypes[0], "Любая")
})

test("mapExchangeLoad: источник помечен как общая биржа", () => {
  assert.equal(mapExchangeLoad(SAMPLE).source, "exchange")
})

test("mapExchangeLoad: 0/0 в координатах значит «неизвестно»", () => {
  const load = mapExchangeLoad({
    ...SAMPLE,
    loading: { ...SAMPLE.loading, location: { city: "Пермь", lat: 0, lon: 0 } },
  })
  assert.equal(load.loading.point, null)
})

test("mapExchangeLoad: битый груз не роняет маппинг", () => {
  const load = mapExchangeLoad({})
  assert.equal(load.id, "")
  assert.equal(load.loading.location.city, null)
  assert.equal(load.load.weight, 0)
})

test("buildExchangeFilter: откуда с радиусом", () => {
  assert.deepEqual(buildExchangeFilter({ fromCityId: 88, fromRadiusKm: 300 }), {
    sorting_type: 2,
    from: { id: 88, type: 1, radius: 300, exact_only: false },
  })
})

test("buildExchangeFilter: точный город при радиусе 0", () => {
  assert.deepEqual(buildExchangeFilter({ fromCityId: 88, fromRadiusKm: 0 }), {
    sorting_type: 2,
    from: { id: 88, type: 1, radius: 0, exact_only: true },
  })
})

test("buildExchangeFilter: откуда и куда вместе", () => {
  const filter = buildExchangeFilter({
    fromCityId: 88,
    fromRadiusKm: 300,
    toCityId: 86,
    toRadiusKm: 100,
  })
  assert.deepEqual(filter.to, { id: 86, type: 1, radius: 100, exact_only: false })
})

test("buildExchangeFilter: без городов фильтр пустой, кроме сортировки", () => {
  assert.deepEqual(buildExchangeFilter({}), { sorting_type: 2 })
})

test("константы обхода страниц заданы", () => {
  assert.ok(EXCHANGE_ITEMS_PER_PAGE > 0)
  assert.ok(EXCHANGE_MAX_PAGES > 0)
})
