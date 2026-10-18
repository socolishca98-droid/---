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

test("в vercel.json нет расписания чаще одного раза в день", () => {
  const config = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"))

  // Планировщик ATI убран из выката осознанно: на тарифе Hobby Vercel
  // отклоняет деплой с расписанием чаще одного запуска в день
  // (ошибка cron_jobs_limits_reached) — а именно так было раньше.
  // Тест теперь охраняет обратное: если расписание когда-нибудь вернут,
  // оно обязано быть не чаще раза в день, иначе прод снова не выкатится.
  const crons = Array.isArray(config.crons) ? config.crons : []
  for (const cron of crons) {
    assert.equal(typeof cron.schedule, "string", `у cron «${cron.path}» нет расписания`)
    const [minutes] = cron.schedule.trim().split(/\s+/)
    const tooOften =
      minutes === "*" ||
      minutes.startsWith("*/") ||
      minutes.includes(",") ||
      minutes.includes("-")
    assert.ok(!tooOften, `расписание «${cron.schedule}» для ${cron.path} чаще раза в день — Hobby отклонит деплой`)
  }
})

test("если планировщик ATI включён, роут объявляет предельное время выполнения", () => {
  const config = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"))
  const hasCron = Array.isArray(config.crons) && config.crons.some((entry) => entry.path === "/api/ati/cron")
  if (!hasCron) return // планировщик выключен — проверять нечего
  const source = readFileSync(path.join(root, "app/api/ati/cron/route.ts"), "utf8")
  assert.match(source, /maxDuration/, "роут планировщика обязан объявлять предельное время выполнения")
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
  // Проверяем всегда, даже когда планировщик выключен: если его включат
  // обратно, роут должен быть готов к длинному скану.
  const source = readFileSync(
    path.join(root, "app", "api", "ati", "cron", "route.ts"),
    "utf8",
  )
  assert.match(source, /export const maxDuration = \d+/, "нужен export const maxDuration")
})
