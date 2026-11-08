// tests/cargomart-mapping.test.mjs
//
// Разъём Cargomart: маппинг груза биржи (api/v2/order) во внутренний формат
// накопленной базы. Чистый модуль — без сети и без Prisma.
//
// Правила, которые фиксирует тест:
//   · город записывается С РЕГИОНОМ («Ярославль, Ярославская область») —
//     иначе справочник не различает три ярославля в стране;
//   · вес Cargomart приходит в килограммах, внутренний формат — тонны;
//   · идентификатор получает префикс «cargomart:» — груз №123 с двух бирж
//     не сливается в одну строку кэша;
//   · КОНТАКТОВ В МАППИНГЕ НЕТ — ни полей, ни запросов: контакты
//     грузовладельца логист добирает осознанным действием, не сбором;
//   · флаг разъёма по умолчанию выключен — без CARGOMART_ENABLED продукт
//     ведёт себя так, будто Cargomart не существует.

import assert from "node:assert/strict"
import test from "node:test"

import {
  mapCargomartLoad,
  cityWithRegion,
  cargomartCityKeys,
} from "../.test-build/lib/cargomart/mapping.js"

const DICTS = {
  locality: {
    "7600000100000": { name: "Ярославль", region: "Ярославская область" },
    "7700000000000": { name: "Москва", region: "Москва" },
  },
  company: { "hash-c1": { short_name: 'ООО "Отправитель"' } },
  truck_type: { "1": { name: "Тент" } },
}

const RAW = {
  id: "123456",
  current_price: "82000",
  vat_rate: 20,
  is_consignor_vat: true,
  weight: 18000,
  capacity: 82,
  kind: 1,
  truck_type_id: 1,
  consignor_id: "hash-c1",
  loading: { code: "7600000100000", date: "2026-11-10T08:00:00+03:00" },
  unloading: { code: "7700000000000", date: "2026-11-11T12:00:00+03:00" },
}

test("город записывается с регионом", () => {
  const load = mapCargomartLoad(RAW, DICTS)
  assert.equal(load.loading.location.city, "Ярославль")
  assert.equal(load.loading.location.region, "Ярославская область")
  assert.equal(cityWithRegion(load.loading.location.city, load.loading.location.region), "Ярославль, Ярославская область")
})

test("вес: килограммы источника → тонны внутреннего формата", () => {
  const load = mapCargomartLoad(RAW, DICTS)
  assert.equal(load.load.weight, 18)
})

test("идентификатор с префиксом источника", () => {
  const load = mapCargomartLoad(RAW, DICTS)
  assert.equal(load.id, "cargomart:123456")
  assert.equal(load.source, "cargomart")
})

test("цена и НДС", () => {
  const load = mapCargomartLoad(RAW, DICTS)
  assert.equal(load.rate.price, 82000)
  assert.equal(load.rate.priceNds, 82000)
  assert.equal(load.rate.priceNoNds, null)
})

test("даты погрузки и выгрузки проходят насквозь", () => {
  const load = mapCargomartLoad(RAW, DICTS)
  assert.equal(load.loading.firstDate, "2026-11-10T08:00:00+03:00")
  assert.equal(load.unloading.firstDate, "2026-11-11T12:00:00+03:00")
})

test("КОНТАКТОВ НЕТ: в маппере нет контактных полей", () => {
  const load = mapCargomartLoad(RAW, DICTS)
  // Контактные данные не появляются ни на верхнем уровне, ни в фирме:
  // разъём их не запрашивает и не хранит.
  const flat = JSON.stringify(load).toLowerCase()
  assert.ok(!flat.includes("phone"), "телефона в маппинге быть не должно")
  assert.ok(!flat.includes("contact"), "контактов в маппинге быть не должно")
  assert.ok(!flat.includes("email"), "почты в маппинге быть не должно")
})

test("груз без городов не проходит", () => {
  assert.equal(mapCargomartLoad({ id: "1" }, DICTS), null)
  assert.equal(mapCargomartLoad(null, DICTS), null)
})

test("груз без цены: null, а не ноль-как-даром", () => {
  const load = mapCargomartLoad({ ...RAW, current_price: null }, DICTS)
  assert.equal(load.rate.price, null)
})

test("ключи городов совместимы с накопленной базой", () => {
  const load = mapCargomartLoad(RAW, DICTS)
  const { fromKey, toKey } = cargomartCityKeys(load)
  assert.equal(fromKey, "ярославль")
  assert.equal(toKey, "москва")
})

test("тип кузова из словаря источника", () => {
  const load = mapCargomartLoad(RAW, DICTS)
  assert.deepEqual(load.truck.carTypes, ["Тент"])
})
