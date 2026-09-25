/**
 * Проверка, что код не зовёт несуществующие роуты.
 *
 * Такой промах тихий: `fetch("/api/orders/…")` в ответ на опечатку получает
 * 404, страница показывает пустоту, и в логах ничего нет. Тест запускает
 * scripts/check-api-calls.mjs и падает, если появился вызов без обработчика.
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("все вызовы /api/* соответствуют существующим обработчикам", () => {
  const result = spawnSync("node", ["scripts/check-api-calls.mjs"], {
    cwd: root,
    encoding: "utf-8",
  })

  assert.equal(
    result.status,
    0,
    `найдены вызовы несуществующих роутов:\n${result.stdout}${result.stderr}`,
  )
  assert.match(result.stdout, /Все вызовы \/api\/\* существуют/)
})
