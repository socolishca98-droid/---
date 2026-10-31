/**
 * Тесты особенностей машины (lib/fleet/vehicle-features.ts).
 *
 * Повод: в автопарке не было действия «изменить». Починив его, легко
 * наступить на вторую мину: особенности в базе лежат в двух видах — русскими
 * названиями («Гидроборт» из старых записей) и идентификаторами формы
 * («tail_lift»), плюс есть оборудование, под которое в форме нет галочки
 * («кран-балка», «термограф»). Наивная форма открывается с пустыми галочками
 * и сохранение МОЛЧА снимает с машины всё оборудование.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  customVehicleFeatures,
  parseVehicleFeatures,
  vehicleFeatureLabels,
  featuresForSave,
  VEHICLE_FEATURES,
} = require("../.test-build/lib/fleet/vehicle-features.js")

test("особенности из базы в виде JSON читаются", () => {
  assert.deepEqual(parseVehicleFeatures('["гидроборт","термограф"]'), ["tail_lift"])
  assert.deepEqual(parseVehicleFeatures('["GPS-трекер"]'), ["gps"])
})

test("идентификаторы формы тоже узнаются — галочки не слетают", () => {
  assert.deepEqual(parseVehicleFeatures('["tail_lift","adr"]'), ["tail_lift", "adr"])
})

test("пустое и мусорное значение не ломает форму", () => {
  assert.deepEqual(parseVehicleFeatures(null), [])
  assert.deepEqual(parseVehicleFeatures(""), [])
  assert.deepEqual(parseVehicleFeatures("[]"), [])
  assert.deepEqual(parseVehicleFeatures("не массив"), [])
})

test("сохранение пишет человеческие названия, как в карточке", () => {
  assert.deepEqual(featuresForSave(["tail_lift", "refrigerator"]), ["Гидроборт", "Рефрижератор"])
})

test("сохранённое читается обратно теми же галочками", () => {
  const saved = featuresForSave(["tent", "top_loading", "gps"])
  assert.deepEqual(parseVehicleFeatures(JSON.stringify(saved)), ["tent", "top_loading", "gps"])
})

test("незнакомое оборудование не теряется при правке", () => {
  // «кран-балка» и «термограф» есть в реальных данных, но галочек под них нет:
  // правка тоннажа не должна стирать их с машины.
  assert.deepEqual(parseVehicleFeatures('["Гидроборт","кран-балка"]'), ["tail_lift"])
  assert.deepEqual(customVehicleFeatures('["Гидроборт","кран-балка"]'), ["кран-балка"])
  assert.deepEqual(featuresForSave(["tail_lift"], customVehicleFeatures('["Гидроборт","кран-балка"]')), [
    "Гидроборт",
    "кран-балка",
  ])
  // карточка показывает и то и другое
  assert.deepEqual(vehicleFeatureLabels('["Гидроборт","кран-балка"]'), ["Гидроборт", "кран-балка"])
})

test("сохранение не дублирует уже выбранное", () => {
  assert.deepEqual(featuresForSave(["refrigerator"], ["Рефрижератор", "боковая погрузка"]), [
    "Рефрижератор",
    "боковая погрузка",
  ])
})

test("карточка показывает подписи, а не машинные коды", () => {
  assert.deepEqual(vehicleFeatureLabels('["гидроборт"]'), ["Гидроборт"])
  const all = VEHICLE_FEATURES.map((f) => f.id)
  assert.deepEqual(
    vehicleFeatureLabels(JSON.stringify(featuresForSave(all))),
    VEHICLE_FEATURES.map((f) => f.label),
  )
})
