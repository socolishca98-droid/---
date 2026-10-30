/**
 * Тесты «что рядом» для водителя (lib/geo/nearby.ts).
 *
 * Разобранный случай: на экране «Рядом» было «В радиусе 7 км ничего не
 * нашлось», хотя в реальности браузер водителя получил CORS-отказ от
 * overpass-api.de и запрос не ушёл вовсе. Сетевая ошибка выдавалась за
 * пустую карту — водитель крутил категории и не понимал, что делать.
 *
 * Проверяем: разбор ответа Overpass устойчив к мусору, пустой список и
 * недоступный сервис — РАЗНЫЕ сообщения, расстояние считается верно.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  parseNearby,
  nearbyOutcome,
  nearbyQuery,
  formatMeters,
  KIND_LABELS,
} = require("../.test-build/lib/geo/nearby.js")

const MOSCOW = { lat: 55.7558, lng: 37.6173 }

test("ответ Overpass разбирается в точки с расстоянием", () => {
  const raw = {
    elements: [
      { lat: 55.76, lon: 37.62, tags: { amenity: "fuel", name: "Лукойл" } },
      { lat: 55.9, lon: 37.9, tags: { amenity: "fuel", operator: "Газпромнефть" } },
      { lat: 55.757, lon: 37.618, tags: { highway: "services" } },
    ],
  }
  const places = parseNearby(raw, MOSCOW)
  assert.equal(places.length, 3)
  // Сортировка — по расстоянию: ближняя точка первой (она у нас ближе всех)
  assert.equal(places[0].tag, "Трассовый сервис")
  assert.ok(places[0].distanceM < 600, `первая точка ${places[0].distanceM} м`)
  assert.equal(places[1].name, "Лукойл")
  assert.equal(places[1].kind, "fuel")
  assert.ok(places[2].distanceM > places[1].distanceM)
  // Без названия подписываем категорией, а не пустой строкой
  assert.ok(places[0].name.length > 0)
  // Оператор вместо названия — тоже годится
  assert.equal(places[2].name, "Газпромнефть")
})

test("мусор в ответе не прячет нормальные точки", () => {
  const raw = {
    elements: [
      null,
      { lat: "нет", lon: 37.6, tags: {} },
      { lat: 55.76, lon: 37.62, tags: { amenity: "fuel" } },
      { tags: { amenity: "fuel" } },
    ],
  }
  const places = parseNearby(raw, MOSCOW)
  assert.equal(places.length, 1, "битые записи пропускаем, живую оставляем")
})

test("пусто вокруг и недоступный сервис — разные сообщения", () => {
  // Сервис не ответил: водителю нужно обновить, а не ехать дальше
  const failed = nearbyOutcome([], 7, true)
  assert.equal(failed.problem, "network")
  assert.match(failed.message, /Не удалось получить данные карты/)
  assert.match(failed.message, /Обновить/)

  // Вокруг правда пусто: другой совет
  const empty = nearbyOutcome([], 7, false)
  assert.equal(empty.problem, "empty")
  assert.match(empty.message, /В радиусе 7 км ничего не нашлось/)
  assert.doesNotMatch(empty.message, /Не удалось/)

  // Точки есть — никакого сообщения об ошибке
  const found = nearbyOutcome(
    [{ name: "АЗС", lat: 1, lng: 1, distanceM: 100, kind: "fuel", tag: KIND_LABELS.fuel }],
    7,
    false,
  )
  assert.equal(found.problem, null)
  assert.equal(found.message, null)
  assert.equal(found.places.length, 1)
})

test("запрос к Overpass собран из категории и радиуса", () => {
  const query = nearbyQuery(55.75, 37.61, "fuel", 7000, 12)
  assert.match(query, /\[out:json\]/)
  assert.match(query, /node\[amenity=fuel\]\(around:7000,55.75,37.61\)/)
  // У «отдыха» два селектора — оба должны попасть в запрос
  const rest = nearbyQuery(55.75, 37.61, "rest")
  assert.match(rest, /highway=services/)
  assert.match(rest, /amenity=parking/)
})

test("расстояние показывается по-человечески", () => {
  assert.equal(formatMeters(800), "800 м")
  assert.equal(formatMeters(1240), "1,2 км")
  assert.equal(formatMeters(15000), "15,0 км")
  assert.equal(formatMeters(Number.NaN), "—")
  assert.equal(formatMeters(-5), "—")
})

test("запрос спрашивает координаты: out center, а не out tags", () => {
  // С `out tags` в ответе нет lat/lon, и все точки отбрасывались — экран
  // писал «ничего не нашлось», хотя АЗС в радиусе есть (проверено на живом
  // Overpass 30.10.2026).
  const query = nearbyQuery(57.6261, 39.8845, "fuel", 7000, 12)
  assert.match(query, /out center/)
  assert.doesNotMatch(query, /out tags/)
})

test("точка-полигон с center тоже попадает в список", () => {
  const raw = {
    elements: [
      { type: "node", id: 1, lat: 57.63, lon: 39.9, tags: { amenity: "fuel", name: "Опти" } },
      {
        type: "way",
        id: 2,
        center: { lat: 57.64, lon: 39.92 },
        tags: { amenity: "fuel", name: "Лукойл" },
      },
      { type: "node", id: 3, tags: { amenity: "fuel" } },
    ],
  }
  const places = parseNearby(raw, { lat: 57.6261, lng: 39.8845 }, 12)
  assert.deepEqual(
    places.map((place) => place.name),
    ["Опти", "Лукойл"],
  )
})
