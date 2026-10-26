/**
 * Регион базы по адресу с приставками — «г. Тулун, ул. Ленина 5».
 *
 * Замер живого геокодера (OpenStreetMap Nominatim): адрес, записанный с
 * приставками, он понимает как улицу и находит её в другом городе —
 *
 *   «г. Тулун, ул. Ленина 5»   -> «5, улица Ленина, ... Омск, Омская область»
 *   «Тулун, Ленина 5»          -> «5, улица Ленина, Тулун, ... Иркутская область»
 *   «г. Оханск, ул. Кирова 3»  -> «3, улица Кирова, Воронеж, Воронежская область»
 *
 * Для организации из такого города это означало чужой регион сбора и чужой
 * фильтр в помощнике. Проверяем на настоящих ответах геокодера (снятых заранее
 * и подставленных вместо сети), что приставки снимаются, город из адреса
 * сверяется с разобранным местом, а незнакомый город дает честный null.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

// lib/geo/nominatim.ts импортирует словари через «@/...». В сборке тестов этот
// путь остается как есть, поэтому показываем его резолверу Node сами.
const Module = require("module")
const originalResolve = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    const file = new URL(`../.test-build/${request.slice(2)}.js`, import.meta.url)
    request = file.pathname
  }
  return originalResolve.call(this, request, ...rest)
}

/** Ответы геокодера, снятые с живого сервиса: ключ — запрос в нижнем регистре. */
const GEOCODER = {
  "г. тулун, ул. ленина 5": [
    {
      display_name:
        "5, улица Ленина, Куйбышевский, Центральный административный округ, Омск, Омская область, Сибирский федеральный округ",
      lat: "54.9893",
      lon: "73.3682",
      address: { city: "Омск", state: "Омская область" },
    },
  ],
  "тулун, ленина 5": [
    {
      display_name:
        "5, улица Ленина, Тулун, городской округ Тулун, Иркутская область, Сибирский федеральный округ",
      lat: "52.5589",
      lon: "100.4297",
      type: "house",
      class: "building",
      address: { town: "Тулун", state: "Иркутская область" },
    },
  ],
  "г. оханск, ул. кирова 3": [
    {
      display_name: "3, улица Кирова, Воронеж, Воронежская область",
      lat: "51.6720",
      lon: "39.2040",
      address: { city: "Воронеж", state: "Воронежская область" },
    },
  ],
  "оханск, кирова 3": [
    {
      display_name: "3, улица Кирова, Оханск, Оханский район, Пермский край",
      lat: "57.7130",
      lon: "55.3870",
      address: { town: "Оханск", state: "Пермский край" },
    },
  ],
  оханск: [
    {
      display_name: "Оханск, Оханский район, Пермский край, Приволжский федеральный округ",
      lat: "57.7130",
      lon: "55.3870",
      address: { town: "Оханск", state: "Пермский край" },
    },
  ],
  "2-я суворовская 2, ярославль": [
    {
      display_name: "2, 2-я Суворовская улица, Ярославль, Ярославская область",
      lat: "57.6261",
      lon: "39.8845",
      address: { city: "Ярославль", state: "Ярославская область" },
    },
  ],
}

/** Сеть подменяем: настоящий геокодер в тестах не нужен, ответы уже сняты. */
const asked = []
globalThis.fetch = async (url) => {
  const query = decodeURIComponent(String(url).split("q=")[1] || "")
    .trim()
    .toLowerCase()
  asked.push(query)
  return { ok: true, json: async () => GEOCODER[query] || [] }
}

const { regionOfPlace, searchPlaces } = require("../.test-build/lib/geo/nominatim.js")
const { regionOfBaseAddress } = require("../.test-build/lib/ati/base-region.js")

test("адрес с приставкой «г.» не уносит регион в чужой город", async () => {
  asked.length = 0
  const region = await regionOfPlace("г. Тулун, ул. Ленина 5")
  assert.equal(region, "Иркутская область", "приставки снимаются — город находится верно")
  assert.ok(
    asked.every((q) => !q.startsWith("г.")),
    `к геокодеру обращаемся без служебных приставок, запрошено: ${asked.join(" | ")}`,
  )
})

test("приставки снимаются и в другом адресе", async () => {
  asked.length = 0
  const region = await regionOfPlace("г. Оханск, ул. Кирова 3")
  assert.equal(region, "Пермский край")
  assert.ok(asked.every((q) => !q.startsWith("г.")), `запрошено: ${asked.join(" | ")}`)
})

test("город без адреса по-прежнему определяется", async () => {
  assert.equal(await regionOfPlace("Оханск"), "Пермский край")
})

test("адрес, начатый с области, не сломался", async () => {
  // Такой адрес геокодер не понимает вовсе — спасает перебор вариантов
  // «улица дом, город» по словарю ATI.
  const region = await regionOfPlace("Ярославская обл. Ул 2-я Суворовская 2")
  assert.equal(region, "Ярославская область")
})

test("незнакомый город дает null, а не чужой регион", async () => {
  const region = await regionOfPlace("Неттакого, ул. Ленина 5")
  assert.equal(region, null, "лучше «не знаю», чем отправить сборщик в чужой регион")
})

test("регион базы считается по такому адресу", async () => {
  const base = await regionOfBaseAddress("г. Тулун, ул. Ленина 5")
  assert.deepEqual(base, { id: 70, name: "Иркутская область" })
})

test("подсказки адреса находят дом в своём городе", async () => {
  const items = await searchPlaces("г. Тулун, ул. Ленина 5", 3)
  assert.ok(items.length > 0, "подсказка должна быть")
  assert.match(items[0].label, /Тулун/, "дом ищем в Тулуне, а не в Омске")
  assert.equal(items[0].precision, "house")
})
