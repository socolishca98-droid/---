// tests/ati-contacts-policy.test.mjs
//
// Контактные данные ATI.SU не собираются АВТОМАТИЧЕСКИ.
//
// Основание — Пользовательское соглашение ATI.SU:
//   п. 3.2.1.7 — «Не осуществлять никаких действий, включая накопление,
//     сбор, обработку, запись и тому подобные действия, в отношении адресов
//     электронной почты или любой иной контактной информации Участников
//     ATI.SU … АВТОМАТИЗИРОВАННЫМИ способами».
//   п. 3.2.1.8 — «Не использовать автоматизированные скрипты (программы)
//     для сбора информации … КРОМЕ сервисов, созданных Администрацией
//     специально для таких случаев».
//
// Мы идём по разрешённому пути: контакт берётся ОФИЦИАЛЬНЫМ документированным
// методом API ATI (GET /v1.0/firms/{atiId}/contacts/summary — это и есть
// сервис Администрации для такой задачи), и только когда диспетчер нажал
// кнопку «Контакты». Ровно как он сам нажимает «показать» на сайте ATI.
//
// Лимит ATI на реквизиты других фирм — 1000 запросов в сутки; свой лимит
// держим ниже, чтобы исчерпание дневного лимита ATI не легло всей биржей.
//
// Этот тест стережет оба правила на уровне исходников.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

/** Все .ts/.tsx файлы в подкаталоге, кроме служебных. */
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, acc)
    else if (/\.tsx?$/.test(entry)) acc.push(full)
  }
  return acc
}

const APP_FILES = walk(join(ROOT, "app"))
const LIB_FILES = walk(join(ROOT, "lib"))
const ALL = [...APP_FILES, ...LIB_FILES]

test("ни один экран не тянет контакты ATI автоматически", () => {
  const offenders = []
  for (const file of ALL) {
    const text = readFileSync(file, "utf8")
    if (text.includes("fetchContacts: true")) {
      offenders.push(file.replace(`${ROOT}/`, ""))
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `найдены места, где контакты ATI собираются автоматически: ${offenders.join(", ")}. ` +
      "Контакт фрахтователя показывается только по нажатию кнопки.",
  )
})

test("контакты берутся официальным методом ATI, а не выдуманным путём", () => {
  const contacts = readFileSync(join(ROOT, "lib/ati/contacts.ts"), "utf8")
  // Ровно тот путь, который описан в документации ATI (API для работы с Фирмами)
  assert.match(
    contacts,
    /\/v1\.0\/firms\/\$\{encodeURIComponent\(atiId\)\}\/contacts\/summary/,
    "должен вызываться документированный метод contacts/summary",
  )
  // Старый неверный путь не должен вернуться
  assert.ok(
    !contacts.includes("/contacts`") && !/firms\/\$\{atiId\}`/.test(contacts),
    "не должен вызываться недокументированный путь",
  )
})

test("роут контактов вызывается только по нажатию и имеет дневной лимит", () => {
  const route = readFileSync(join(ROOT, "app/api/ati/loads/contacts/route.ts"), "utf8")
  // Ответ кэшируется: повторное нажатие тот же груз ATI не дёргает
  assert.match(route, /if \(cache\.contactPhone\)/, "повторный показ не должен идти в ATI")
  // Свой дневной лимит — с запасом до лимита ATI (1000/сутки)
  assert.match(route, /CONTACTS_DAILY_LIMIT/, "должен быть дневной лимит")
  assert.match(route, /daily_limit/, "при исчерпании лимита — честный код ошибки")
  // Без фрахтователя контакт не запрашиваем
  assert.match(route, /!cache\.firmId/, "без фирмы запрос не уходит")
})

test("свой дневной лимит ниже лимита ATI", () => {
  const contacts = readFileSync(join(ROOT, "lib/ati/contacts.ts"), "utf8")
  const match = contacts.match(/CONTACTS_DAILY_LIMIT\s*=\s*(\d+)/)
  assert.ok(match, "лимит должен быть числом")
  const limit = Number(match[1])
  assert.ok(limit > 0 && limit <= 1000, `лимит ${limit} должен быть в разумных пределах`)
  assert.ok(limit < 1000, "лимит должен быть ниже лимита ATI, с запасом")
})

test("кнопка контактов есть на обоих экранах работы с грузами", () => {
  // Экран «АТИ live»
  const search = readFileSync(join(ROOT, "app/lm/search/page.tsx"), "utf8")
  assert.match(search, /\/api\/ati\/loads\/contacts/, "на экране поиска должна быть кнопка")
  // Помощник сборки
  const assistant = readFileSync(join(ROOT, "app/lm/routes/assistant/page.tsx"), "utf8")
  assert.match(assistant, /\/api\/ati\/loads\/contacts/, "в помощнике должна быть кнопка")
  assert.match(assistant, /fetchPhone/, "помощник должен уметь запросить контакт")
})

test("телефоны не сохраняются при сохранении груза в кэш", () => {
  const client = readFileSync(join(ROOT, "lib/ati-client.ts"), "utf8")
  const from = client.indexOf("async function saveToCache(")
  const rest = client.slice(from)
  const end = rest.search(/\n(export |function |\/\*\*)/)
  const save = end === -1 ? rest : rest.slice(0, end)
  assert.match(save, /contactName: null/)
  assert.match(save, /contactPhone: null/)
  assert.ok(!save.includes("fetchFirmContacts"), "saveToCache не должен добывать контакты сам")
})

test("у груза есть ссылка на паспорт фирмы в ATI", () => {
  const client = readFileSync(join(ROOT, "lib/ati-client.ts"), "utf8")
  assert.match(client, /https:\/\/ati\.su\/firms\//)
  assert.match(client, /firmUrl: atiFirmUrl\(/)
})
