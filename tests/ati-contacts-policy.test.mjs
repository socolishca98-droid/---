// tests/ati-contacts-policy.test.mjs
//
// Контактные данные ATI.SU не собираются автоматически.
//
// Почему так, двумя причинами:
//   1. ATI.SU делает замечания за автоматический сбор контактных данных
//      фрахтователей.
//   2. Технически их и не получить: API ATI контакты фирмы не отдаёт вовсе.
//      Проверено на бою — /v1.0/firms/{id}, /v1.0/firms/{id}/contacts,
//      /v1.0/loads/{id}/contacts, /v1.0/firms — все 404. Прежняя кнопка
//      «Узнать телефон» (POST /api/ati/loads/contacts) поэтому всегда
//      отвечала 502 и была удалена.
//
// Теперь телефон фрахтователя логист смотрит в «Паспорте фирмы» на самом
// ATI (https://ati.su/firms/{id}/info) — ссылка честная и всегда рабочая.
// Этот тест стережет оба правила на уровне исходников: если кто-то снова
// добавит автоматический сбор контактов, сборка тестов упадёт.

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

test("ни один экран не тянет контакты ATI автоматически", () => {
  const offenders = []
  for (const file of [...APP_FILES, ...LIB_FILES]) {
    const text = readFileSync(file, "utf8")
    if (text.includes("fetchContacts: true")) {
      offenders.push(file.replace(`${ROOT}/`, ""))
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `найдены места, где контакты ATI собираются автоматически: ${offenders.join(", ")}. ` +
      "Телефон фрахтователя открывается ссылкой на «Паспорт фирмы» в ATI.",
  )
})

test("мертвого роута «Узнать телефон» больше нет", () => {
  // Он всегда отвечал 502: ATI API не отдаёт контакты фирмы. Ссылка на
  // паспорт фирмы честнее — она всегда работает.
  assert.equal(
    existsSync(join(ROOT, "app/api/ati/loads/contacts/route.ts")),
    false,
    "роут /api/ati/loads/contacts должен быть удалён — он всегда отдавал 502",
  )
})

test("модуль добычи контактов удалён", () => {
  assert.equal(existsSync(join(ROOT, "lib/ati/contacts.ts")), false)
  // и на него никто не ссылается
  for (const file of [...APP_FILES, ...LIB_FILES]) {
    const text = readFileSync(file, "utf8")
    assert.ok(
      !text.includes("fetchFirmContacts"),
      `${file.replace(`${ROOT}/`, "")} ссылается на удалённый fetchFirmContacts`,
    )
  }
})

test("у груза есть ссылка на паспорт фирмы в ATI", () => {
  const client = readFileSync(join(ROOT, "lib/ati-client.ts"), "utf8")
  assert.match(client, /https:\/\/ati\.su\/firms\//, "должна собираться ссылка на паспорт фирмы")
  // она выдаётся для каждого груза
  assert.match(client, /firmUrl: atiFirmUrl\(/)
})

test("телефоны не сохраняются при сохранении груза в кэш", () => {
  const client = readFileSync(join(ROOT, "lib/ati-client.ts"), "utf8")
  const from = client.indexOf("async function saveToCache(")
  const rest = client.slice(from)
  const end = rest.search(/\n(export |function |\/\*\*)/)
  const save = end === -1 ? rest : rest.slice(0, end)
  assert.match(save, /contactName: null/)
  assert.match(save, /contactPhone: null/)
})
