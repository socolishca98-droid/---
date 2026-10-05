// scripts/verify-deploy.mjs
//
// Предстартовая проверка продакшен-конфигурации: то, что обычно всплывает
// уже после деплоя (нет секрета, база не та, каталоги не writable),
// проверяется до запуска.
//
//   npm run verify:deploy          — проверка по .env
//   DATABASE_URL=… npm run verify:deploy
//   npm run verify:deploy -- --envfile=.env.production — проверить другой файл
//   npm run verify:deploy -- --envfile=none             — только переменные окружения
//
// Флаг без дефиса внутри имени: --env-file перехватывается самим Node.
//
// Коды выхода: 0 — можно запускать, 1 — есть блокирующие проблемы.

import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const blocking = [];
const warnings = [];
const notes = [];

// ---------------------------------------------------------------------------
// .env читаем сами: node не подхватывает его, в отличие от Next
// ---------------------------------------------------------------------------

function readEnvFile() {
  // --env-file=none полезен, когда всё приходит из окружения (CI, тесты):
  // иначе локальный .env замаскировал бы отсутствующую переменную
  const override = (process.argv.find((arg) => arg.startsWith("--envfile=")) || "")
    .split("=")[1];
  if (override === "none") return {};
  const envPath = override ? join(ROOT, override) : join(ROOT, ".env");
  if (!existsSync(envPath)) return {};
  const result = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

const fileEnv = readEnvFile();
const env = (key) => process.env[key] ?? fileEnv[key] ?? null;

// ---------------------------------------------------------------------------
// 1. Секреты и база
// ---------------------------------------------------------------------------

const authSecret = env("AUTH_SECRET");
if (!authSecret) {
  blocking.push(
    "AUTH_SECRET не задан — сервер не стартует (проверка lib/auth/startup.ts)",
  );
} else if (authSecret.length < 32) {
  blocking.push(
    `AUTH_SECRET короче 32 символов (сейчас ${authSecret.length}) — подпись сессий слабая`,
  );
}

const databaseUrl = env("DATABASE_URL");
if (!databaseUrl) {
  blocking.push("DATABASE_URL не задан — сервер не стартует");
} else if (/^postgres(ql)?:\/\//.test(databaseUrl)) {
  notes.push("база: PostgreSQL — продакшен-режим");
  if (!/sslmode=/.test(databaseUrl) && !/localhost|127\.0\.0\.1|@postgres[:/]/.test(databaseUrl)) {
    warnings.push(
      "в DATABASE_URL нет sslmode — для внешней базы укажите sslmode=require",
    );
  }
  const schemaPath = join(ROOT, "prisma", "postgres", "schema.prisma");
  if (!existsSync(schemaPath)) {
    warnings.push(
      "prisma/postgres/schema.prisma не создан — выполните npm run schema:postgres",
    );
  }
} else if (databaseUrl.startsWith("file:")) {
  warnings.push(
    "база: SQLite. Для продакшена с параллельной записью нужен PostgreSQL (docs/deploy.md)",
  );
}

// ---------------------------------------------------------------------------
// 2. Каталоги, доступные на запись
// ---------------------------------------------------------------------------

function checkWritable(relativePath, { required }) {
  const full = join(ROOT, relativePath);
  try {
    mkdirSync(full, { recursive: true });
    accessSync(full, constants.W_OK);
    notes.push(`${relativePath}: запись разрешена`);
  } catch {
    const message = `${relativePath}: нет прав на запись — файлы и бэкапы не сохранятся`;
    if (required) blocking.push(message);
    else warnings.push(message);
  }
}

// Фото и сканы лежат вне public (data/uploads) — каталог создаётся на месте
checkWritable("data/uploads", { required: true });
checkWritable("backups", { required: false });

// ---------------------------------------------------------------------------
// 3. Прочее окружение
// ---------------------------------------------------------------------------

if (process.env.NODE_ENV === "production") {
  notes.push("NODE_ENV=production");
} else {
  warnings.push(
    `NODE_ENV=${process.env.NODE_ENV ?? "не задан"} — в продакшене должен быть production`,
  );
}

if (!env("SENTRY_DSN")) {
  warnings.push("SENTRY_DSN не задан — ошибки продакшена не будут видны");
} else {
  notes.push("Sentry: включён");
}

// ---------------------------------------------------------------------------
// Итог
// ---------------------------------------------------------------------------

console.log("=== Проверка конфигурации перед запуском ===");
for (const line of notes) console.log(`  • ${line}`);
for (const line of warnings) console.log(`  ! ${line}`);
for (const line of blocking) console.log(`  ✗ ${line}`);
console.log("");

if (blocking.length > 0) {
  console.log(`✗ Запуск невозможен: проблем ${blocking.length}, предупреждений ${warnings.length}`);
  process.exit(1);
}
console.log(`✓ Конфигурация годится (предупреждений: ${warnings.length})`);
