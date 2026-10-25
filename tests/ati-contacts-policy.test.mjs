// tests/ati-contacts-policy.test.mjs
//
// Контактные данные ATI.SU не собираются автоматически.
//
// Почему так: ATI.SU делает замечания за автоматический сбор контактных
// данных фрахтователей. Поэтому телефон берётся ТОЛЬКО по явному действию
// пользователя — кнопка «Узнать телефон» (POST /api/ati/loads/contacts).
// Флаг fetchContacts в /api/orders/from-cache существует, но не должен
// выставляться ни в одном месте интерфейса.
//
// Этот тест стережет правило на уровне исходников: если кто-то снова
// добавит fetchContacts: true, сборка тестов упадёт.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
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
      "Телефон фрахтователя добирается только кнопкой «Узнать телефон».",
  )
})

test("флаг fetchContacts в API не включён по умолчанию", () => {
  const route = readFileSync(join(ROOT, "app/api/orders/from-cache/route.ts"), "utf8")
  // Запрос к ATI выполняется только когда флаг явно пришёл равным true
  assert.match(route, /body\.fetchContacts === true/)
  // и только когда контакта ещё нет в записи
  assert.match(route, /!contactPhone/)
})

test("телефоны не сохраняются при сохранении груза в кэш", () => {
  const client = readFileSync(join(ROOT, "lib/ati-client.ts"), "utf8")
  // saveToCache кладёт груз с пустыми контактами: при сохранении из биржи
  // телефона нет и быть не должно
  const from = client.indexOf("async function saveToCache(")
  // Берём только тело функции: дальше в файле идут другие функции и
  // реэкспорт fetchFirmContacts, который к saveToCache отношения не имеет
  const rest = client.slice(from)
  const end = rest.search(/\n(export |function |\/\*\*)/)
  const save = end === -1 ? rest : rest.slice(0, end)
  assert.match(save, /contactName: null/)
  assert.match(save, /contactPhone: null/)
  // saveToCache не должен сам лезть за контактами
  assert.ok(!save.includes("fetchFirmContacts"), "saveToCache не должен добывать контакты")
})
