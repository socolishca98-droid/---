// tests/base-region-any-city.test.mjs
//
// «Но опять же это у меня Ярославль, как будет работать в других городах?»
//
// Замер своего словаря городов (199 штук, в основном областные центры):
//
//   Ярославль → 88 Ярославская область     Тулун  → ничего
//   Биробиджан → 89 Еврейская АО           Кировск → ничего
//   Новый Уренгой → 17 ЯНАО                Надым  → ничего
//
// Пока регион не определялся, организация из такого города теряла три вещи:
// сборщик не собирал её регион, помощник показывал грузы со всей страны, а
// профиль сканирования оставался с пустым списком городов.
//
// Словарь РЕГИОНОВ при этом полный — все 95 регионов, причём в любом
// написании («Иркутская область», «Иркутская», «Ханты-Мансийский АО — Югра»).
// Поэтому город, которого нет в словаре, досчитывается через геокодера.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const GEO = readFileSync(join(ROOT, "lib/geo/nominatim.ts"), "utf8")
const BASE = readFileSync(join(ROOT, "lib/ati/base-region.ts"), "utf8")
const SCAN = readFileSync(join(ROOT, "app/api/ati/scan/route.ts"), "utf8")
const CONFIG = readFileSync(join(ROOT, "app/api/ati/scan-config/route.ts"), "utf8")
const LOADS = readFileSync(join(ROOT, "app/api/ati/loads/route.ts"), "utf8")
const ASSISTANT = readFileSync(join(ROOT, "app/lm/routes/assistant/page.tsx"), "utf8")

test("геокодер умеет отдавать регион места", () => {
  assert.match(GEO, /export async function regionOfPlace/, "нужен резолвер региона по адресу")
  assert.match(GEO, /address\.state \|\| address\.region/, "регион берём из разбора адреса геокодера")
  assert.match(GEO, /REGION_CACHE/, "результат должен кэшироваться — к геокодеру бережно")
})

test("регион базы считается для любого адреса, не только из 199 городов", () => {
  assert.match(BASE, /export async function regionOfBaseAddress/, "резолвер региона базы должен быть")
  assert.match(
    BASE,
    /regionByName\(head\)/,
    "быстрый путь — свой словарь городов, без сети",
  )
  assert.match(BASE, /regionOfPlace\(text\)/, "города в словаре нет — спрашиваем геокодера")
  assert.match(BASE, /regionFromText/, "регион ищем и в подписи места")
})

test("профиль сканирования получает города через этот резолвер", () => {
  assert.match(CONFIG, /regionOfBaseAddress\(base\)/, "автосоздание профиля считает регион для любого города")
  assert.match(CONFIG, /regionOfBaseAddress\(settingsForHeal\?\.baseAddress\)/, "лечение пустого профиля тоже")
})

test("скан без городов профиля берёт регион базы, а не уходит «во всю страну»", () => {
  assert.match(
    SCAN,
    /regionOfBaseAddress\(settings\?\.baseAddress\)/,
    "запасной регион считается для любого адреса базы",
  )
  assert.match(SCAN, /cityIds = baseRegion \? \[baseRegion\.id\] : \[\]/, "регион превращается в города профиля")
})

test("помощник получает регион базы с сервера, а не ищет его в браузере", () => {
  assert.match(LOADS, /baseRegion,/, "выдача грузов должна отдавать регион базы")
  assert.match(LOADS, /regionOfBaseAddress\(settings\?\.baseAddress\)/, "регион считается на сервере")
  assert.match(ASSISTANT, /baseRegion\?: \{ id: number; name: string \} \| null/, "помощник знает про поле ответа")
  assert.match(
    ASSISTANT,
    /const fromServer = loadsState\.data\?\.baseRegion\?\.name/,
    "фильтр по региону должен использовать серверный регион",
  )
})

test("словарь регионов полный и понимает разные написания", () => {
  // Тест на данных: 95 регионов и устойчивость к «обл.», «АО», «— Югра»
  const regions = readFileSync(join(ROOT, "lib/ati/ati-city-regions.ts"), "utf8")
  const names = regions.match(/ATI_REGION_NAMES[\s\S]*?\n\}/)
  assert.ok(names, "словарь регионов должен быть на месте")
  const count = (names[0].match(/:\s*"/g) || []).length
  assert.ok(count >= 90, `регионов должно хватать на Россию, найдено ${count}`)
  for (const probe of ["Иркутская область", "Камчатский край", "Ямало-Ненецкий автономный округ"]) {
    assert.match(names[0], new RegExp(probe.split(" ")[0]), `словарь должен знать «${probe}»`)
  }
})
