/**
 * Особенности машины в подборе грузов (lib/logist-mobile/route-builder.ts).
 *
 * Повод — живой случай: логист поменял пятитонку в автопарке на «Тент» и
 * отметил в особенностях «Рефрижератор», «Боковая загрузка», «Верхняя
 * загрузка». В карточке машины это видно, а помощник по-прежнему писал
 * «ни один груз региона в неё не влезает»: подбор смотрел только на поле
 * «Тип ТС» и особенности игнорировал. Галочка в форме не значила ничего.
 *
 * Проверяем:
 *  1) «Рефрижератор» в особенностях пускает реф-груз в тент;
 *  2) без такой особенности — не пускает и объясняет причину словами;
 *  3) особенности читаются в любом виде: JSON-строка, массив, через запятую;
 *  4) «Изотерм» в особенностях пускает изотермический груз;
 *  5) пустые особенности ничего не ломают.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  loadFitsVehicle,
  truckTypeMatches,
  bodyMismatchText,
  explainVehicleMismatch,
} = require("../.test-build/lib/logist-mobile/route-builder.js")

const load = (over = {}) => ({
  id: "l1",
  fromCity: "Ярославль",
  toCity: "Брянск",
  weightKg: 3600,
  volumeM3: null,
  truckType: "Рефрижератор",
  priceRub: 90000,
  loadingDate: "2026-11-04T00:00:00.000Z",
  status: "new",
  ...over,
})

const tent5 = (over = {}) => ({
  id: "v1",
  plate: "К215СТ790",
  type: "Тент",
  capacity: 5000,
  volume: 32,
  status: "available",
  ...over,
})

test("реф-груз в тент не влезает, и причина названа словами", () => {
  const vehicle = tent5()
  assert.equal(truckTypeMatches(load(), vehicle), false)
  assert.equal(loadFitsVehicle(load(), vehicle), false)
  assert.match(bodyMismatchText(load(), vehicle) ?? "", /рефрижератор/)
})

test("«Рефрижератор» в особенностях машины пускает реф-груз", () => {
  const vehicle = tent5({ features: '["Тент","Рефрижератор","Гидроборт"]' })
  assert.equal(truckTypeMatches(load(), vehicle), true)
  assert.equal(loadFitsVehicle(load(), vehicle), true)
  assert.equal(bodyMismatchText(load(), vehicle), null)
})

test("особенности читаются в любом виде: массив и запись через запятую", () => {
  assert.equal(loadFitsVehicle(load(), tent5({ features: ["Тент", "Рефрижератор"] })), true)
  assert.equal(loadFitsVehicle(load(), tent5({ features: "тент, рефрижератор" })), true)
})

test("«Изотерм» в особенностях пускает изотермический груз", () => {
  // «Изотермический» без слова «фургон»: фургон сам по себе — сухой кузов,
  // и такой груз тент берёт и без особенности
  const insulated = load({ truckType: "Изотермический" })
  assert.equal(loadFitsVehicle(insulated, tent5()), false)
  assert.equal(loadFitsVehicle(insulated, tent5({ features: '["Изотерм"]' })), true)
})

test("пустые особенности ничего не ломают", () => {
  for (const features of [null, undefined, "", "[]"]) {
    const vehicle = tent5({ features })
    assert.equal(truckTypeMatches(load(), vehicle), false, `features=${String(features)}`)
    assert.equal(loadFitsVehicle(load({ truckType: "Тент" }), vehicle), true)
  }
})

test("вес и объём остаются главными: 5 т / 32 м³ не берут 5 т на 82 м³", () => {
  const vehicle = tent5({ features: '["Рефрижератор","Тент"]' })
  const big = load({ truckType: "Тент", weightKg: 5000, volumeM3: 82 })
  assert.equal(loadFitsVehicle(big, vehicle), false)
  const counts = explainVehicleMismatch([big, load({ truckType: "Тент", weightKg: 6200 })], vehicle)
  assert.equal(counts.total, 2)
  assert.equal(counts.fits, 0)
  assert.equal(counts.oversize, 1)
  assert.equal(counts.overweight, 1)
})
