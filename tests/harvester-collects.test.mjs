// tests/harvester-collects.test.mjs
//
// «Сборщик плохо собирает». Живой замер на превью (профиль «Основной
// (Ярославль. Ул. Докучалова 12)», кнопка «Собрать»):
//
//   профиль:        города = []            ← регион базы неизвестен
//   режим fast:     собрано 195, биржи 0   ← общая биржа не опрашивалась
//   режим deep:     собрано 195, биржи 0   ← режим не влиял ни на что
//   база после:     1476 → 1476            ← новых грузов ноль
//
// Четыре причины, которые стережёт этот тест:
//   1. профиль создаётся/лечится с городами из адреса базы;
//   2. плановый сбор идёт по ОБОИМ источникам (площадки + общая биржа);
//   3. режим сборки меняет объём обхода биржи;
//   4. «собрано» — это НОВЫЕ грузы, а все найденные строки.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const CLIENT = readFileSync(join(ROOT, "lib/ati-client.ts"), "utf8")
const CONFIG = readFileSync(join(ROOT, "app/api/ati/scan-config/route.ts"), "utf8")
const SCHEDULE = readFileSync(join(ROOT, "lib/ati/scan-schedule.ts"), "utf8")
const SCAN_ROUTE = readFileSync(join(ROOT, "app/api/ati/scan/route.ts"), "utf8")
const MOBILE = readFileSync(join(ROOT, "app/lm/search/page.tsx"), "utf8")
const DESKTOP = readFileSync(join(ROOT, "components/orders/ati-search-panel.tsx"), "utf8")

test("профиль получает города из адреса базы, а не пустой список", () => {
  assert.match(
    CONFIG,
    /cities: JSON\.stringify\(baseCities\)/,
    "автосоздание профиля должно писать города базы, иначе скан без фильтра по региону",
  )
  assert.match(CONFIG, /cityIdsFromBaseAddress/, "адрес базы должен превращаться в города профиля")
  assert.match(
    CONFIG,
    /parseProfileCities\(profile\.cities\)\.length > 0\) continue/,
    "уже созданные пустые профили должны лечиться на чтении",
  )
})

test("плановый сбор идёт и по площадкам, и по общей бирже", () => {
  assert.match(
    SCHEDULE,
    /source: "both" as const/,
    "профиль расписания должен требовать оба источника",
  )
  assert.match(
    CLIENT,
    /params\?\.manualMode\s*\n\s*\?\s*"boards"\s*\n\s*:\s*"both"/,
    "без явного источника плановый скан должен брать оба источника",
  )
  assert.match(MOBILE, /manualMode: false,[\s\S]{0,80}source: "both"/, "кнопка «Собрать» на телефоне шлёт источник")
  assert.match(DESKTOP, /manualMode: false,[\s\S]{0,80}source: "both"/, "кнопка «Собрать» на компьютере шлёт источник")
})

test("режим сборки меняет объём обхода биржи", () => {
  assert.match(CLIENT, /function pagesForMode/, "режим должен пересчитываться в страницы обхода")
  assert.match(CLIENT, /maxPages: pagesForMode\(params\?\.mode\)/, "плановый скан должен использовать режим")
  assert.match(CLIENT, /mode === "fast"\) return 2/, "быстрый режим должен быть меньше обычного")
  assert.match(CLIENT, /mode === "deep"\) return 12/, "глубокий режим должен быть больше обычного")
})

test("«собрано» считается по новым грузам, а не по всем найденным", () => {
  assert.match(CLIENT, /return \{ rows: result, created: toCreate\.length, updated: toUpdate\.length \}/,
    "saveToCache должен отделять новые строки от обновлённых")
  assert.match(CLIENT, /count: created,/, "в отчёте сбора count — это новые грузы")
  assert.match(MOBILE, /Новых грузов нет/, "экран должен честно сказать, когда новых грузов не прибавилось")
  assert.match(DESKTOP, /Новых грузов нет/, "компьютер должен честно сказать, когда новых грузов не прибавилось")
})

test("скан без городов профиля берёт регион из адреса базы", () => {
  assert.match(
    SCAN_ROUTE,
    /cityIds = cityIdsFromBaseAddress\(settings\?\.baseAddress\)/,
    "пустой профиль не должен отправлять сборщика «во всю страну»",
  )
  assert.match(SCAN_ROUTE, /scanParamsForProfile/, "плановый сбор должен брать настройки из профиля организации")
})
