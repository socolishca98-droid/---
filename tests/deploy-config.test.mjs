/**
 * Тесты конфигурации выката (vercel.json + next.config.mjs).
 *
 * Зачем: планировщик сканирования ATI на Vercel работает только через
 * vercel.json — без него /api/ati/cron никто не вызывает по расписанию, и база
 * грузов Organisations не обновляется. А режим сборки output: standalone,
 * нужный Docker, на Vercel ломает деплой. Оба факта легко потерять при
 * правках, поэтому проверяем их тестом.
 *
 * Запуск: npm test
 */
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const root = path.resolve(import.meta.dirname, "..")

test("vercel.json есть и это корректный JSON", () => {
  const raw = readFileSync(path.join(root, "vercel.json"), "utf8")
  const config = JSON.parse(raw)
  assert.ok(config, "vercel.json не должен быть пустым")
})

test("в vercel.json объявлен планировщик для /api/ati/cron", () => {
  const config = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"))

  assert.ok(Array.isArray(config.crons), "нужен массив crons")
  const cron = config.crons.find((entry) => entry.path === "/api/ati/cron")
  assert.ok(cron, "среди crons должен быть /api/ati/cron")

  // 5 полей: минуты часы дни месяцы дни-недели
  assert.equal(cron.schedule.split(/\s+/).length, 5, `расписание «${cron.schedule}» не cron-выражение`)
  assert.equal(cron.schedule.split(/\s+/)[0], "*/15", "скан ATI должен идти каждые 15 минут")
})

test("next.config: на Vercel standalone выключен, иначе включён", async () => {
  // Кэш обходим разными query: модуль читает process.env при загрузке
  const loadConfig = async (vercel) => {
    const previous = process.env.VERCEL
    if (vercel) process.env.VERCEL = vercel
    else delete process.env.VERCEL
    try {
      const module = await import(
        pathToFileURL(path.join(root, "next.config.mjs")).href + `?case=${vercel ? "on" : "off"}`
      )
      return module.default
    } finally {
      if (previous === undefined) delete process.env.VERCEL
      else process.env.VERCEL = previous
    }
  }

  const onVercel = await loadConfig("1")
  assert.equal(onVercel.output, undefined, "на Vercel standalone ломает деплой (nft.json)")

  const local = await loadConfig(undefined)
  assert.equal(local.output, "standalone", "локально и в Docker нужен standalone")
})

test("роут планировщика объявляет предельное время выполнения", () => {
  const source = readFileSync(
    path.join(root, "app", "api", "ati", "cron", "route.ts"),
    "utf8",
  )
  assert.match(source, /export const maxDuration = \d+/, "нужен export const maxDuration")
})
