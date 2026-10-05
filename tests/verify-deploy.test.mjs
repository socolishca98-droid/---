/**
 * Тесты предстартовой проверки (scripts/verify-deploy.mjs): то, что обычно
 * всплывает уже после деплоя, должно ловиться до запуска — отсутствующий или
 * короткий AUTH_SECRET, отсутствующая база, недоступный для записи каталог
 * загрузок. Проверяются и блокирующие проблемы (exit 1), и предупреждения.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const script = join(root, "scripts", "verify-deploy.mjs")

const LONG_SECRET = "a".repeat(48)

function run(env) {
  // Пустой DATABASE_URL/AUTH_SECRET в окружении — чтобы проверка читала
  // именно переданные значения, а не переменные процесса
  const clean = { ...process.env }
  delete clean.DATABASE_URL
  delete clean.AUTH_SECRET
  delete clean.SENTRY_DSN
  const result = spawnSync(process.execPath, [script, "--envfile=none"], {
    cwd: root,
    encoding: "utf8",
    env: { ...clean, ...env },
  })
  return { code: result.status, out: `${result.stdout || ""}${result.stderr || ""}` }
}

test("без AUTH_SECRET запуск запрещён", () => {
  const { code, out } = run({ DATABASE_URL: "postgresql://u:p@localhost:5432/loginex" })
  assert.equal(code, 1)
  assert.match(out, /AUTH_SECRET/)
})

test("короткий AUTH_SECRET — тоже блокирующая проблема", () => {
  const { code, out } = run({
    DATABASE_URL: "postgresql://u:p@localhost:5432/loginex",
    AUTH_SECRET: "короткий",
  })
  assert.equal(code, 1)
  assert.match(out, /короче 32/)
})

test("без DATABASE_URL запуск запрещён", () => {
  const { code, out } = run({ AUTH_SECRET: LONG_SECRET })
  assert.equal(code, 1)
  assert.match(out, /DATABASE_URL/)
})

test("PostgreSQL с нормальным секретом — годится", () => {
  const { code, out } = run({
    DATABASE_URL: "postgresql://u:p@localhost:5432/loginex?schema=public",
    AUTH_SECRET: LONG_SECRET,
    NODE_ENV: "production",
  })
  assert.equal(code, 0)
  assert.match(out, /Конфигурация годится/)
  assert.match(out, /PostgreSQL/)
})

test("SQLite в проде — предупреждение, но не блокировка", () => {
  const { code, out } = run({
    DATABASE_URL: "file:./dev.db",
    AUTH_SECRET: LONG_SECRET,
  })
  assert.equal(code, 0)
  assert.match(out, /SQLite/)
})

test("без Sentry и без NODE_ENV=production — предупреждения", () => {
  const { code, out } = run({
    DATABASE_URL: "postgresql://u:p@localhost:5432/loginex",
    AUTH_SECRET: LONG_SECRET,
  })
  assert.equal(code, 0)
  assert.match(out, /SENTRY_DSN/)
  assert.match(out, /NODE_ENV/)
})
