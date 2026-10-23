/**
 * Тесты маппинга грузов byboards (lib/ati/boards-mapping.ts).
 *
 * Формат ответа ATI /v1.0/loads/search/byboards отличается от прежнего
 * loads/search: город только CityId, вес в тоннах, цена в Payment.SumWithNDS.
 * Проверяем на фикстуре реального груза:
 *  1) город и регион подставляются из справочника (CityId → имя);
 *  2) расстояние, вес (т → кг), объём, тип груза переносятся;
 *  3) цена с НДС становится rate.priceNds;
 *  4) тип кузова и погрузки — подписями;
 *  5) неизвестный CityId не роняет маппинг (Город #ID);
 *  6) collectCityIds собирает все CityId погрузки и выгрузки.
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { mapBoardsLoad, collectCityIds } = require(
  "../.test-build/lib/ati/boards-mapping.js",
)

/** Города: 1257 Подольск (МО), 3022 Измир (вне справочника РФ). */
const CITIES = new Map([
  [1257, { name: "Подольск", region: "Московская область" }],
  [30, { name: "Воронеж", region: "Воронежская область" }],
])

/** Фрагмент реального груза byboards (упрощённый). */
function boardsLoad(overrides = {}) {
  return {
    Id: "1fab8ecc-d156-4f8e-9872-081c7db3d073",
    LoadNumber: "GPH220643",
    FirmId: 2465093,
    Distance: 1654,
    FirstDate: "2026-10-26T00:00:00Z",
    Loading: { CityId: 3022, Latitude: 38.4, Longitude: 27.1, StartTime: "09:00" },
    Unloading: { CityId: 1257, Latitude: 55.43, Longitude: 37.54 },
    Cargo: {
      Weight: 20.0,
      Volume: 0.2,
      CargoType: "Продукты питания",
      PalletCount: 33,
    },
    Payment: { SumWithNDS: 643700.0, SumWithoutNDS: 643700.0, RateSum: 0.0 },
    Transport: { CarType: 1, LoadingType: 4 },
    ...overrides,
  }
}

test("город из справочника и неизвестный CityId", () => {
  const mapped = mapBoardsLoad(boardsLoad(), CITIES)
  assert.equal(mapped.loading.location.city, "Город #3022") // вне РФ-справочника
  assert.equal(mapped.unloading.location.city, "Подольск")
  assert.equal(mapped.unloading.location.region, "Московская область")
})

test("расстояние, вес, объём, тип груза", () => {
  const mapped = mapBoardsLoad(boardsLoad(), CITIES)
  assert.equal(mapped.route.distance, 1654)
  assert.equal(mapped.load.weight, 20) // тонны, как ждёт фильтр/биржа
  assert.equal(mapped.load.volume, 0.2)
  assert.equal(mapped.load.cargoType, "Продукты питания")
})

test("цена с НДС → rate.priceNds", () => {
  const mapped = mapBoardsLoad(boardsLoad(), CITIES)
  assert.equal(mapped.rate.priceNds, 643700)
})

test("тип кузова и погрузки подписями", () => {
  const mapped = mapBoardsLoad(boardsLoad(), CITIES)
  assert.deepEqual(mapped.truck.carTypes, ["Тент"])
  assert.deepEqual(mapped.truck.loadingTypes, ["Любая"])
})

test("без цены (торг) — rate пустой", () => {
  const mapped = mapBoardsLoad(
    boardsLoad({ Payment: { SumWithNDS: 0, SumWithoutNDS: 0, RateSum: 0 } }),
    CITIES
  )
  assert.equal(mapped.rate.priceNds, undefined)
  assert.equal(mapped.rate.price, undefined)
})

test("дата погрузки берётся из FirstDate", () => {
  const mapped = mapBoardsLoad(boardsLoad(), CITIES)
  assert.equal(mapped.loading.firstDate, "2026-10-26T00:00:00Z")
})

test("collectCityIds — все CityId погрузки и выгрузки", () => {
  const ids = collectCityIds([boardsLoad()])
  assert.deepEqual(ids.sort(), [1257, 3022])
})

test("FirmId фрахтователя переносится для дозапроса контактов", () => {
  const mapped = mapBoardsLoad(boardsLoad(), CITIES)
  assert.equal(mapped.firm.id, "2465093")
  // Имя фрахтователя приходит только карточкой фирмы — в грузе его нет
  assert.equal(mapped.firm.name, null)
})
