// tests/search-parity.test.mjs
//
// «На ATI вводишь откуда и куда — там сотни вариантов и контакты, а у нас нет».
//
// Замер на бою (превью, аккаунт организации, «Ярославль → Казань», радиус 100):
//   • десктопный /search без source — 0 грузов (уходил только на площадки);
//   • тот же запрос с source:"both" — 106 грузов, ATI обещает 187 по фильтру;
//   • контакты по нажатию отдаёт официальный метод ATI: +7 (960) 1095916 и т.д.
//
// Тест стережет четыре правила на уровне исходников: десктоп шлёт источник,
// оба экрана честно показывают масштаб выдачи и умеет добрать следующие
// страницы, контакты берутся только по нажатию.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const DESKTOP = readFileSync(join(ROOT, "components/orders/ati-search-panel.tsx"), "utf8")
const MOBILE = readFileSync(join(ROOT, "app/lm/search/page.tsx"), "utf8")
const CLIENT = readFileSync(join(ROOT, "lib/ati-client.ts"), "utf8")

test("десктопный живой поиск отправляет источник: без него он искал только по площадкам", () => {
  assert.match(
    DESKTOP,
    /manualMode: true,\s*\n\s*source,/,
    "в теле /api/ati/scan должен уходить source — иначе поиск идёт только по площадкам организации",
  )
  assert.match(DESKTOP, /useState<"boards" \| "exchange" \| "both">\("both"\)/, "источник по умолчанию — оба")
  assert.match(DESKTOP, /Общая биржа/, "переключатель источника должен быть подписан на экране")
})

test("оба экрана честно показывают масштаб выдачи ATI", () => {
  assert.match(DESKTOP, /ATI обещает по такому фильтру/, "десктоп должен называть обещанное биржей число")
  assert.match(MOBILE, /ATI обещает по такому фильтру/, "телефон должен называть обещанное биржей число")
  assert.match(
    DESKTOP,
    /totalItems: data\.totalItems/,
    "масштаб должен приходить из ответа скана",
  )
})

test("выдача добирается страницами по кнопке, а не молча обрывается", () => {
  assert.match(DESKTOP, /handleSearch = async \(pageStart\?: number\)/, "десктоп должен уметь продолжать со страницы")
  assert.match(DESKTOP, /Показать ещё/, "кнопка добра остатка выдачи должна быть")
  assert.match(MOBILE, /runLiveSearch\(pageStart\?: number\)/, "телефон должен уметь продолжать со страницы")
  assert.match(MOBILE, /Показать ещё/, "кнопка добра остатка выдачи должна быть")
  assert.match(MOBILE, /pageStart: pageStart \?\? undefined/, "страница продолжения должна уходить в запрос")
})

test("контакты фрахтователя — только по нажатию, общим роутом", () => {
  assert.match(DESKTOP, /\/api\/ati\/loads\/contacts/, "десктоп должен звать тот же роут контактов")
  assert.match(MOBILE, /\/api\/ati\/loads\/contacts/, "телефон должен звать тот же роут контактов")
  // Автоматического сбора быть не должно: ATI.SU ругается за это (п. 3.2.1.7)
  assert.equal(DESKTOP.includes("fetchContacts: true"), false, "нельзя просить контакты автоматически при взятии груза")
  assert.equal(MOBILE.includes("fetchContacts: true"), false, "нельзя просить контакты автоматически при взятии груза")
})

test("масштаб выдачи доходит до экрана из объединённого поиска", () => {
  assert.match(
    CLIENT,
    /totalItems: \(exchangeResult as any\)\?\.totalItems \?\? null/,
    "поиск «Всё» должен отдавать totalItems биржи, иначе экран не знает масштаба",
  )
  assert.match(
    CLIENT,
    /nextPageStart: \(exchangeResult as any\)\?\.nextPageStart \?\? null/,
    "поиск «Всё» должен отдавать страницу продолжения",
  )
})
